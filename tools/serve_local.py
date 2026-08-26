#!/usr/bin/env python3
"""Small allowlisted LAN server for the Watchlist development build."""

from __future__ import annotations

import argparse
import ipaddress
import json
import mimetypes
import re
import socket
import subprocess
import sys
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.error import URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen


HOST = "0.0.0.0"
PORT = 8765
ROOT = Path(__file__).resolve().parents[1]
START_PAGE = "v6-beta15.html"
SERVER_MARKER = "watchlist-local-v1"
MARKER_PATH = "/__watchlist_server__"

# Deliberately small public surface: application entry point and its PWA assets.
PUBLIC_FILES = {
    "v6-beta15.html",
    "manifest.webmanifest",
    "icon-180.png",
    "icon-512.png",
    "sw.js",
}
PUBLIC_BY_LOWER = {name.lower(): name for name in PUBLIC_FILES}


def lan_ipv4() -> str:
    """Return the most useful private IPv4 without sending application data."""
    candidates: list[str] = []
    if sys.platform == "win32":
        try:
            output = subprocess.run(
                ["ipconfig"], check=False, capture_output=True, timeout=3
            ).stdout.decode(errors="ignore")
            for line in output.splitlines():
                if "IPv4" in line:
                    candidates.extend(re.findall(r"(?:\d{1,3}\.){3}\d{1,3}", line))
        except (OSError, subprocess.SubprocessError):
            pass
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.2.1", 9))
        candidates.append(probe.getsockname()[0])
    except OSError:
        pass
    finally:
        probe.close()

    try:
        candidates.extend(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass

    def rank(value: str) -> tuple[int, int]:
        if value.startswith("192.168."):
            return (0, candidates.index(value))
        if value.startswith("10."):
            return (1, candidates.index(value))
        return (2, candidates.index(value))

    for value in sorted(dict.fromkeys(candidates), key=rank):
        try:
            address = ipaddress.ip_address(value)
        except ValueError:
            continue
        if address.version == 4 and address.is_private and not address.is_loopback and not address.is_link_local:
            return value
    return "127.0.0.1"


def local_url() -> str:
    return f"http://127.0.0.1:{PORT}/{START_PAGE}"


def lan_url() -> str:
    return f"http://{lan_ipv4()}:{PORT}/{START_PAGE}"


def is_our_running_server() -> bool:
    try:
        request = Request(f"http://127.0.0.1:{PORT}{MARKER_PATH}", method="GET")
        with urlopen(request, timeout=1.2) as response:
            return response.headers.get("X-Watchlist-Server") == SERVER_MARKER
    except (OSError, URLError):
        return False


class WatchlistHandler(SimpleHTTPRequestHandler):
    server_version = "WatchlistLocal/1.0"
    sys_version = ""

    def log_message(self, format: str, *args: object) -> None:
        sys.stdout.write(f"[{self.client_address[0]}] {format % args}\n")
        sys.stdout.flush()

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        clean_path = urlsplit(self.path).path
        self.log_message('"%s %s" %s %s', self.command, clean_path, code, size)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Watchlist-Server", SERVER_MARKER)
        super().end_headers()

    def _clean_public_name(self) -> str | None:
        raw_path = unquote(urlsplit(self.path).path).replace("\\", "/")
        if "\x00" in raw_path:
            return None
        parts = [part for part in PurePosixPath(raw_path).parts if part not in ("/", "")]
        if not parts or any(part in (".", "..") or part.startswith(".") for part in parts):
            return None
        if len(parts) != 1:
            return None
        return PUBLIC_BY_LOWER.get(parts[0].lower())

    def _send_marker(self, include_body: bool) -> None:
        payload = json.dumps({"server": SERVER_MARKER}).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if include_body:
            self.wfile.write(payload)

    def _send_public_file(self, include_body: bool) -> None:
        path_only = urlsplit(self.path).path
        if path_only == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", f"/{START_PAGE}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if path_only == MARKER_PATH:
            self._send_marker(include_body)
            return

        name = self._clean_public_name()
        if not name:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        candidate = (ROOT / name).resolve()
        try:
            candidate.relative_to(ROOT)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Not found")
            return

        content_type, encoding = mimetypes.guess_type(candidate.name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(candidate.stat().st_size))
        self.send_header("Cache-Control", "no-store" if candidate.suffix in {".html", ".js", ".webmanifest"} else "public, max-age=3600")
        self.end_headers()
        if include_body:
            with candidate.open("rb") as source:
                self.copyfile(source, self.wfile)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        self._send_public_file(include_body=True)

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib handler API
        self._send_public_file(include_body=False)

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")


def run_server(open_browser: bool = False) -> int:
    if is_our_running_server():
        print("Watchlist server is already running.")
        print(f"PC:  {local_url()}")
        print(f"LAN: {lan_url()}")
        return 0

    try:
        server = ThreadingHTTPServer((HOST, PORT), WatchlistHandler)
    except OSError as error:
        print(f"Port {PORT} is occupied by another process: {error}", file=sys.stderr)
        return 2

    server.daemon_threads = True
    print(f"Watchlist root: {ROOT}")
    print(f"PC:  {local_url()}")
    print(f"LAN: {lan_url()}")
    print("Press Ctrl+C to stop the server.")
    sys.stdout.flush()
    if open_browser:
        webbrowser.open(local_url(), new=2)
    try:
        server.serve_forever(poll_interval=0.4)
    except KeyboardInterrupt:
        print("\nWatchlist server stopped.")
    finally:
        server.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the Watchlist Beta 15 safely on the local network.")
    parser.add_argument("--check", action="store_true", help="Return success only if this server already owns port 8765.")
    parser.add_argument("--lan-url", action="store_true", help="Print only the LAN URL.")
    parser.add_argument("--open-browser", action="store_true", help="Open the local Beta 15 page after the server binds successfully.")
    args = parser.parse_args()
    if args.check:
        return 0 if is_our_running_server() else 1
    if args.lan_url:
        print(lan_url())
        return 0
    return run_server(open_browser=args.open_browser)


if __name__ == "__main__":
    raise SystemExit(main())
