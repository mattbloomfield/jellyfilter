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
        """Look up a Jellyfin item ID by its exact file path."""
        # Fetch all video items with their paths and match exactly.
        # The /Items?Path= filter is a folder prefix, not a file match,
        # so we fetch in pages and do the comparison ourselves.
        start = 0
        page_size = 500
        while True:
            data = self._get(
                "/Items",
                Recursive="true",
                IncludeItemTypes="Movie,Episode",
                Fields="Path",
                StartIndex=str(start),
                Limit=str(page_size),
            )
            if not data:
                break
            items = data.get("Items", []) if isinstance(data, dict) else []
            for item in items:
                if item.get("Path") == media_path:
                    return item.get("Id")
            if len(items) < page_size:
                break
            start += page_size
        return None

    def get_duration(self, item_id: str) -> Optional[float]:
        """Return duration in seconds for a Jellyfin item."""
        data = self._get(f"/Items/{item_id}", Fields="RunTimeTicks")
        if not data:
            return None
        ticks = data.get("RunTimeTicks")
        return ticks / 10_000_000 if ticks else None
