import os
from pathlib import Path

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

PROJECT_ROOT = Path(__file__).resolve().parents[3]
PUBLIC_DIR = Path(os.environ.get("TRAINPAPER_PUBLIC_DIR", PROJECT_ROOT / "public")).resolve()
DATA_DIR = Path(os.environ.get("TRAINPAPER_DATA_DIR", PROJECT_ROOT / "server" / "data")).resolve()

# список популярных станций с координатами — общий для сервера и страниц
STATIONS_FILE = PUBLIC_DIR / "assets" / "data" / "stations.json"
# координаты станций, найденные через карту маршрутов РЖД, копятся здесь
GEO_CACHE_FILE = DATA_DIR / "geo-cache.json"

RZD_BASE = os.environ.get("TRAINPAPER_RZD_BASE", "https://www.rzd.ru")
# rzd.ru подписан «Russian Trusted Root CA» Минцифры; в Windows и certifi его нет.
# Корневой и промежуточный сертификаты лежат рядом с кодом и добавляются
# к системным только для запросов к РЖД.
RZD_CA_FILE = Path(os.environ.get("TRAINPAPER_RZD_CA", Path(__file__).with_name("certs") / "russian_trusted_ca.pem"))
# со стандартным «Python-urllib» rzd.ru отвечает 403, поэтому представляемся честно
USER_AGENT = "TrainPaper/0.1 (study project; live wallpaper with RZD station board)"
HTTP_TIMEOUT_S = 20

BOARD_TTL_S = 60            # табло станции перезапрашиваем не чаще раза в минуту
BOARD_STALE_S = 30 * 60     # при сбое РЖД отдаём старое табло, если ему меньше 30 минут
SUGGEST_TTL_S = 24 * 3600
ERROR_RETRY_S = 20          # после ошибки не дёргаем РЖД повторно раньше этого

BOARD_PAST_S = 3 * 3600     # в ответе: поезда за последние 3 часа…
BOARD_FUTURE_S = 30 * 3600  # …и на ближайшие 30 часов

DEFAULT_STATION = 428       # Санкт-Петербург-Главный (Московский вокзал)
