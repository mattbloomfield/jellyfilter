import logging
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)


class JellyfinClient:
    def __init__(self, base_url: str, api_key: str):
        self._base = base_url.rstrip("/")
        self._headers = {
            "X-Emby-Token": api_key,
            "Accept": "application/json",
        }

    def _get(self, path: str, **params) -> dict | list | None:
        url = f"{self._base}{path}"
        try:
            r = httpx.get(url, headers=self._headers, params=params, timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            log.warning("Jellyfin API error for %s: %s", path, exc)
            return None

    def resolve_item_id(self, media_path: str) -> Optional[str]:
        """Look up a Jellyfin item ID by its file path."""
        # Jellyfin exposes the path as a filter on /Items
        data = self._get(
            "/Items",
            Recursive=True,
            Fields="Path",
            Path=media_path,
            Limit=1,
        )
        if not data:
            return None
        items = data.get("Items", []) if isinstance(data, dict) else data
        if items:
            return items[0].get("Id")
        return None

    def get_duration(self, item_id: str) -> Optional[float]:
        """Return duration in seconds for a Jellyfin item."""
        data = self._get(f"/Items/{item_id}", Fields="RunTimeTicks")
        if not data:
            return None
        ticks = data.get("RunTimeTicks")
        return ticks / 10_000_000 if ticks else None
