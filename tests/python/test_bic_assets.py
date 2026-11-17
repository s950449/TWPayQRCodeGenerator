import json
import sys
import urllib.error
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import bic_assets as bic
from publish_bic_update import publish, validate_bundle
from twpay_bic import (
    CSV_URL, BicUpdateError, _NoRedirect, parse_source_bic_csv, read_bic_map,
    stdlib_http_get,
)


class BicAssetTests(TestCase):
    def setUp(self):
        self.mapping = read_bic_map(ROOT / bic.CSV_PATH)
        self.timestamp = "2026-11-17T00:00:00+00:00"

    def write_bundle(self, directory, mapping=None):
        for name, content in bic.assets(mapping or self.mapping, self.timestamp).items():
            path = Path(directory) / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)

    def test_stable_render_preserves_zeroes_and_has_valid_manifest(self):
        content = bic.assets(self.mapping, self.timestamp)
        self.assertIn(b"004,", content[bic.CSV_PATH])
        manifest = json.loads(content[bic.MANIFEST_PATH])
        self.assertEqual(manifest["record_count"], len(self.mapping))
        self.assertEqual(content, bic.assets(self.mapping, self.timestamp))

    def test_js_names_are_encoded_not_executable(self):
        data = bic.js_bytes({"004": '銀行"; globalThis.pwned = true; //</script>\u2028'})
        rows = json.loads(data.decode().split("const BIC_LIST = ", 1)[1][:-2])
        self.assertEqual(rows[0]["bic"], "004")
        self.assertIn(b'\\"', data)
        self.assertIn(b"\\u2028", data)

    def test_large_removal_and_small_dataset_fail(self):
        with self.assertRaises(BicUpdateError):
            bic.validate_change(self.mapping, dict(list(self.mapping.items())[:50]))
        with self.assertRaises(BicUpdateError):
            bic.validate_change({}, {"004": "銀行"})

    def test_duplicate_and_non_ascii_codes_rejected(self):
        header = "業務別,銀行代號/BIC/總機構代碼,金融機構名稱\n"
        row = "跨行自動化服務機器業務(金融卡),004,銀行\n"
        for source in [header + row + row, header + row.replace("004", "００４")]:
            with self.assertRaises(BicUpdateError):
                parse_source_bic_csv(source.encode())

    def test_both_observed_fisc_header_schemas_are_explicitly_supported(self):
        row = "跨行自動化服務機器業務(金融卡),004,臺灣銀行\n"
        for code_header in ["銀行代號/BIC", "銀行代號/BIC/總機構代碼"]:
            source = f"業務別,{code_header},金融機構名稱\n" + row
            self.assertEqual(parse_source_bic_csv(source.encode()), {"004": "臺灣銀行"})
        with self.assertRaises(BicUpdateError):
            parse_source_bic_csv(("業務別,代碼,金融機構名稱\n" + row).encode())

    def test_downloader_refuses_custom_hosts_and_redirects(self):
        for url, redirects in [(CSV_URL, True), ("https://attacker.invalid/", False)]:
            with self.assertRaises(BicUpdateError):
                stdlib_http_get(url, timeout=10, allow_redirects=redirects, stream=True)
        self.assertIsNone(_NoRedirect().redirect_request(None, None, 302, "", {}, CSV_URL))

    def test_downloader_reports_http_failure_without_reading_error_body(self):
        with patch("twpay_bic.urllib.request.build_opener") as build:
            build.return_value.open.side_effect = urllib.error.HTTPError(
                CSV_URL, 403, "Forbidden", {}, None,
            )
            with self.assertRaisesRegex(BicUpdateError, "HTTP 403"):
                stdlib_http_get(CSV_URL, timeout=10, allow_redirects=False, stream=True)

    def test_unchanged_mapping_reuses_manifest_timestamp(self):
        with TemporaryDirectory() as directory:
            self.write_bundle(directory)
            self.assertEqual(bic.existing_timestamp(Path(directory), self.mapping), self.timestamp)

    def test_checked_in_assets_match(self):
        content = bic.assets(self.mapping, bic.existing_timestamp(ROOT, self.mapping))
        for name, expected in content.items():
            self.assertEqual((ROOT / name).read_bytes(), expected, name)

    def test_valid_bundle_is_reconstructed(self):
        with TemporaryDirectory() as directory:
            self.write_bundle(directory)
            previous, current, content = validate_bundle(Path(directory))
            self.assertEqual(previous, current)
            self.assertEqual(content[bic.CSV_PATH], bic.csv_bytes(self.mapping))

    def test_artifact_js_injection_is_rejected(self):
        with TemporaryDirectory() as directory:
            self.write_bundle(directory)
            (Path(directory) / bic.JS_PATH).write_text("process.exit(0)")
            with self.assertRaisesRegex(ValueError, "content mismatch"):
                validate_bundle(Path(directory))

    def test_artifact_extra_file_symlink_and_size_rejected(self):
        for attack in ["extra", "symlink", "oversize"]:
            with self.subTest(attack=attack), TemporaryDirectory() as directory:
                self.write_bundle(directory)
                root = Path(directory)
                if attack == "extra":
                    (root / "payload.py").write_text("bad")
                elif attack == "symlink":
                    (root / "link").symlink_to(ROOT)
                else:
                    (root / bic.CSV_PATH).write_bytes(b"x" * (128 * 1024 + 1))
                with self.assertRaises(ValueError):
                    validate_bundle(root)

    def test_manifest_tampering_rejected(self):
        with TemporaryDirectory() as directory:
            self.write_bundle(directory)
            path = Path(directory) / bic.MANIFEST_PATH
            manifest = json.loads(path.read_text())
            manifest["source"] = "https://attacker.invalid/"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "content mismatch"):
                validate_bundle(Path(directory))

    def test_unchanged_data_does_not_call_api(self):
        class NoAPI:
            def request(self, *args, **kwargs):
                raise AssertionError("API should not be called")
        publish(NoAPI(), "a" * 40, self.mapping, self.mapping, {})

    def test_advanced_main_fails_before_any_write(self):
        class AdvancedMain:
            def request(self, method, path, *args, **kwargs):
                if method != "GET":
                    raise AssertionError("No writes allowed")
                return {"object": {"sha": "b" * 40}}
        with self.assertRaisesRegex(ValueError, "main advanced"):
            publish(AdvancedMain(), "a" * 40, {}, self.mapping, {})

    def test_bot_branch_with_code_changes_is_rejected(self):
        class PoisonedBranch:
            def request(self, method, path, *args, **kwargs):
                if method != "GET":
                    raise AssertionError("No writes allowed")
                if path.startswith("compare/"):
                    return {"files": [{"filename": ".github/workflows/test.yml"}], "ahead_by": 1}
                return {"object": {"sha": "a" * 40}}
        with self.assertRaisesRegex(ValueError, "not data-only"):
            publish(PoisonedBranch(), "a" * 40, {}, self.mapping, {})

    def test_publisher_writes_only_allowlisted_paths_and_never_force_pushes(self):
        class RecordingAPI:
            def __init__(self, existing):
                self.existing = existing
                self.calls = []

            def request(self, method, path, payload=None, **kwargs):
                self.calls.append((method, path, payload))
                if path == "git/ref/heads/main":
                    return {"object": {"sha": "a" * 40}}
                if path == "git/ref/heads/automation/update-bic":
                    return {"object": {"sha": "b" * 40}} if self.existing else None
                if path.startswith("compare/"):
                    return {"files": [{"filename": bic.CSV_PATH}], "ahead_by": 1}
                if path.startswith("git/commits/"):
                    return {"tree": {"sha": "old-tree"}}
                if path == "git/blobs":
                    return {"sha": "blob"}
                if path == "git/trees":
                    return {"sha": "new-tree"}
                if path == "git/commits":
                    return {"sha": "c" * 40}
                if path.startswith("pulls?"):
                    return [{"number": 1}] if self.existing else []
                return {}

        for existing in [False, True]:
            with self.subTest(existing=existing):
                api = RecordingAPI(existing)
                publish(api, "a" * 40, {}, self.mapping, bic.assets(self.mapping, self.timestamp))
                writes = [(path, payload) for method, path, payload in api.calls if method != "GET"]
                tree = next(payload for path, payload in writes if path == "git/trees")
                self.assertEqual({entry["path"] for entry in tree["tree"]}, set(bic.ASSET_PATHS))
                self.assertEqual(tree["base_tree"], "old-tree")
                commit = next(payload for path, payload in writes if path == "git/commits")
                self.assertIn("a" * 40, commit["parents"])
                if existing:
                    self.assertIn("b" * 40, commit["parents"])
                    update = next(payload for path, payload in writes
                                  if path == "git/refs/heads/automation/update-bic")
                    self.assertFalse(update["force"])
                self.assertFalse(any(path == "git/refs/heads/main" for path, _ in writes))
