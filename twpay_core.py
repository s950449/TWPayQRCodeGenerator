"""Dependency-light validation and online boundary for Taiwan Pay transfers."""
import json
import re
from dataclasses import dataclass

AMOUNT_MAX = 9_999_999_999_999_999
MAX_API_RESPONSE_BYTES = 1_048_576
DEFAULT_API_URL = "https://i-tw.org/twpay/api"
_RESERVED = re.compile(r"[&=?#%\x00-\x1f\x7f]")


class ValidationError(ValueError):
    pass


@dataclass(frozen=True)
class TransferFields:
    bank_id: str
    account: str
    amount: str | None
    memo: str


def _text(value, field):
    text = "" if value is None else str(value)
    if text != text.strip() or len(text) > 128:
        raise ValidationError(f"invalid {field}")
    return text


def validate_transfer(bank_id, account, amount=None, memo=""):
    bank = "" if bank_id is None else str(bank_id)
    acct = "" if account is None else str(account)
    if bank != bank.strip() or not re.fullmatch(r"[0-9]{3}", bank):
        raise ValidationError("invalid bank_id")
    if acct != acct.strip() or not re.fullmatch(r"[0-9]{1,16}", acct):
        raise ValidationError("invalid account")
    acct = acct.zfill(16)
    raw_amount = "" if amount is None else str(amount)
    if raw_amount:
        if raw_amount != raw_amount.strip() or not re.fullmatch(r"[1-9][0-9]*", raw_amount):
            raise ValidationError("invalid amount")
        if int(raw_amount) > AMOUNT_MAX:
            raise ValidationError("invalid amount")
    memo_text = _text(memo, "memo")
    if len(memo_text) > 19 or _RESERVED.search(memo_text):
        raise ValidationError("invalid memo")
    return TransferFields(bank, acct, raw_amount or None, memo_text)


def build_transfer_payload(bank_id, account, amount=None, memo=""):
    fields = validate_transfer(bank_id, account, amount, memo)
    payload = f"TWQRP://{fields.bank_id}NTTransfer/158/02/V1?D6={fields.account}&D5={fields.bank_id}&D10=901"
    if fields.amount is not None:
        payload += f"&D1={fields.amount}00"
    return f"{payload}&D9={fields.memo}"


def parse_transfer_payload(payload):
    match = re.fullmatch(r"TWQRP://([0-9]{3})NTTransfer/158/02/V1\?(.+)", str(payload))
    if not match:
        raise ValidationError("invalid payload")
    fields = {}
    for pair in match.group(2).split("&"):
        bits = pair.split("=")
        if len(bits) != 2 or bits[0] not in {"D1", "D5", "D6", "D9", "D10"} or bits[0] in fields:
            raise ValidationError("invalid fields")
        fields[bits[0]] = bits[1]
    if fields.get("D5") != match.group(1) or not re.fullmatch(r"[0-9]{16}", fields.get("D6", "")) or fields.get("D10") != "901" or "D9" not in fields:
        raise ValidationError("invalid required fields")
    raw = fields.get("D1")
    amount = None
    if raw is not None:
        if not raw.endswith("00") or not re.fullmatch(r"[1-9][0-9]*", raw[:-2]) or int(raw[:-2]) > AMOUNT_MAX:
            raise ValidationError("invalid amount")
        amount = raw[:-2]
    if len(fields["D9"]) > 19 or _RESERVED.search(fields["D9"]):
        raise ValidationError("invalid memo")
    return {"bank_id": match.group(1), "account": fields["D6"], "amount": amount, "memo": fields["D9"]}


def request_online_payload(bank_id, account, amount=None, memo="", *, http_get, api_url=DEFAULT_API_URL):
    expected = build_transfer_payload(bank_id, account, amount, memo)
    params = {"Bank": bank_id, "Acc": account, "Msg": memo}
    if amount is not None and amount != "":
        params["Amount"] = amount
    response = http_get(api_url, params=params, timeout=10, allow_redirects=False, stream=True)
    if getattr(response, "status_code", None) != 200:
        raise ValidationError("online request failed")
    try:
        if int(response.headers.get("Content-Length", "0")) > MAX_API_RESPONSE_BYTES:
            raise ValidationError("online response too large")
    except (TypeError, ValueError):
        raise ValidationError("invalid response length")
    data = b""
    for chunk in response.iter_content(8192):
        data += chunk
        if len(data) > MAX_API_RESPONSE_BYTES:
            raise ValidationError("online response too large")
    try:
        obj = json.loads(data.decode("utf-8"))
        returned = obj["String"]
        if obj.get("Success") != "1" or parse_transfer_payload(returned) != parse_transfer_payload(expected):
            raise ValidationError("online payload mismatch")
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        raise ValidationError("invalid online response")
    return returned
