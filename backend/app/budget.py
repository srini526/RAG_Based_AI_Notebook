"""Global daily caps so a public deployment cannot burn the free-tier API quotas."""
from __future__ import annotations

import threading
import time

from .errors import ApiError


class DailyBudget:
    """Counts requests per kind per UTC day. A limit of 0 (or less) means unlimited."""

    def __init__(self, limits: dict[str, int]) -> None:
        self._limits = limits
        self._lock = threading.Lock()
        self._day = ""
        self._used: dict[str, int] = {}

    def spend(self, kind: str) -> None:
        limit = self._limits.get(kind, 0)
        if limit <= 0:
            return
        today = time.strftime("%Y-%m-%d", time.gmtime())
        with self._lock:
            if today != self._day:
                self._day, self._used = today, {}
            if self._used.get(kind, 0) >= limit:
                raise ApiError("daily_limit",
                               "This demo reached its daily limit. Please try again tomorrow.", 429)
            self._used[kind] = self._used.get(kind, 0) + 1
