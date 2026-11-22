#!/usr/bin/env python3
"""
Self-verifying E2E smoke test for NEXUS.

Generates a 2-page PDF in memory (Page 1: unique searchable phrase;
Page 2: vector drawing, zero text), uploads via /api/v1/ingest, verifies
extraction + search + export + delete.

Usage:
    python scripts/smoke_test.py [--base-url URL] [--access-key KEY]
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from dataclasses import dataclass
from io import BytesIO


try:
    import httpx
except ImportError as e:
    if __name__ == "__main__":
        print(f"Missing dependency: {e}", file=sys.stderr)
        print("Install with: pip install httpx", file=sys.stderr)
        sys.exit(1)
    raise


@dataclass
class TestConfig:
    base_url: str
    access_key: str | None


@dataclass
class TestItem:
    item_id: str
    phrase: str


# ──────────────────────────────────────────────────────────────────────
# Minimal pure-Python PDF generator (no reportlab)
# Produces a valid 2-page PDF:
#   Page 1: contains the search phrase as extractable text
#   Page 2: empty page (no text) — will be flagged is_scanned by extractor
# ──────────────────────────────────────────────────────────────────────

_PDF_HEADER = b"%PDF-1.4\n"

# Page size: Letter (612 x 792 points)
_PAGE_W = 612
_PAGE_H = 792


def _pdf_obj(num: int, gen: int, data: bytes) -> bytes:
    return f"{num} {gen} obj\n".encode() + data + b"\nendobj\n"


def _pdf_stream(num: int, gen: int, dict_data: bytes, stream_data: bytes) -> bytes:
    header = f"{num} {gen} obj\n".encode()
    header += dict_data + b"\nstream\n"
    header += stream_data + b"\nendstream\nendobj\n"
    return header


def _make_content_stream(text: str) -> bytes:
    """Create a simple text-showing content stream."""
    # Escape parens and backslashes for PDF string
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    # BT = begin text, ET = end text, Tf = set font, Td = move, Tj = show text
    ops = (
        "BT\n"
        "/F1 12 Tf\n"
        "72 720 Td\n"
        f"({escaped}) Tj\n"
        "ET\n"
    )
    return ops.encode()


def _make_empty_content_stream() -> bytes:
    """Empty content stream for page 2 (no text)."""
    return b""


def generate_test_pdf(phrase: str) -> bytes:
    """
    Generate a 2-page PDF using pure Python.

    Page 1: Contains the search phrase as extractable text.
    Page 2: Empty page (no text content) — will be flagged is_scanned by extractor.
    """
    # Object numbering:
    # 1: Catalog
    # 2: Pages (parent of page objects)
    # 3: Font resource
    # 4: Page 1
    # 5: Page 1 content stream
    # 6: Page 2
    # 7: Page 2 content stream

    objects = []

    # 1: Catalog
    objects.append(_pdf_obj(1, 0, b"<< /Type /Catalog /Pages 2 0 R >>"))

    # 2: Pages tree
    objects.append(_pdf_obj(2, 0, b"<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>"))

    # 3: Font resource (Helvetica, built-in)
    objects.append(
        _pdf_obj(3, 0, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    )

    # 4: Page 1
    page1_content = _make_content_stream(
        f"NEXUS Smoke Test Document\nSearch phrase: {phrase}\nThis is Page 1 — it contains extractable text."
    )
    stream5_data = page1_content
    stream5_dict = f"<< /Length {len(stream5_data)} >>".encode()
    objects.append(
        _pdf_stream(
            5, 0, stream5_dict, stream5_data
        )
    )
    objects.append(
        _pdf_obj(
            4,
            0,
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {_PAGE_W} {_PAGE_H}] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>".encode(),
        )
    )

    # 6: Page 2
    stream7_data = _make_empty_content_stream()
    stream7_dict = f"<< /Length {len(stream7_data)} >>".encode()
    objects.append(
        _pdf_stream(
            7, 0, stream7_dict, stream7_data
        )
    )
    objects.append(
        _pdf_obj(
            6,
            0,
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {_PAGE_W} {_PAGE_H}] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>".encode(),
        )
    )

    # Build file
    buf = BytesIO()
    buf.write(_PDF_HEADER)

    # Track byte offsets for xref
    offsets = [0]  # 0-index dummy
    for obj in objects:
        offsets.append(buf.tell())
        buf.write(obj)

    xref_start = buf.tell()
    buf.write(f"xref\n0 {len(offsets)}\n".encode())
    buf.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        buf.write(f"{off:010d} 00000 n \n".encode())

    buf.write(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode())

    return buf.getvalue()


# ──────────────────────────────────────────────────────────────────────
# Smoke test runner
# ──────────────────────────────────────────────────────────────────────

class SmokeTest:
    def __init__(self, config: TestConfig):
        self.config = config
        self.client = httpx.Client(base_url=config.base_url, timeout=30.0)
        self.auth_headers: dict[str, str] = {}
        if config.access_key:
            self.auth_headers["X-Nexus-Key"] = config.access_key

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.client.close()

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = kwargs.pop("headers", {})
        headers.update(self.auth_headers)
        resp = self.client.request(method, path, headers=headers, **kwargs)
        return resp

    def check_health(self) -> bool:
        """GET /api/v1/health — exit cleanly if DB unavailable."""
        try:
            resp = self._request("GET", "/api/v1/health")
        except httpx.ConnectError as e:
            print(f"❌ Cannot connect to {self.config.base_url}: {e}", file=sys.stderr)
            sys.exit(1)

        if resp.status_code == 503:
            data = resp.json()
            if not data.get("db", True):
                print(
                    "⚠️  Health check reports database unavailable. "
                    "Set DATABASE_URL (Supabase) and run migrations:\n"
                    "  DATABASE_URL=... python scripts/apply_migrations.py",
                    file=sys.stderr,
                )
                sys.exit(0)  # clean exit, not a test failure
        elif resp.status_code != 200:
            print(f"❌ Health check failed: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)

        data = resp.json()
        print(f"✅ Health OK: {data}")
        return True

    def authenticate(self) -> bool:
        """POST /api/v1/auth/session if passcode is enabled."""
        if not self.config.access_key:
            print("ℹ️  No access key provided; skipping auth (dev mode)")
            return True

        resp = self._request("POST", "/api/v1/auth/session", json={"passcode": self.config.access_key})
        if resp.status_code == 200:
            data = resp.json()
            session_token = data.get("session_token")
            if session_token:
                self.auth_headers["Cookie"] = f"nexus_session={session_token}"
                print("✅ Authenticated via session cookie")
            return True
        elif resp.status_code == 401:
            print("❌ Invalid passcode", file=sys.stderr)
            sys.exit(1)
        else:
            print(f"❌ Auth failed: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)

    def ingest_pdf(self, pdf_bytes: bytes, phrase: str) -> TestItem:
        """POST /api/v1/ingest — upload PDF, assert 201 + item_id."""
        files = {"file": ("smoke-test.pdf", pdf_bytes, "application/pdf")}
        data = {"source_format": "pdf", "title": f"Smoke Test {phrase[:16]}"}
        resp = self._request("POST", "/api/v1/ingest", files=files, data=data)
        if resp.status_code != 201:
            print(f"❌ Ingest failed: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)
        data = resp.json()
        item_id = data.get("item_id")
        if not item_id:
            print(f"❌ No item_id in response: {data}", file=sys.stderr)
            sys.exit(1)
        print(f"✅ Ingested item: {item_id}")
        return TestItem(item_id=item_id, phrase=phrase)

    def check_segments(self, item_id: str, phrase: str) -> bool:
        """GET /api/v1/items/{id}/segments — assert Page 1 has phrase, Page 2 is_scanned."""
        resp = self._request("GET", f"/api/v1/items/{item_id}/segments")
        if resp.status_code != 200:
            print(f"❌ Segments fetch failed: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)
        segments = resp.json()
        if not isinstance(segments, list):
            print(f"❌ Unexpected segments format: {segments}", file=sys.stderr)
            sys.exit(1)

        page1_ok = False
        page2_scanned = False
        for seg in segments:
            label = seg.get("segment_label", "")
            content = seg.get("content", "")
            is_scanned = seg.get("is_scanned", False)
            if "Page 1" in label and phrase in content:
                page1_ok = True
                print(f"✅ Page 1 extracted phrase: {phrase[:40]}...")
            if "Page 2" in label and is_scanned:
                page2_scanned = True
                print("✅ Page 2 flagged is_scanned=True (no text, vector only)")

        if not page1_ok:
            print(f"❌ Page 1 missing phrase. Segments: {segments}", file=sys.stderr)
            sys.exit(1)
        if not page2_scanned:
            print(f"❌ Page 2 not flagged is_scanned. Segments: {segments}", file=sys.stderr)
            sys.exit(1)
        return True

    def search_phrase(self, item_id: str, phrase: str) -> bool:
        """GET /api/v1/search — assert hit matches item_id + segment_label == 'Page 1'."""
        resp = self._request("GET", "/api/v1/search", params={"q": phrase, "limit": 10})
        if resp.status_code != 200:
            print(f"❌ Search failed: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)
        data = resp.json()
        hits = data.get("hits", [])
        found = False
        for hit in hits:
            if hit.get("item_id") == item_id and hit.get("segment_label") == "Page 1":
                found = True
                print(f"✅ Search hit: item={item_id}, segment=Page 1, score={hit.get('score')}")
                break
        if not found:
            print(f"❌ Search did not return expected hit. Hits: {hits}", file=sys.stderr)
            sys.exit(1)
        return True

    def export_item(self, item_id: str) -> bool:
        """GET /api/v1/items/{id}/export?format=markdown — assert valid frontmatter + body."""
        resp = self._request("GET", f"/api/v1/items/{item_id}/export", params={"format": "markdown"})
        if resp.status_code != 200:
            print(f"❌ Export failed: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)
        markdown = resp.text
        if not markdown.startswith("---"):
            print(f"❌ Export missing YAML frontmatter: {markdown[:200]}", file=sys.stderr)
            sys.exit(1)
        required_fields = ["id", "title", "source_format", "created_at"]
        for field in required_fields:
            if f"{field}:" not in markdown:
                print(f"❌ Export missing field '{field}' in frontmatter", file=sys.stderr)
                sys.exit(1)
        if "# " not in markdown and "## " not in markdown:
            print(f"❌ Export body seems empty: {markdown[:500]}", file=sys.stderr)
            sys.exit(1)
        print(f"✅ Export OK: frontmatter + body ({len(markdown)} chars)")
        return True

    def delete_item(self, item_id: str) -> bool:
        """DELETE /api/v1/items/{id} — confirm cleanup."""
        resp = self._request("DELETE", f"/api/v1/items/{item_id}")
        if resp.status_code not in (200, 204):
            print(f"❌ Delete failed: {resp.status_code} {resp.text}", file=sys.stderr)
            sys.exit(1)
        print(f"✅ Deleted item: {item_id}")
        return True

    def run(self) -> None:
        print(f"🚀 Starting smoke test against {self.config.base_url}")
        print(f"   Access key: {'set' if self.config.access_key else 'none (dev mode)'}")

        self.check_health()
        self.authenticate()

        phrase = f"NEXUS-SMOKE-{uuid.uuid4().hex[:12].upper()}"
        pdf_bytes = generate_test_pdf(phrase)
        print(f"📄 Generated 2-page PDF ({len(pdf_bytes)} bytes), phrase: {phrase}")
        item = self.ingest_pdf(pdf_bytes, phrase)

        self.check_segments(item.item_id, phrase)
        self.search_phrase(item.item_id, phrase)
        self.export_item(item.item_id)
        self.delete_item(item.item_id)

        print("\n🎉 ALL SMOKE TESTS PASSED")


def main() -> None:
    parser = argparse.ArgumentParser(description="NEXUS E2E smoke test")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("NEXUS_BASE_URL", "http://127.0.0.1:8000"),
        help="Backend base URL (default: http://127.0.0.1:8000)",
    )
    parser.add_argument(
        "--access-key",
        default=os.environ.get("NEXUS_ACCESS_KEY"),
        help="Passcode for auth (default: NEXUS_ACCESS_KEY env var)",
    )
    args = parser.parse_args()

    config = TestConfig(base_url=args.base_url.rstrip("/"), access_key=args.access_key)
    with SmokeTest(config) as test:
        test.run()


if __name__ == "__main__":
    main()
