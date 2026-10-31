from __future__ import annotations

import hashlib
import math
import re

from .base import Task

_TOKEN = re.compile(r"[\wऀ-ॿ]+", re.UNICODE)


class HashEmbedder:
    """Deterministic, offline "feature hashing" embedder for dev and tests.

    Texts that share words get similar vectors, so ranking behaves sensibly without a model. Not semantic.
    """

    def __init__(self, dim: int) -> None:
        self.dim = dim
        self.version = f"hash-v1-{dim}"

    async def embed(self, texts: list[str], *, task: Task) -> list[list[float]]:
        return [self._one(text) for text in texts]

    def _one(self, text: str) -> list[float]:
        vector = [0.0] * self.dim
        for token in _TOKEN.findall(text.lower()):
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            index = int.from_bytes(digest[:4], "little") % self.dim
            vector[index] += 1.0 if digest[4] & 1 else -1.0
        norm = math.sqrt(sum(v * v for v in vector)) or 1.0
        return [v / norm for v in vector]
