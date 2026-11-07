"""Запуск без установки пакета: python server/run.py
Сервер написан только на стандартной библиотеке, виртуальное окружение не обязательно."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from trainpaper.__main__ import main  # noqa: E402

main()
