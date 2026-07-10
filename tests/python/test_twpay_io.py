from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from twpay_io import OutputPathError, reserve_output_path, publish_image


class OutputPathTests(TestCase):
    def test_rejects_traversal_name(self):
        with TemporaryDirectory() as directory:
            with self.assertRaises(OutputPathError):
                reserve_output_path(Path(directory), "../../owned")

    def test_reserves_distinct_paths_for_same_stem(self):
        with TemporaryDirectory() as directory:
            first = reserve_output_path(Path(directory), "台銀")
            second = reserve_output_path(Path(directory), "台銀")
            self.assertNotEqual(first.target, second.target)
            first.release(); second.release()

    def test_publish_is_atomic_and_releases_lock(self):
        class Image:
            def save(self, path, format=None): Path(path).write_bytes(b"PNG")
        with TemporaryDirectory() as directory:
            reservation = reserve_output_path(Path(directory), "x")
            target = publish_image(Image(), reservation)
            self.assertEqual(target.read_bytes(), b"PNG")
            self.assertFalse(reservation.lock.exists())
