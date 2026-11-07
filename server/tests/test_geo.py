import json
from pathlib import Path

from trainpaper.geo import StationGeo, name_score, pick_stop
from trainpaper.rzd import RzdError

STOPS = [
    {"name": "МОСКВА-ПАССАЖИРСКАЯ-ОКТЯБРЬСКАЯ", "lat": 55.77884, "lon": 37.65372, "arrival": None, "departure": "00:20:00"},
    {"name": "Тверь", "lat": 56.83514, "lon": 35.89296, "arrival": "02:39:00", "departure": "02:41:00"},
    {"name": "Бологое-Московское", "lat": 57.88606, "lon": 34.06095, "arrival": "04:20:00", "departure": "04:21:00"},
    {"name": "Санкт-Петербург-Главный", "lat": 59.92859, "lon": 30.36169, "arrival": "09:00:00", "departure": None},
]


def row(station, begin, end, arrival=None, departure=None, name="X"):
    return {"STATION_ID": station, "BEGIN_STATION_ID": begin, "END_STATION_ID": end, "STATION_NAME": name,
            "DATETIME_ARRIVAL_PLAN_LOCAL": arrival, "DATETIME_DEPARTURE_PLAN_LOCAL": departure,
            "TRAIN_NAME_LAT": "022AJ", "TRAIN_START": "2026-11-07T00:20:00"}


def test_name_score_handles_rzd_abbreviations():
    assert name_score("САНКТ-ПЕТЕРБУРГ-ГЛАВН.", "Санкт-Петербург-Главный") == 1.0
    assert name_score("МОСКВА ОКТЯБРЬСКАЯ", "МОСКВА-ПАССАЖИРСКАЯ-ОКТЯБРЬСКАЯ") == 1.0
    assert name_score("ТВЕРЬ", "Бологое-Московское") == 0.0


def test_terminal_stations_are_first_and_last_stop():
    assert pick_stop(STOPS, row(1108, 1108, 428), "МОСКВА ОКТЯБРЬСКАЯ") is STOPS[0]
    assert pick_stop(STOPS, row(428, 1108, 428), "САНКТ-ПЕТЕРБУРГ-ГЛАВН.") is STOPS[-1]


def test_transit_station_matched_by_time():
    found = pick_stop(STOPS, row(1146, 1108, 428, "2026-11-07T02:39:00", "2026-11-07T02:41:00"), "ТВЕРЬ")
    assert found is STOPS[1]
    # время не совпало и название чужое — лучше ничего, чем чужие координаты
    assert pick_stop(STOPS, row(7, 1108, 428, "2026-11-07T05:00:00"), "ВЫШНИЙ ВОЛОЧЕК") is None


class FakeClient:
    def __init__(self, stops=STOPS, fail=False):
        self.calls = 0
        self.stops, self.fail = stops, fail

    def train_stops(self, train_lat, start):
        self.calls += 1
        if self.fail:
            raise RzdError("down")
        return self.stops


def test_resolve_uses_list_then_rzd_then_cache(tmp_path):
    stations = tmp_path / "stations.json"
    stations.write_text(json.dumps({"stations": [{"id": 428, "lat": 59.9, "lon": 30.3}]}), encoding="utf-8")
    cache = tmp_path / "geo.json"
    client = FakeClient()
    geo = StationGeo(client, stations, cache)

    assert geo.resolve(428, "САНКТ-ПЕТЕРБУРГ-ГЛАВН.", [row(428, 1108, 428)])["source"] == "list"
    assert client.calls == 0

    found = geo.resolve(1146, "ТВЕРЬ", [row(1146, 1108, 428, "2026-11-07T02:39:00", "2026-11-07T02:41:00")])
    assert found == {"lat": 56.83514, "lon": 35.89296, "source": "rzd-routemap"}
    assert json.loads(cache.read_text(encoding="utf-8"))["1146"]["lat"] == 56.83514

    again = StationGeo(FakeClient(fail=True), stations, cache)
    assert again.resolve(1146, "ТВЕРЬ", [])["lat"] == 56.83514


def test_failed_lookup_is_not_retried_immediately(tmp_path):
    client = FakeClient(fail=True)
    geo = StationGeo(client, Path(tmp_path / "none.json"), tmp_path / "geo.json")
    assert geo.resolve(5, "ГДЕ-ТО", [row(5, 5, 9)]) is None
    calls = client.calls
    assert geo.resolve(5, "ГДЕ-ТО", [row(5, 5, 9)]) is None
    assert client.calls == calls
