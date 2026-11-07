import logging

from . import config
from .app import make_server
from .geo import StationGeo
from .rzd import RzdClient
from .service import BoardService


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if not config.PUBLIC_DIR.is_dir():
        raise SystemExit(f"Папка сайта не найдена: {config.PUBLIC_DIR} (задайте TRAINPAPER_PUBLIC_DIR)")
    if not config.RZD_CA_FILE.is_file():
        logging.warning("Нет сертификатов Минцифры (%s): rzd.ru может не открыться", config.RZD_CA_FILE)

    client = RzdClient()
    service = BoardService(client, StationGeo(client, config.STATIONS_FILE, config.GEO_CACHE_FILE))
    server = make_server(config.HOST, config.PORT, service, config.PUBLIC_DIR)
    host = "localhost" if config.HOST in ("127.0.0.1", "0.0.0.0") else config.HOST
    logging.getLogger("trainpaper").info(
        "TrainPaper: http://%s:%s  (вагон: /flat/, платформа: /platform/)", host, config.PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
