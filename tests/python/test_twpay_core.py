import json
from unittest import TestCase

from twpay_core import (ValidationError, build_transfer_payload,
                        parse_transfer_payload, request_online_payload)


class FakeResponse:
    status_code = 200
    headers = {"Content-Length": "32"}

    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size):
        yield self.payload.encode("utf-8")


class TransferCoreTests(TestCase):
    def test_preserves_maximum_amount_exactly(self):
        payload = build_transfer_payload("004", "123", "9999999999999999", "")
        self.assertIn("D1=999999999999999900", payload)

    def test_rejects_query_injection(self):
        with self.assertRaises(ValidationError):
            build_transfer_payload("004", "123", None, "&D1=1")

    def test_rejects_online_payload_for_another_account(self):
        wrong = build_transfer_payload("004", "999", None, "")
        with self.assertRaises(ValidationError):
            request_online_payload("004", "123", None, "", http_get=lambda *args, **kwargs: FakeResponse(json.dumps({"Success": "1", "String": wrong})))

    def test_account_is_padded_and_round_trips(self):
        payload = build_transfer_payload("004", "123", None, "memo")
        self.assertEqual(parse_transfer_payload(payload), {"bank_id": "004", "account": "0000000000000123", "amount": None, "memo": "memo"})

    def test_duplicate_fields_rejected(self):
        with self.assertRaises(ValidationError):
            parse_transfer_payload("TWQRP://004NTTransfer/158/02/V1?D6=0000000000000123&D6=0000000000000123&D5=004&D10=901&D9=")

    def test_online_request_is_bounded_and_exact(self):
        expected = build_transfer_payload("004", "123", None, "")
        calls = []
        def get(url, **kwargs):
            calls.append((url, kwargs))
            return FakeResponse(json.dumps({"Success": "1", "String": expected}))
        self.assertEqual(request_online_payload("004", "123", None, "", http_get=get), expected)
        self.assertEqual(calls[0][0], "https://i-tw.org/twpay/api")
        self.assertEqual(calls[0][1], {"params": {"Bank": "004", "Acc": "123", "Msg": ""}, "timeout": 10, "allow_redirects": False, "stream": True})
