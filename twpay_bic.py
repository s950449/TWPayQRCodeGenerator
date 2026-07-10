"""Bounded, validated and atomic BIC dataset refresh."""
import csv
import io
import os
import tempfile
from pathlib import Path

CSV_URL = "https://www.fisc.com.tw/TC/OPENDATA/Comm1_MEMBER.csv"
MAX_BIC_DOWNLOAD_BYTES = 5 * 1024 * 1024
SOURCE_HEADERS = ("業務別", "銀行代號/BIC/總機構代碼", "金融機構名稱")
SERVICE = "跨行自動化服務機器業務(金融卡)"


class BicUpdateError(ValueError):
    pass


def _read_limited(response):
    headers = getattr(response, "headers", {}) or {}
    try:
        length = int(headers.get("Content-Length", "0") or 0)
    except (TypeError, ValueError):
        raise BicUpdateError("無效下載大小")
    if length < 0 or length > MAX_BIC_DOWNLOAD_BYTES:
        raise BicUpdateError("BIC 下載檔案過大")
    chunks = getattr(response, "iter_content", None)
    if not callable(chunks):
        raise BicUpdateError("HTTP 回應無效")
    data = bytearray()
    for chunk in chunks(64 * 1024):
        if not isinstance(chunk, (bytes, bytearray)):
            raise BicUpdateError("HTTP 回應無效")
        data.extend(chunk)
        if len(data) > MAX_BIC_DOWNLOAD_BYTES:
            raise BicUpdateError("BIC 下載檔案過大")
    return bytes(data)


def parse_source_bic_csv(content):
    try:
        text = bytes(content).decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text, newline=""))
        if tuple(reader.fieldnames or ()) != SOURCE_HEADERS:
            raise BicUpdateError("BIC 來源欄位不符")
        result = {}
        for row in reader:
            if row.get("業務別") != SERVICE:
                continue
            bic, name = (row.get(SOURCE_HEADERS[1], "") or "").strip(), (row.get(SOURCE_HEADERS[2], "") or "").strip()
            if len(bic) == 3 and bic.isdigit() and name:
                result[bic] = name
        if not result:
            raise BicUpdateError("BIC 來源沒有有效資料")
        return result
    except UnicodeDecodeError as exc:
        raise BicUpdateError("BIC 來源編碼不符") from exc


def read_bic_map(path):
    try:
        with Path(path).open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if tuple(reader.fieldnames or ()) != ("BIC", "Name"):
                raise BicUpdateError("BIC 檔案欄位不符")
            result = {}
            for row in reader:
                bic, name = (row.get("BIC", "") or "").strip(), (row.get("Name", "") or "").strip()
                if len(bic) != 3 or not bic.isdigit() or not name:
                    raise BicUpdateError("BIC 檔案資料不符")
                result[bic] = name
            if not result:
                raise BicUpdateError("BIC 檔案沒有資料")
            return result
    except OSError as exc:
        raise BicUpdateError("無法讀取 BIC 檔案") from exc


def _write_atomic(destination, mapping):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=destination.parent, delete=False) as fh:
            temp_name = fh.name
            writer = csv.DictWriter(fh, fieldnames=("BIC", "Name"))
            writer.writeheader()
            for bic, name in sorted(mapping.items()):
                writer.writerow({"BIC": bic, "Name": name})
            fh.flush(); os.fsync(fh.fileno())
        os.replace(temp_name, destination)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def update_bic_dataset(http_get, destination: Path, url=CSV_URL):
    destination = Path(destination)
    lock = destination.with_suffix(destination.suffix + ".lock")
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600); os.close(fd)
    except FileExistsError as exc:
        raise BicUpdateError("BIC 更新進行中") from exc
    try:
        response = http_get(url, timeout=10, allow_redirects=False, stream=True)
        if getattr(response, "status_code", 200) != 200:
            raise BicUpdateError("BIC 下載失敗")
        raise_for_status = getattr(response, "raise_for_status", None)
        if callable(raise_for_status): raise_for_status()
        mapping = parse_source_bic_csv(_read_limited(response))
        _write_atomic(destination, mapping)
        return mapping
    except BicUpdateError:
        raise
    except Exception as exc:
        raise BicUpdateError("BIC 更新失敗") from exc
    finally:
        lock.unlink(missing_ok=True)
