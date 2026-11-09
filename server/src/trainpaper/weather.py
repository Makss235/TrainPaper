"""Настоящая погода для «Платформы»: код погоды WMO и осадки для координат станции.

Источник — open-meteo.com (бесплатно, без ключа). Запрос идёт через свой сервер (а не со страницы):
ответ кэшируется на 30 минут для точки, округлённой до 0,1° (~10 км), поэтому десятки вкладок
с одной станцией дают один запрос, а точные координаты пользователя никуда не уходят — только станции.
"""

import json
import logging
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

log = logging.getLogger(__name__)

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
TTL_S = 30 * 60             # погода меняется медленно — раз в полчаса достаточно
ERROR_RETRY_S = 5 * 60      # после сбоя не дёргаем источник чаще


class WeatherError(Exception):
    pass


def make_ssl_context() -> ssl.SSLContext:
    """Системные корневые сертификаты. На Windows — только хранилище ROOT: в хранилище промежуточных (CA)
    бывают просроченные сертификаты, и OpenSSL строит цепочку через них («certificate has expired»)."""
    if not hasattr(ssl, "enum_certificates"):
        return ssl.create_default_context()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    for cert, encoding, trust in ssl.enum_certificates("ROOT"):
        if encoding == "x509_asn" and (trust is True or ssl.Purpose.SERVER_AUTH.oid in trust):
            try:
                context.load_verify_locations(cadata=cert)
            except ssl.SSLError:
                pass
    return context


class WeatherService:
    def __init__(self, opener=None, clock=time.time, timeout=config.HTTP_TIMEOUT_S):
        # opener подменяется в тестах: opener(url) -> bytes
        self.opener = opener or self._open
        self.context = None if opener else make_ssl_context()
        self.clock = clock
        self.timeout = timeout
        self.cache: dict[tuple[float, float], tuple[float, dict]] = {}
        self.errors: dict[tuple[float, float], float] = {}
        self.lock = threading.Lock()

    def _open(self, url: str) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=self.timeout, context=self.context) as response:
            return response.read()

    def current(self, lat: float, lon: float) -> dict:
        """{ code, precipitation (мм/ч), cloudCover (%), time, cached } для точки lat, lon."""
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise WeatherError("Координаты вне диапазона")
        key = (round(lat, 1), round(lon, 1))
        now = self.clock()
        with self.lock:
            hit = self.cache.get(key)
            if hit and now - hit[0] < TTL_S:
                return {**hit[1], "cached": True}
            if now - self.errors.get(key, -1e9) < ERROR_RETRY_S:
                if hit:
                    return {**hit[1], "cached": True, "stale": True}
                raise WeatherError("Источник погоды недавно не ответил")
        query = urllib.parse.urlencode({
            "latitude": key[0], "longitude": key[1],
            "current": "weather_code,precipitation,cloud_cover", "timezone": "UTC",
        })
        try:
            data = json.loads(self.opener(f"{WEATHER_URL}?{query}"))
            cur = data["current"]
            result = {
                "code": int(cur["weather_code"]),
                "precipitation": float(cur.get("precipitation") or 0),
                "cloudCover": float(cur.get("cloud_cover") or 0),
                "time": cur.get("time"),
            }
        except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError) as error:
            log.warning("Погода для %s не получена: %s", key, error)
            with self.lock:
                self.errors[key] = now
            if hit:
                return {**hit[1], "cached": True, "stale": True}
            raise WeatherError(f"Источник погоды не ответил: {error}") from error
        with self.lock:
            self.cache[key] = (now, result)
            self.errors.pop(key, None)
        return {**result, "cached": False}
