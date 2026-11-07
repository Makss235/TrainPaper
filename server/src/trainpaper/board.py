"""Строки табло РЖД → компактный список поездов для страниц.

Что важно знать о данных rzd.ru:

- прибытие это или отправление, видно не по статусу, а по маршруту: поезд начинает путь
  на этой станции — отправление, заканчивает — прибытие, иначе он транзитный;
- TRAIN_MOTION_STATUS_NAME — живой статус: UNDEF (нет данных), WAITING (в пути),
  COMMING (ожидается прибытие), IN (прибыл), DEPARTING (ожидается отправление), OUT (отправлен);
- время *_MSK — московское (UTC+3), DIFF_TIME_MSK_LOCAL — разница местного времени с МСК в часах;
- *_ACTUAL появляется, когда событие уже случилось; до этого есть только план и
  TRAIN_CURRENT_STATION_TIME_DELAY — опоздание (минуты, меньше нуля — идёт с опережением).
"""

from datetime import datetime, timedelta, timezone

MSK = timezone(timedelta(hours=3))
STATUSES = ("UNDEF", "WAITING", "COMMING", "IN", "DEPARTING", "OUT")
TYPES = {"ДС": "long", "ПРИГОРОД": "suburban"}


def parse_msk(value) -> int | None:
    """'2026-11-06T00:20:00' (МСК) → секунды Unix."""
    if not isinstance(value, str) or len(value) < 16:
        return None
    try:
        moment = datetime.fromisoformat(value[:19])
    except ValueError:
        return None
    return int(moment.replace(tzinfo=MSK).timestamp())


def _text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def train_kind(row: dict) -> str:
    station = row.get("STATION_ID")
    begins = station is not None and row.get("BEGIN_STATION_ID") == station
    ends = station is not None and row.get("END_STATION_ID") == station
    if begins and not ends:
        return "departure"
    if ends and not begins:
        return "arrival"
    if begins and ends:              # кольцевой маршрут: для пассажира это отправление
        return "departure"
    return "transit"


def _event(row: dict, prefix: str, status: str, delay: int | None, departure: bool) -> dict | None:
    plan = parse_msk(row.get(f"DATETIME_{prefix}_PLAN_MSK"))
    if plan is None:
        return None
    actual = parse_msk(row.get(f"DATETIME_{prefix}_ACTUAL_MSK"))
    expected = actual
    if expected is None:
        expected = plan
        if delay and status in ("WAITING", "COMMING", "IN", "DEPARTING"):
            # отправиться раньше расписания поезд не может, прибыть — может
            expected = plan + (max(delay, 0) if departure else delay) * 60
    return {"plan": plan, "actual": actual, "expected": expected}


def normalize(row: dict) -> dict | None:
    if row.get("IS_NON_STOP_STATION"):
        return None
    number = _text(row.get("TRAIN_NAME"))
    if not number:
        return None
    kind = train_kind(row)
    status = row.get("TRAIN_MOTION_STATUS_NAME")
    status = status if status in STATUSES else "UNDEF"
    delay = _int(row.get("TRAIN_CURRENT_STATION_TIME_DELAY"))
    arrival = None if kind == "departure" else _event(row, "ARRIVAL", status, delay, departure=False)
    departure = None if kind == "arrival" else _event(row, "DEPARTURE", status, delay, departure=True)
    if arrival is None and departure is None:
        return None
    change = _text(row.get("TRAIN_NAME_CHANGE"))
    extra = row.get("ADDITIONAL_CARS")
    start = _text(row.get("TRAIN_START")) or ""
    return {
        "id": f"{row.get('TRAIN_ID') or row.get('ID')}:{start[:10]}",
        "kind": kind,
        "number": number,
        "numberChange": change if change and change != number else None,
        "numberLat": _text(row.get("TRAIN_NAME_LAT")),
        "start": start[:10] or None,
        "from": _text(row.get("BEGIN_STATION_NAME")) or "",
        "to": _text(row.get("END_STATION_NAME")) or "",
        "arrival": arrival,
        "departure": departure,
        "platform": _text(row.get("PLATFORM_NUMBER")),
        "track": _text(row.get("PATH_NUMBER")),
        "status": status,
        "delay": delay,
        "position": _text(row.get("TRAIN_CURRENT_STATION_NAME")),
        "positionTime": parse_msk(row.get("TRAIN_CURRENT_STATION_DATETIME_ACTUAL_MSK")),
        "type": TYPES.get(row.get("TRAIN_DISTANCE_TYPE"), "other"),
        "extraCars": {
            "from": _text(extra.get("CAR_BEGIN_STATION_NAME")),
            "to": _text(extra.get("CAR_END_STATION_NAME")),
            "number": _text(extra.get("CAR_TRAIN_NUMBER")),
        } if isinstance(extra, dict) else None,
    }


def main_time(train: dict) -> int:
    event = train["arrival"] if train["kind"] == "arrival" else (train["departure"] or train["arrival"])
    return event["expected"]


def station_info(rows: list[dict], station_id: int) -> dict:
    name = next((row.get("STATION_NAME") for row in rows if row.get("STATION_NAME")), None)
    diff = next((row.get("DIFF_TIME_MSK_LOCAL") for row in rows
                 if isinstance(row.get("DIFF_TIME_MSK_LOCAL"), (int, float))), None)
    return {
        "id": station_id,
        "name": name,
        # местное время = МСК + разница; храним смещение от UTC в минутах
        "utcOffset": int(round((3 + diff) * 60)) if diff is not None else None,
    }


def build_trains(rows: list[dict], now: int, past_s: int, future_s: int, suburban: bool = False) -> list[dict]:
    trains, seen = [], set()
    for row in rows:
        train = normalize(row)
        if train is None or train["id"] in seen:
            continue
        if train["type"] == "suburban" and not suburban:
            continue
        seen.add(train["id"])
        if now - past_s <= main_time(train) <= now + future_s:
            trains.append(train)
    trains.sort(key=lambda train: (main_time(train), train["number"]))
    return trains
