import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .rzd import RzdError

# Типы задаём явно: на Windows mimetypes берёт их из реестра, и там .js бывает
# text/plain — браузер с таким типом не загружает ES-модули.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".gltf": "model/gltf+json",            # свои 3D-модели станций для «Платформы»
    ".glb": "model/gltf-binary",
    ".bin": "application/octet-stream",
}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **MIME_TYPES}

    def __init__(self, *args, service, public_dir: Path, **kwargs):
        self.service = service
        self.public_dir = public_dir
        super().__init__(*args, directory=str(public_dir), **kwargs)

    def log_message(self, format, *args):        # не засоряем консоль запросами статики и опросами
        if not self.path.startswith(("/api/", "/assets/")):
            super().log_message(format, *args)

    def do_GET(self):
        parts = urlsplit(self.path)
        query = parse_qs(parts.query)

        if parts.path == "/api/board":
            try:
                station = int(query.get("station", [""])[0])
            except ValueError:
                return self.send_json({"error": "Нужен числовой ID станции: /api/board?station=428"}, 400)
            suburban = query.get("suburban", ["0"])[0] in ("1", "true", "yes")
            try:
                return self.send_json(self.service.board(station, suburban))
            except RzdError as error:
                return self.send_json({"error": str(error)}, 502)

        if parts.path == "/api/stations":
            try:
                return self.send_json({"stations": self.service.stations(query.get("q", [""])[0])})
            except RzdError as error:
                return self.send_json({"error": str(error), "stations": []}, 502)

        if parts.path.startswith("/api/"):
            return self.send_json({"error": "Нет такого метода"}, 404)
        return super().do_GET()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def send_head(self):
        target = Path(self.translate_path(self.path)).resolve()   # %xx и ../ уже разобраны
        if not target.is_relative_to(self.public_dir) or \
                any(part.startswith(".") for part in target.relative_to(self.public_dir).parts):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        # статика: браузер всегда сверяется с сервером (304, если файл не менялся) — после
        # обновления сайта не подхватываются старые модули из кэша
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def make_server(host: str, port: int, service, public_dir: Path) -> ThreadingHTTPServer:
    handler = partial(Handler, service=service, public_dir=Path(public_dir).resolve())
    return ThreadingHTTPServer((host, port), handler)
