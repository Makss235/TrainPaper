import json

import pytest

from trainpaper.weather import TTL_S, WeatherError, WeatherService

ANSWER = json.dumps({"current": {"time": "2026-11-08T12:00", "weather_code": 63, "precipitation": 1.8, "cloud_cover": 100}}).encode()


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make(answer=ANSWER):
    calls = []

    def opener(url):
        calls.append(url)
        if isinstance(answer, Exception):
            raise answer
        return answer

    clock = Clock()
    return WeatherService(opener=opener, clock=clock), calls, clock


def test_current_parses_and_rounds_coordinates():
    service, calls, _ = make()
    result = service.current(59.934, 30.358)
    assert result["code"] == 63 and result["precipitation"] == 1.8 and result["cloudCover"] == 100
    assert result["cached"] is False
    assert "latitude=59.9" in calls[0] and "longitude=30.4" in calls[0]


def test_cache_for_half_an_hour_per_rounded_point():
    service, calls, clock = make()
    service.current(59.93, 30.36)
    assert service.current(59.94, 30.36)["cached"] is True      # та же точка после округления
    assert len(calls) == 1
    clock.t += TTL_S + 1
    service.current(59.93, 30.36)
    assert len(calls) == 2


def test_failure_raises_and_then_serves_stale_copy():
    service, calls, clock = make(OSError("нет сети"))
    with pytest.raises(WeatherError):
        service.current(55.75, 37.62)
    ok, _, clock2 = make()
    ok.current(55.75, 37.62)
    clock2.t += TTL_S + 1
    ok.opener = lambda url: (_ for _ in ()).throw(OSError("нет сети"))
    stale = ok.current(55.75, 37.62)
    assert stale["stale"] is True and stale["code"] == 63


def test_bad_coordinates():
    service, _, _ = make()
    with pytest.raises(WeatherError):
        service.current(120, 0)
