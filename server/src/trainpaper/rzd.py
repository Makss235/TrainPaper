"""Обращения к rzd.ru.

Те же адреса, что использует страница «Онлайн-табло вокзалов» (rzd.ru/ru/11497):

- ``/ru/page/77731?id=<ID станции>&date=ДД.ММ.ГГГГ`` — табло станции за сутки (JSON);
- ``/suggests/wo-ss-stations/?namePart=…`` — поиск станций, отдаёт внутренние ID табло;
- ``/routemap/source/current/train/<номер>/departure/<ГГГГ-ММ-ДД>`` — остановки поезда
  с координатами (виджет «Поезд на карте»). Отсюда берём координаты станции для солнца.
"""

import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

from . import config


class RzdError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def make_ssl_context(ca_file=config.RZD_CA_FILE) -> ssl.SSLContext:
    context = ssl.create_default_context()          # системные корневые сертификаты
    if ca_file and ca_file.is_file():
        context.load_verify_locations(cafile=str(ca_file))   # + Russian Trusted Root/Sub CA
    return context


class RzdClient:
    def __init__(self, base=config.RZD_BASE, timeout=config.HTTP_TIMEOUT_S, context=None, opener=None):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.context = context if context is not None else make_ssl_context()
        # opener подменяется в тестах: opener(url) -> bytes
        self.opener = opener or self._open

    def _open(self, url: str) -> bytes:
        request = urllib.request.Request(url, headers={
            "User-Agent": config.USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ru",
        })
        try:
            with urllib.request.urlopen(request, context=self.context, timeout=self.timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            raise RzdError(f"rzd.ru ответил {error.code}", error.code) from error
        except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as error:
            raise RzdError(f"rzd.ru недоступен: {error}") from error

    def get_json(self, path: str, params: dict | None = None):
        url = self.base + path
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        body = self.opener(url)
        try:
            return json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RzdError("rzd.ru вернул не JSON") from error

    def board(self, station_id: int, day: date) -> list[dict]:
        """Сырые строки табло станции за день (местная дата станции)."""
        data = self.get_json("/ru/page/77731", {"id": station_id, "date": day.strftime("%d.%m.%Y")})
        rows = (data.get("TABLO") or {}).get("TABLO_TRAIN") if isinstance(data, dict) else None
        if rows is None:
            return []
        if isinstance(rows, dict):                  # одна строка приходит объектом, а не списком
            rows = [rows]
        return [row for row in rows if isinstance(row, dict)]

    def suggest(self, name_part: str) -> list[dict]:
        data = self.get_json("/suggests/wo-ss-stations/", {"namePart": name_part, "lang": "ru"})
        items = data.get("data") if isinstance(data, dict) else None
        nodes = []
        for item in items or []:
            node = item.get("node") if isinstance(item, dict) else None
            if isinstance(node, dict) and node.get("id") is not None and node.get("searchName"):
                nodes.append(node)
        return nodes

    def train_stops(self, train_lat: str, start_day: str) -> list[dict]:
        """Остановки поезда: [{name, lat, lon, arrival, departure}] в порядке следования."""
        path = "/routemap/source/current/train/{}/departure/{}".format(
            urllib.parse.quote(train_lat, safe=""), urllib.parse.quote(start_day, safe=""))
        data = self.get_json(path, {"useTimeZone": "true"})
        stops = []
        for feature in (data.get("features") if isinstance(data, dict) else None) or []:
            geometry = feature.get("geometry") or {}
            props = feature.get("properties") or {}
            coords = geometry.get("coordinates")
            if geometry.get("type") != "Point" or not isinstance(coords, list) or len(coords) < 2:
                continue
            stops.append({
                "name": str(props.get("name") or ""),
                "lon": float(coords[0]),
                "lat": float(coords[1]),
                "arrival": props.get("arrivalTime"),
                "departure": props.get("departureTime"),
                "stop": props.get("stationType") != "WITHOUT_STOP",
            })
        return stops
