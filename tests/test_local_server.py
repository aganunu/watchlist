from __future__ import annotations

import importlib.util
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("watchlist_serve_local", ROOT / "tools" / "serve_local.py")
assert SPEC and SPEC.loader
SERVER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER_MODULE)


class LocalServerSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), SERVER_MODULE.WatchlistHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def get(self, path: str):
        return urlopen(self.base + path, timeout=3)

    def test_public_entries_and_marker(self) -> None:
        for path in ("/", "/index.html", "/v6-beta15.html", "/manifest.webmanifest"):
            with self.subTest(path=path), self.get(path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["X-Watchlist-Server"], SERVER_MODULE.SERVER_MARKER)
        with self.get(SERVER_MODULE.MARKER_PATH) as response:
            self.assertEqual(json.load(response)["server"], SERVER_MODULE.SERVER_MARKER)
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_dynamic_files_use_no_store(self) -> None:
        for path in ("/", "/index.html", "/v6-beta15.html", "/sw.js", "/manifest.webmanifest"):
            with self.subTest(path=path), self.get(path) as response:
                self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_forbidden_paths_are_rejected(self) -> None:
        forbidden = (
            "/.git/config",
            "/.env",
            "/tools/serve_local.py",
            "/docs/ADR-001-player-stack.md",
            "/../AGENTS.md",
            "/%2e%2e/AGENTS.md",
            "/nested/index.html",
        )
        for path in forbidden:
            with self.subTest(path=path), self.assertRaises(HTTPError) as error:
                self.get(path)
            self.assertIn(error.exception.code, (403, 404))


if __name__ == "__main__":
    unittest.main()
