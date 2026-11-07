"""Табло и поиск станций с кэшем: страницы опрашивают сервер, сервер — rzd.ru не чаще раза в минуту."""

import logging
import threading
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from . import config
from .board import build_trains, station_info
from .rzd import RzdError

log = logging.getLogger(__name__)


def normalize_query(text: str) -> str:
    return " ".join(text.upper().replace("Ё", "Е").split())


class BoardService:
    def __init__(self, client, geo, clock=time.time):
        self.client = client
        self.geo = geo
        self.clock = clock
        self.days: dict[tuple[int, date], tuple[float, list[dict]]] = {}
        self.errors: dict[tuple[int, date], float] = {}
        self.offsets: dict[int, int] = {}
        self.suggestions: dict[str, tuple[float, list[dict]]] = {}
        self.locks: dict[object, threading.Lock] = defaultdict(threading.Lock)
        self.locks_guard = threading.Lock()

    def _lock(self, key) -> threading.Lock:
        with self.locks_guard:
            return self.locks[key]

    def _local_date(self, station_id: int, now: float) -> datetime:
        offset = self.offsets.get(station_id, 180)
        return datetime.fromtimestamp(now, timezone.utc) + timedelta(minutes=offset)

    def _day_rows(self, station_id: int, day: date, ttl: float, now: float) -> tuple[list[dict], bool]:
        """Строки за день и флаг «данные устарели»."""
        key = (station_id, day)
        with self._lock(key):
            cached = self.days.get(key)
            if cached and now - cached[0] < ttl:
                return cached[1], False
            if now - self.errors.get(key, 0) < config.ERROR_RETRY_S:
                if cached and now - cached[0] < config.BOARD_STALE_S:
                    return cached[1], True
                raise RzdError("rzd.ru временно недоступен")
            try:
                rows = self.client.board(station_id, day)
            except RzdError as error:
                self.errors[key] = now
                log.warning("board %s %s: %s", station_id, day, error)
                if cached and now - cached[0] < config.BOARD_STALE_S:
                    return cached[1], True
                raise
            self.days[key] = (now, rows)
            self.errors.pop(key, None)
            return rows, False

    def board(self, station_id: int, suburban: bool = False) -> dict:
        now = self.clock()
        rows, stale = self._collect(station_id, now)
        info = station_info(rows, station_id)
        if info["utcOffset"] is not None and info["utcOffset"] != self.offsets.get(station_id):
            before = self._local_date(station_id, now).date()
            self.offsets[station_id] = info["utcOffset"]
            if self._local_date(station_id, now).date() != before:     # другой часовой пояс — другие сутки
                rows, stale = self._collect(station_id, now)
        geo = self.geo.resolve(station_id, info["name"], rows) if self.geo else None
        return {
            "station": {**info, **({"lat": geo["lat"], "lon": geo["lon"], "geo": geo["source"]} if geo else {})},
            "updated": int(now),
            "stale": stale,
            "trains": build_trains(rows, int(now), config.BOARD_PAST_S, config.BOARD_FUTURE_S, suburban),
        }

    def _collect(self, station_id: int, now: float) -> tuple[list[dict], bool]:
        local = self._local_date(station_id, now)
        today = local.date()
        days = [(today, config.BOARD_TTL_S), (today + timedelta(days=1), 5 * config.BOARD_TTL_S)]
        if local.hour < 3:                       # ночью ещё досматриваем вчерашние поздние поезда
            days.insert(0, (today - timedelta(days=1), 5 * config.BOARD_TTL_S))
        rows, stale, failures = [], False, 0
        for day, ttl in days:
            try:
                day_rows, day_stale = self._day_rows(station_id, day, ttl, now)
            except RzdError:
                if day == today:
                    raise
                failures += 1
                continue
            rows.extend(day_rows)
            stale = stale or day_stale
        return rows, stale or failures > 0

    def stations(self, query: str, limit: int = 15) -> list[dict]:
        query = normalize_query(query)
        if len(query) < 2:
            return []
        key = query[:2]                          # так же, как сайт РЖД: запрос по двум буквам, остальное — фильтр
        now = self.clock()
        with self._lock(("suggest", key)):
            cached = self.suggestions.get(key)
            if not cached or now - cached[0] > config.SUGGEST_TTL_S:
                cached = (now, self.client.suggest(key))
                self.suggestions[key] = cached
        found = []
        for node in cached[1]:
            name = normalize_query(str(node.get("searchName", "")))
            position = name.find(query)
            if position < 0:
                continue
            found.append((0 if position == 0 else 1, -(node.get("dtWeight") or 0), -(node.get("suWeight") or 0), name, node))
        found.sort(key=lambda item: item[:4])
        return [{
            "id": int(node["id"]),
            "name": str(node["searchName"]),
            "region": node.get("compositeRegion"),
            "longDistance": bool(node.get("dtWeight")),
        } for *_, node in found[:limit]]
