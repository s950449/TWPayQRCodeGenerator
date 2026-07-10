from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from twpay_bic import BicUpdateError, parse_source_bic_csv, read_bic_map, update_bic_dataset


class FakeResponse:
    headers = {"Content-Length": "7"}
    status_code = 200
    def __init__(self, payload): self.payload = payload
    def raise_for_status(self): return None
    def iter_content(self, chunk_size): yield self.payload

    def close(self): self.closed = True


SOURCE = "業務別,銀行代號/BIC/總機構代碼,金融機構名稱\n跨行自動化服務機器業務(金融卡),004,臺灣銀行\n"


class BicUpdateTests(TestCase):
    def test_invalid_download_keeps_previous_normalized_file(self):
        with TemporaryDirectory() as directory:
            destination = Path(directory) / "BIC.csv"
            destination.write_text("BIC,Name\n004,臺灣銀行\n", encoding="utf-8")
            with self.assertRaises(BicUpdateError):
                update_bic_dataset(lambda *args, **kwargs: FakeResponse(b"not,csv"), destination)
            self.assertEqual(read_bic_map(destination), {"004": "臺灣銀行"})

    def test_valid_download_is_normalized(self):
        with TemporaryDirectory() as directory:
            destination = Path(directory) / "BIC.csv"
            result = update_bic_dataset(lambda *args, **kwargs: FakeResponse(SOURCE.encode()), destination)
            self.assertEqual(result, {"004": "臺灣銀行"})
            self.assertEqual(read_bic_map(destination), result)

    def test_oversized_declared_or_stream_download_rejected(self):
        class Huge(FakeResponse):
            headers = {"Content-Length": str(6 * 1024 * 1024)}
        with TemporaryDirectory() as directory:
            with self.assertRaises(BicUpdateError):
                update_bic_dataset(lambda *args, **kwargs: Huge(b"x"), Path(directory) / "BIC.csv")

    def test_source_headers_and_empty_mapping_required(self):
        with self.assertRaises(BicUpdateError):
            parse_source_bic_csv(b"a,b,c\n1,2,3\n")
        with self.assertRaises(BicUpdateError):
            parse_source_bic_csv("業務別,銀行代號/BIC/總機構代碼,金融機構名稱\n其他,004,銀行\n".encode())

    def test_missing_http_status_is_rejected(self):
        class Malformed(FakeResponse):
            status_code = None
        with TemporaryDirectory() as directory:
            with self.assertRaises(BicUpdateError):
                update_bic_dataset(lambda *args, **kwargs: Malformed(SOURCE.encode()), Path(directory) / "BIC.csv")
