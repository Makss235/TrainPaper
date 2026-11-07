"""Координаты станции — чтобы считать положение солнца и время суток.

В табло РЖД координат нет. Для популярных вокзалов они записаны в stations.json,
для остальных берём их у самой РЖД: виджет «Поезд на карте» отдаёт все остановки
поезда с координатами. Выбираем поезд с табло станции и находим её среди остановок:
для начальной станции это первая остановка, для конечной — последняя, для транзитной —
остановка с тем же временем прибытия/отправления и похожим названием.
Найденное сохраняется в server/data/geo-cache.json.
"""

import json
import logging
import re
import threading
import time
from pathlib import Path

from .rzd import RzdError

log = logging.getLogger(__name__)
RETRY_FAILED_S = 6 * 3600


def load_curated(path: Path) -> dict[int, dict]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        log.warning("stations list unavailable: %s", error)
        return {}
    curated = {}
    for station in data.get("stations", []):
        try:
            curated[int(station["id"])] = {
                "lat": float(station["lat"]), "lon": float(station["lon"]), "source": "list",
            }
        except (KeyError, TypeError, ValueError):
            continue
    return curated


def _tokens(name: str) -> list[str]:
    name = name.upper().replace("Ё", "Е")
    return [token for token in re.split(r"[^0-9A-ZА-Я]+", name) if token]


def name_score(board_name: str, stop_name: str) -> float:
    """Доля слов из названия на табло, с которых начинается какое-то слово остановки.
    'САНКТ-ПЕТЕРБУРГ-ГЛАВН.' ~ 'Санкт-Петербург-Главный' → 1.0."""
    wanted, have = _tokens(board_name), _tokens(stop_name)
    if not wanted or not have:
        return 0.0
    hits = sum(1 for token in wanted if any(other.startswith(token) or token.startswith(other) for other in have))
    return hits / len(wanted)


def _hhmm(value) -> str | None:
    return value[11:16] if isinstance(value, str) and len(value) >= 16 else None


def pick_stop(stops: list[dict], row: dict, station_name: str) -> dict | None:
    if not stops:
        return None
    station = row.get("STATION_ID")
    if row.get("BEGIN_STATION_ID") == station:
        return stops[0]
    if row.get("END_STATION_ID") == station:
        return stops[-1]
    times = {_hhmm(row.get("DATETIME_ARRIVAL_PLAN_LOCAL")), _hhmm(row.get("DATETIME_DEPARTURE_PLAN_LOCAL"))} - {None}
    best, best_score = None, 0.0
    for stop in stops:
        stop_times = {str(t)[:5] for t in (stop.get("arrival"), stop.get("departure")) if t}
        score = name_score(station_name, stop.get("name", "")) + (2.0 if times & stop_times else 0.0)
        if score > best_score:
            best, best_score = stop, score
    return best if best_score >= 2.0 or best_score >= 0.99 else None


class StationGeo:
    def __init__(self, client, stations_file: Path, cache_file: Path):
        self.client = client
        self.curated = load_curated(stations_file)
        self.cache_file = Path(cache_file)
        self.lock = threading.Lock()
        self.failed: dict[int, float] = {}
        try:
            raw = json.loads(self.cache_file.read_text(encoding="utf-8"))
            self.cache = {int(k): v for k, v in raw.items() if isinstance(v, dict)}
        except (OSError, ValueError):
            self.cache = {}

    def lookup(self, station_id: int) -> dict | None:
        return self.curated.get(station_id) or self.cache.get(station_id)

    def resolve(self, station_id: int, station_name: str | None, rows: list[dict]) -> dict | None:
        known = self.lookup(station_id)
        if known or not rows:
            return known
        with self.lock:
            if time.time() - self.failed.get(station_id, 0) < RETRY_FAILED_S:
                return None
            # сначала поезда, которые здесь начинают или заканчивают путь: с ними проще всего
            candidates = sorted(
                (row for row in rows if row.get("TRAIN_NAME_LAT") and row.get("TRAIN_START")),
                key=lambda row: 0 if station_id in (row.get("BEGIN_STATION_ID"), row.get("END_STATION_ID")) else 1,
            )
            for row in candidates[:4]:
                try:
                    stops = self.client.train_stops(row["TRAIN_NAME_LAT"], str(row["TRAIN_START"])[:10])
                except RzdError as error:
                    log.warning("route for %s: %s", row.get("TRAIN_NAME_LAT"), error)
                    continue
                stop = pick_stop(stops, row, station_name or row.get("STATION_NAME") or "")
                if stop:
                    found = {"lat": round(stop["lat"], 5), "lon": round(stop["lon"], 5), "source": "rzd-routemap"}
                    self.cache[station_id] = found
                    self._save()
                    return found
            self.failed[station_id] = time.time()
            return None

    def _save(self):
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_file.with_suffix(".tmp")
            tmp.write_text(json.dumps({str(k): v for k, v in sorted(self.cache.items())},
                                      ensure_ascii=False, indent=1), encoding="utf-8")
            tmp.replace(self.cache_file)
        except OSError as error:
            log.warning("geo cache not saved: %s", error)
