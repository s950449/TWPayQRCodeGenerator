"""Safe, atomic publication of generated QR images."""
from dataclasses import dataclass
import os
from pathlib import Path
import re
import tempfile


class OutputPathError(ValueError):
    pass


def validate_output_stem(stem: str) -> str:
    value = str(stem or "")
    if not value or value in {".", ".."} or Path(value).is_absolute() or "/" in value or "\\" in value:
        raise OutputPathError("無效輸出檔名")
    if len(value) > 100 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise OutputPathError("無效輸出檔名")
    return value


@dataclass
class Reservation:
    target: Path
    lock: Path
    def release(self):
        self.lock.unlink(missing_ok=True)


def reserve_output_path(output_dir: Path, stem: str) -> Reservation:
    normalized = validate_output_stem(stem)
    directory = Path(output_dir).resolve(strict=True)
    if not directory.is_dir():
        raise OutputPathError("輸出目錄不存在")
    for number in range(10_000):
        suffix = "" if number == 0 else f"-{number}"
        target = directory / f"{normalized}{suffix}.png"
        lock = directory / f".{normalized}{suffix}.png.lock"
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            continue
        os.close(fd)
        if target.exists():
            lock.unlink(missing_ok=True)
            continue
        return Reservation(target, lock)
    raise OutputPathError("無法保留唯一輸出檔名")


def publish_image(image, reservation: Reservation) -> Path:
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=reservation.target.parent, suffix=".png", delete=False) as tmp:
            temp_name = tmp.name
        image.save(temp_name, format="PNG")
        os.replace(temp_name, reservation.target)
        temp_name = None
        return reservation.target
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)
        reservation.release()
