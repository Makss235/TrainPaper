import json
from pathlib import Path

import pytest

from trainpaper.board import build_trains, normalize, parse_msk, station_info, train_kind

ROWS = json.loads((Path(__file__).parent / "data" / "board_rows.json").read_text(encoding="utf-8"))


def test_moscow_time_is_parsed_as_utc_plus_3():
    assert parse_msk("2026-11-07T03:00:00") == 1794009600      # 2026-11-07 00:00 UTC
    assert parse_msk(None) is None
    assert parse_msk("garbage") is None


@pytest.mark.parametrize("name, kind", [
    ("departure", "departure"), ("arrival", "arrival"),
    ("transit_departing", "transit"), ("transit_waiting", "transit"),
])
def test_kind_comes_from_route_not_status(name, kind):
    assert train_kind(ROWS[name]) == kind


def test_departure_has_only_departure_time_and_number_change():
    train = normalize(ROWS["departure"])
    assert train["kind"] == "departure"
    assert train["arrival"] is None
    assert train["departure"]["plan"] == parse_msk("2026-11-06T00:35:00")
    assert train["number"] == "119А" and train["numberChange"] == "120А"
    assert train["platform"] == "6" and train["track"] == "9"
    assert train["extraCars"] == {"from": "САНКТ-ПЕТЕРБУРГ-ГЛАВН.", "to": "СТАРЫЙ ОСКОЛ", "number": "319М"}
    assert train["type"] == "long"


def test_arrival_uses_actual_time():
    train = normalize(ROWS["arrival"])
    assert train["kind"] == "arrival" and train["departure"] is None
    assert train["arrival"]["actual"] == parse_msk("2026-11-06T00:39:00")
    assert train["arrival"]["expected"] == train["arrival"]["actual"]
    assert train["numberChange"] is None


def test_waiting_train_expected_time_includes_delay():
    train = normalize(ROWS["transit_waiting"])        # опаздывает на 6 минут
    assert train["arrival"]["expected"] == train["arrival"]["plan"] + 6 * 60
    assert train["departure"]["expected"] == train["departure"]["plan"] + 6 * 60
    assert train["status"] == "WAITING" and train["position"] == "ЛИХОБОРЫ"


def test_train_ahead_of_schedule_does_not_depart_early():
    train = normalize(ROWS["transit_departing"])      # прибыл на 3 минуты раньше
    assert train["arrival"]["expected"] == parse_msk("2026-11-07T02:36:00")
    assert train["departure"]["expected"] == train["departure"]["plan"]


def test_suburban_trains_are_filtered_by_default():
    rows = list(ROWS.values())
    now = parse_msk("2026-11-07T02:40:00")
    numbers = {train["number"] for train in build_trains(rows, now, 10 ** 7, 10 ** 7)}
    assert str(ROWS["suburban"]["TRAIN_NAME"]) not in numbers
    with_suburban = {train["number"] for train in build_trains(rows, now, 10 ** 7, 10 ** 7, suburban=True)}
    assert str(ROWS["suburban"]["TRAIN_NAME"]) in with_suburban


def test_window_sorting_and_dedup():
    rows = [ROWS["transit_waiting"], ROWS["transit_departing"], ROWS["transit_departing"]]
    now = parse_msk("2026-11-07T02:40:00")
    trains = build_trains(rows, now, 3600, 3600)
    assert [train["number"] for train in trains] == ["022А", "049С"]
    assert build_trains(rows, now + 10 * 3600, 3600, 3600) == []


def test_non_stop_rows_are_skipped():
    assert normalize({**ROWS["transit_waiting"], "IS_NON_STOP_STATION": True}) is None


def test_station_offset_from_diff_hours():
    rows = [{**ROWS["arrival"], "DIFF_TIME_MSK_LOCAL": 4}]
    assert station_info(rows, 428) == {"id": 428, "name": "САНКТ-ПЕТЕРБУРГ-ГЛАВН.", "utcOffset": 420}
    assert station_info([], 1)["utcOffset"] is None
