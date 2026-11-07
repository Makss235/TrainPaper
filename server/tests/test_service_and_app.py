import json
import threading
import urllib.request
from datetime import date
from pathlib import Path

import pytest

from trainpaper.app import make_server
from trainpaper.board import parse_msk
from trainpaper.rzd import RzdClient, RzdError
from trainpaper.service import BoardService

ROWS = json.loads((Path(__file__).parent / "data" / "board_rows.json").read_text(encoding="utf-8"))
NOW = parse_msk("2026-11-07T02:40:00")


class FakeClient:
    def __init__(self, rows=None):
        self.rows = rows if rows is not None else [ROWS["transit_departing"], ROWS["transit_waiting"]]
        self.board_calls = []
        self.fail = False

    def board(self, station_id, day):
        self.board_calls.append((station_id, day))
        if self.fail:
            raise RzdError("down")
        return self.rows if day == date(2026, 11, 7) else []

    def suggest(self, part):
        return [
            {"id": 1146, "searchName": "ТВЕРЬ", "dtWeight": 4, "compositeRegion": "Тверская область"},
            {"id": 1150, "searchName": "ТВЕРЦА", "dtWeight": None, "suWeight": 5},
            {"id": 20006217, "searchName": "ТВЕРЬ ТУРИСТИЧЕСКАЯ", "dtWeight": 2},
        ]


class NoGeo:
    def resolve(self, *args):
        return {"lat": 56.8, "lon": 35.9, "source": "list"}


def make_service(client=None, clock=lambda: NOW):
    return BoardService(client or FakeClient(), NoGeo(), clock=clock)


def test_board_is_cached_for_a_minute():
    client = FakeClient()
    now = [NOW]
    service = make_service(client, clock=lambda: now[0])
    first = service.board(1146)
    assert first["station"] == {"id": 1146, "name": "ТВЕРЬ", "utcOffset": 180, "lat": 56.8, "lon": 35.9, "geo": "list"}
    assert [t["number"] for t in first["trains"]] == ["022А", "049С"]
    calls = len(client.board_calls)
    now[0] += 30
    service.board(1146)
    assert len(client.board_calls) == calls
    now[0] += 61
    service.board(1146)
    assert len(client.board_calls) > calls


def test_stale_board_is_served_when_rzd_fails():
    client = FakeClient()
    now = [NOW]
    service = make_service(client, clock=lambda: now[0])
    service.board(1146)
    client.fail = True
    now[0] += 120
    result = service.board(1146)
    assert result["stale"] is True and len(result["trains"]) == 2


def test_board_without_any_data_raises():
    client = FakeClient()
    client.fail = True
    with pytest.raises(RzdError):
        make_service(client).board(1146)


def test_station_search_filters_and_ranks():
    found = make_service().stations("твер")
    assert [s["id"] for s in found] == [1146, 20006217, 1150]
    assert found[0]["longDistance"] is True and found[2]["longDistance"] is False
    assert make_service().stations("т") == []


def test_client_parses_single_row_and_garbage():
    single = RzdClient(opener=lambda url: json.dumps({"TABLO": {"TABLO_TRAIN": {"TRAIN_NAME": "1"}}}).encode(),
                       context=False)
    assert single.board(1, date(2026, 1, 1)) == [{"TRAIN_NAME": "1"}]
    empty = RzdClient(opener=lambda url: b'{"TABLO":{"_access_allowed":true}}', context=False)
    assert empty.board(1, date(2026, 1, 1)) == []
    broken = RzdClient(opener=lambda url: b"<html>", context=False)
    with pytest.raises(RzdError):
        broken.board(1, date(2026, 1, 1))


def test_client_builds_rzd_urls():
    seen = []
    client = RzdClient(opener=lambda url: seen.append(url) or b'{"features": []}', context=False)
    client.board(428, date(2026, 11, 6))
    client.train_stops("021AJ", "2026-11-07")
    assert seen[0] == "https://www.rzd.ru/ru/page/77731?id=428&date=06.11.2026"
    assert seen[1] == "https://www.rzd.ru/routemap/source/current/train/021AJ/departure/2026-11-07?useTimeZone=true"


@pytest.fixture
def server(tmp_path):
    public = tmp_path / "public"
    (public / "assets").mkdir(parents=True)
    (public / "index.html").write_text("<h1>ok</h1>", encoding="utf-8")
    (public / "assets" / "app.js").write_text("export {}", encoding="utf-8")
    (public / ".secret").write_text("no", encoding="utf-8")
    (tmp_path / "outside.txt").write_text("no", encoding="utf-8")
    httpd = make_server("127.0.0.1", 0, make_service(), public)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status, response.headers.get("Content-Type"), response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type"), error.read()


def test_static_and_api(server):
    status, ctype, body = get(server + "/assets/app.js")
    assert status == 200 and ctype.startswith("text/javascript")
    status, _, body = get(server + "/api/board?station=1146")
    assert status == 200 and json.loads(body)["station"]["id"] == 1146
    status, _, body = get(server + "/api/board?station=abc")
    assert status == 400
    status, _, body = get(server + "/api/stations?q=%D1%82%D0%B2%D0%B5%D1%80")
    assert status == 200 and json.loads(body)["stations"][0]["name"] == "ТВЕРЬ"
    assert get(server + "/api/nope")[0] == 404


def test_hidden_and_outside_files_are_not_served(server):
    assert get(server + "/.secret")[0] == 404
    assert get(server + "/../outside.txt")[0] == 404
    assert get(server + "/assets/")[0] == 404
