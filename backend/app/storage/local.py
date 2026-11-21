"""Filesystem storage for local development and tests."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .base import BaseStorage, StorageError, StoredObject, sanitize_key

SCHEME = "local"


class LocalStorage(BaseStorage):
    name = "local"

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root).expanduser()

    # ------------------------------------------------------------------ helpers
    def _path(self, key: str) -> Path:
        return self.root / sanitize_key(key)

    @staticmethod
    def _key_from_uri(uri: str) -> str:
        if not uri.startswith(f"{SCHEME}://"):
            raise StorageError(f"not a {SCHEME} uri: {uri}")
        return uri[len(SCHEME) + 3 :]

    # ------------------------------------------------------------------ contract
    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-rename: a crash never leaves a half file behind.
        tmp = path.with_name(path.name + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, path)
        return StoredObject(
            uri=f"{SCHEME}://{sanitize_key(key)}",
            key=sanitize_key(key),
            size=len(data),
            content_type=content_type,
        )

    def get(self, uri: str) -> bytes:
        path = self._path(self._key_from_uri(uri))
        if not path.is_file():
            raise StorageError(f"object not found: {uri}")
        return path.read_bytes()

    def delete(self, uri: str) -> bool:
        path = self._path(self._key_from_uri(uri))
        if path.is_file():
            path.unlink()
            return True
        return False

    def exists(self, uri: str) -> bool:
        try:
            return self._path(self._key_from_uri(uri)).is_file()
        except StorageError:
            return False

    def path_for(self, uri: str) -> Path:
        """Local-only convenience used by tests and the file streaming route."""
        return self._path(self._key_from_uri(uri))

    def health(self) -> dict[str, Any]:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            probe = self.root / ".nexus-write-probe"
            probe.write_bytes(b"ok")
            probe.unlink()
            return {"backend": self.name, "ok": True, "detail": str(self.root)}
        except OSError as exc:
            return {"backend": self.name, "ok": False, "detail": f"{type(exc).__name__}: {exc}"}
