"""标签 → 列表里最像的候选。

AI 写的立绘标签对不上这张卡的立绘名时,拿它的向量和每个候选名字的向量比余弦相似度,
取最大的那个。总是给出一个结果,不设门槛(准确度次要,见
docs/superpowers/specs/2026-09-25-sprite-emotion-matching-design.md)。
encoder 是协议:真模型在 encoder.py,测试用假的。
"""

from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from threading import Lock
from typing import Protocol

import numpy as np


class Encoder(Protocol):
    name: str

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        """(len(texts), 维数),每行已经归一化"""
        ...


@dataclass(frozen=True)
class Candidate:
    key: str
    names: tuple[str, ...]


@dataclass(frozen=True)
class Match:
    tag: str
    key: str
    name: str
    score: float


class EmotionMatcher:
    def __init__(self, encoder: Encoder, cache_size: int = 4096):
        self.encoder = encoder
        # 文本 → 向量。同一张卡的立绘名每次都会发过来,只算一次
        self._cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._cache_size = cache_size
        # 单独编码的向量(match_singles 用):和上面拼批算的分开存,两种算法的结果不混
        self._singles: OrderedDict[str, np.ndarray] = OrderedDict()
        self._lock = Lock()

    @property
    def model(self) -> str:
        return self.encoder.name

    def _vectors(self, texts: Sequence[str]) -> dict[str, np.ndarray]:
        unique = list(dict.fromkeys(texts))
        out: dict[str, np.ndarray] = {}
        with self._lock:
            for t in unique:
                v = self._cache.get(t)
                if v is not None:
                    self._cache.move_to_end(t)
                    out[t] = v
        missing = [t for t in unique if t not in out]
        if missing:
            vectors = self.encoder.encode(missing)
            with self._lock:
                for t, v in zip(missing, vectors):
                    out[t] = v
                    self._cache[t] = v
                    self._cache.move_to_end(t)
                while len(self._cache) > self._cache_size:
                    self._cache.popitem(last=False)
        return out

    def match(self, tags: Sequence[str], candidates: Sequence[Candidate]) -> list[Match]:
        names = [n for c in candidates for n in c.names]
        owner = [i for i, c in enumerate(candidates) for _ in c.names]
        vec = self._vectors([*tags, *names])
        name_matrix = np.stack([vec[n] for n in names])
        results: list[Match] = []
        for tag in tags:
            sims = name_matrix @ vec[tag]
            # argmax 取第一个最大值:名字按候选顺序排开,并列时自然落在排前面的候选上
            best = int(np.argmax(sims))
            c = candidates[owner[best]]
            results.append(Match(tag=tag, key=c.key, name=names[best], score=round(float(sims[best]), 3)))
        return results

    def _single(self, text: str) -> np.ndarray:
        with self._lock:
            v = self._singles.get(text)
            if v is not None:
                self._singles.move_to_end(text)
                return v
        v = self.encoder.encode([text])[0]
        with self._lock:
            self._singles[text] = v
            self._singles.move_to_end(text)
            while len(self._singles) > self._cache_size:
                self._singles.popitem(last=False)
        return v

    def match_singles(self, tags: Sequence[str], candidates: Sequence[Candidate]) -> list[Match]:
        """和 match 一样挑最像的,但每个文字单独编码(设计 1.4 的固定算法)。int8 模型拼批时,同一个词的向量
        会跟着同一批里别的词变;单独编码只和它自己有关,结果不看分批、不看后端先算过什么。回放检查用它"""
        names = [n for c in candidates for n in c.names]
        owner = [i for i, c in enumerate(candidates) for _ in c.names]
        name_matrix = np.stack([self._single(n) for n in names])
        results: list[Match] = []
        for tag in tags:
            sims = name_matrix @ self._single(tag)
            best = int(np.argmax(sims))
            c = candidates[owner[best]]
            results.append(Match(tag=tag, key=c.key, name=names[best], score=round(float(sims[best]), 3)))
        return results
