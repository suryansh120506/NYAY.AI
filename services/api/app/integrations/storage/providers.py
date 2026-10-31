"""Document storage (brief §1.2 Saransh): an interface with two implementations, chosen by STORAGE_PROVIDER.

postgres  bytes in the `document_blobs` table. No bucket, no local files: the dev setup stays stateless (A61).
s3        any S3-compatible bucket (Supabase Storage, AWS S3, R2) with server-side encryption, signed with SigV4.
          The bucket must be private; objects are only ever read back by the API.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import uuid
from typing import Protocol
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models.tables import DocumentBlob


class StorageError(Exception):
    pass


class StorageProvider(Protocol):
    name: str

    async def put(self, key: str, data: bytes, mime: str) -> None: ...

    async def get(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...


class PostgresBlobStorage:
    """Key = the document id (the blob row cascades with its document)."""

    name = "postgres"

    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def put(self, key: str, data: bytes, mime: str) -> None:
        async with self._sessions() as db, db.begin():
            await db.execute(
                insert(DocumentBlob)
                .values(document_id=uuid.UUID(key), data=data)
                .on_conflict_do_update(index_elements=["document_id"], set_={"data": data})
            )

    async def get(self, key: str) -> bytes:
        async with self._sessions() as db:
            data = await db.scalar(
                select(DocumentBlob.data).where(DocumentBlob.document_id == uuid.UUID(key))
            )
        if data is None:
            raise StorageError("not found")
        return bytes(data)

    async def delete(self, key: str) -> None:
        async with self._sessions() as db, db.begin():
            await db.execute(delete(DocumentBlob).where(DocumentBlob.document_id == uuid.UUID(key)))


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


class S3Storage:
    """Minimal SigV4 client for PUT/GET/DELETE of single objects (path-style URLs, which Supabase requires)."""

    name = "s3"

    def __init__(
        self,
        *,
        endpoint: str,
        region: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        client: httpx.AsyncClient,
    ) -> None:
        if not (endpoint and bucket and access_key and secret_key):
            raise ValueError("S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required")
        self._endpoint = endpoint.rstrip("/")
        self._host = urlparse(self._endpoint).netloc
        self._base_path = urlparse(self._endpoint).path.rstrip("/")
        self._region, self._bucket = region, bucket
        self._access, self._secret = access_key, secret_key
        self._client = client

    def _headers(self, method: str, path: str, payload: bytes, extra: dict[str, str]) -> dict[str, str]:
        now = dt.datetime.now(dt.UTC)
        amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(payload).hexdigest()
        headers = {"host": self._host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date, **extra}
        signed = ";".join(sorted(headers))
        canonical = "\n".join(
            [
                method,
                path,
                "",
                "".join(f"{k}:{headers[k].strip()}\n" for k in sorted(headers)),
                signed,
                payload_hash,
            ]
        )
        scope = f"{day}/{self._region}/s3/aws4_request"
        to_sign = "\n".join(
            ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
        )
        k = _sign(
            _sign(_sign(_sign(f"AWS4{self._secret}".encode(), day), self._region), "s3"), "aws4_request"
        )
        signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self._access}/{scope}, SignedHeaders={signed}, Signature={signature}"
        )
        del headers["host"]
        return headers

    async def _request(
        self, method: str, key: str, payload: bytes = b"", extra: dict[str, str] | None = None
    ) -> bytes:
        path = f"{self._base_path}/{quote(self._bucket)}/{quote(key, safe='/')}"
        headers = self._headers(method, path, payload, extra or {})
        try:
            response = await self._client.request(
                method,
                f"{self._endpoint.removesuffix(self._base_path)}{path}",
                content=payload,
                headers=headers,
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise StorageError(type(exc).__name__) from exc
        if method == "DELETE" and response.status_code == 404:
            return b""
        if response.status_code >= 300:
            raise StorageError(f"s3 {method} returned {response.status_code}")
        return response.content

    async def put(self, key: str, data: bytes, mime: str) -> None:
        await self._request(
            "PUT", key, data, {"content-type": mime, "x-amz-server-side-encryption": "AES256"}
        )

    async def get(self, key: str) -> bytes:
        return await self._request("GET", key)

    async def delete(self, key: str) -> None:
        await self._request("DELETE", key)
