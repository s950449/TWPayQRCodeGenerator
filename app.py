import argparse
import csv
import math
from pathlib import Path

from twpay_core import build_transfer_payload, request_online_payload, ValidationError
from twpay_io import reserve_output_path, publish_image, OutputPathError

MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_ROWS = 1000
MAX_CELL = 128


def read_bic_map(path=Path("data/BIC.csv")):
    with Path(path).open(newline="", encoding="utf-8") as handle:
        rows = csv.DictReader(handle)
        if not rows.fieldnames or not {"BIC", "Name"}.issubset(rows.fieldnames):
            raise RuntimeError("BIC.csv 缺少必要欄位")
        result = {}
        for row in rows:
            result[row["BIC"]] = row["Name"]
        return result


def gencode(data_str, bank_name, bank_id, account):
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=4)
    qr.add_data(data_str); img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    width, height = img.size; out = Image.new("RGB", (650, 650), (255, 255, 255))
    out.paste(img, (int((650-width)/2), int((650-height)/2)))
    draw = ImageDraw.Draw(out)
    font = ImageFont.FreeTypeFont("fonts/NotoSansCJKtc-Light.otf", size=24)
    description = f"{bank_name} ({bank_id}) {account}"
    draw.text(((650 - draw.textlength(description, font))/2, 600), description, (0, 0, 0), font=font)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("inputFile", type=Path, help="Input CSV file")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--online", action="store_true", help="Explicitly use the online API")
    mode.add_argument("--offline", action="store_false", dest="online", help=argparse.SUPPRESS)
    parser.set_defaults(online=False)
    parser.add_argument("--output-dir", type=Path, default=Path("."))
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    if args.inputFile.stat().st_size > MAX_CSV_BYTES:
        raise RuntimeError("CSV 檔案過大")
    bic = read_bic_map()
    required = {"Name", "BankID", "Account"}
    with args.inputFile.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise RuntimeError("CSV 缺少必要欄位")
        for index, row in enumerate(reader, 1):
            if index > MAX_ROWS or any(len(str(v or "")) > MAX_CELL for v in row.values()):
                raise RuntimeError("CSV 資料超過限制")
            bank_id, account = row["BankID"], row["Account"]
            amount, memo = row.get("Amount") or None, row.get("Msg") or ""
            if bank_id not in bic:
                raise RuntimeError(f"未知銀行代碼: {bank_id}")
            if args.online:
                import requests
                payload = request_online_payload(bank_id, account, amount, memo, http_get=requests.get)
            else:
                payload = build_transfer_payload(bank_id, account, amount, memo)
            image = gencode(payload, bic[bank_id], bank_id, account)
            reservation = reserve_output_path(args.output_dir, row["Name"])
            publish_image(image, reservation)
            if args.verbose: print(payload)


if __name__ == "__main__":
    main()
