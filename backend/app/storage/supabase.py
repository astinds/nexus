"""Supabase Storage backend (HTTP REST, no SDK).

Why raw httpx instead of the `supabase` Python package: the REST surface we need
is three endpoints, httpx is already a dependency, and Render Free's 512 MB is
better spent elsewhere. The contract is identical to LocalStorage.

Bucket should be PRIVATE: reads happen through short-lived signed URLs minted by
`url_for`, or through the API's own streaming route.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .base import BaseStorage, StorageError, StoredObject, sanitize_key

SCHEME = "supabase"

log = logging.getLogger(__name__)

REASON_MAX = 300


def _reason(response: httpx.Response) -> str:
    """Upstream status reason, single line and bounded.

    Storage failures on Render were historically opaque: the client saw "Could
    not persist the uploaded file." and the server logged nothing. The body of a
    Supabase error ({"statusCode":"403","error":"InvalidJWT",...}) names the
    cause; only the request headers carry secrets, and those are never included.
    """
    body = " ".join((response.text or "").split())[:REASON_MAX]
    return body or response.reason_phrase or "no response body"


class SupabaseStorage(BaseStorage):
    name = "supabase"

    def __init__(
        self,
        base_url: str,
        service_key: str,
        bucket: str,
        *,
        timeout: float = 30.0,
    ) -> None:
        if not base_url or not service_key:
            raise StorageError("SupabaseStorage needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        self.base_url = base_url.rstrip("/")
        self.bucket = sanitize_key(bucket)
        self._timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }

    # ------------------------------------------------------------------ helpers
    def _object_url(self, key: str) -> str:
        return f"{self.base_url}/storage/v1/object/{self.bucket}/{sanitize_key(key)}"

    @staticmethod
    def _split_uri(uri: str) -> tuple[str, str]:
        if not uri.startswith(f"{SCHEME}://"):
            raise StorageError(f"not a {SCHEME} uri: {uri}")
        rest = uri[len(SCHEME) + 3 :]
        bucket, _, key = rest.partition("/")
        if not bucket or not key:
            raise StorageError(f"malformed {SCHEME} uri: {uri}")
        return bucket, key

    # ------------------------------------------------------------------ contract
    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject:
        key = sanitize_key(key)
        headers = dict(self._headers)
        headers["Content-Type"] = content_type or "application/octet-stream"
        headers["x-upsert"] = "true"
        try:
            response = httpx.post(
                self._object_url(key), content=data, headers=headers, timeout=self._timeout
            )
        except httpx.HTTPError as exc:
            # Timeouts and connection drops never produce a status code; name the
            # failure instead of letting a bare exception surface as a 500.
            log.error(
                "supabase upload raised %s for bucket=%s key=%s bytes=%d",
                type(exc).__name__,
                self.bucket,
                key,
                len(data),
            )
            raise StorageError(f"supabase upload failed: {type(exc).__name__}") from exc
        if response.status_code not in (200, 201):
            reason = _reason(response)
            log.error(
                "supabase upload rejected: status=%s bucket=%s key=%s bytes=%d reason=%s",
                response.status_code,
                self.bucket,
                key,
                len(data),
                reason,
            )
            raise StorageError(f"supabase upload failed ({response.status_code}): {reason}")
        return StoredObject(
            uri=f"{SCHEME}://{self.bucket}/{key}",
            key=key,
            size=len(data),
            content_type=content_type,
        )

    def get(self, uri: str) -> bytes:
        _, key = self._split_uri(uri)
        response = httpx.get(self._object_url(key), headers=self._headers, timeout=self._timeout)
        if response.status_code != 200:
            reason = _reason(response)
            log.error(
                "supabase download rejected: status=%s bucket=%s key=%s reason=%s",
                response.status_code,
                self.bucket,
                key,
                reason,
            )
            raise StorageError(f"supabase download failed ({response.status_code}): {reason}")
        return response.content

    def delete(self, uri: str) -> bool:
        _, key = self._split_uri(uri)
        response = httpx.request(
            "DELETE", self._object_url(key), headers=self._headers, timeout=self._timeout
        )
        return response.status_code in (200, 204)

    def exists(self, uri: str) -> bool:
        try:
            _, key = self._split_uri(uri)
            response = httpx.head(
                self._object_url(key), headers=self._headers, timeout=self._timeout
            )
            return response.status_code == 200
        except Exception:
            return False

    def url_for(self, uri: str, *, expires_in: int = 3600) -> str | None:
        """Mint a signed URL; None when the bucket/object cannot be signed."""
        try:
            _, key = self._split_uri(uri)
            response = httpx.post(
                f"{self.base_url}/storage/v1/object/sign/{self.bucket}/{key}",
                json={"expiresIn": expires_in},
                headers=self._headers,
                timeout=self._timeout,
            )
            if response.status_code != 200:
                return None
            signed = response.json().get("signedURL")
            if not signed:
                return None
            if signed.startswith("http"):
                return signed
            return f"{self.base_url}/storage/v1{signed}"
        except Exception:
            return None

    def health(self) -> dict[str, Any]:
        try:
            response = httpx.get(
                f"{self.base_url}/storage/v1/bucket/{self.bucket}",
                headers=self._headers,
                timeout=self._timeout,
            )
            ok = response.status_code == 200
            return {
                "backend": self.name,
                "ok": ok,
                "detail": f"bucket={self.bucket} status={response.status_code}",
            }
        except Exception as exc:
            return {"backend": self.name, "ok": False, "detail": f"{type(exc).__name__}: {exc}"}
