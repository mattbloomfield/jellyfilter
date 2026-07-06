"""
Lightweight HTTP API server for the whisper pipeline.
Serves queue status, EDL data, and preferences so the companion UI
works without the C# plugin installed.
Runs on port 8765.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse
import logging

import db

log = logging.getLogger(__name__)

_prefs_path: Path | None = None


def _prefs_file() -> Path:
    p = Path("/mnt/nfs-media/jellyfilter/preferences.json")
    return p


def _load_prefs() -> dict:
    f = _prefs_file()
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    return {}


def _save_prefs(data: dict):
    f = _prefs_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, indent=2))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress per-request access logs

    def _send(self, code: int, body: object):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Emby-Token")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")

        if path == "/jellyfilter/queue":
            self._send(200, db.get_all_queue())

        elif path.startswith("/jellyfilter/status/"):
            item_id = path.split("/")[-1]
            # Try jellyfin_id match first, then path hash
            rows = db.get_all_queue()
            match = next((r for r in rows if r.get("jellyfin_id") == item_id), None)
            if match:
                self._send(200, {"status": match["status"], "hit_count": match.get("hit_count")})
            else:
                edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
                if edl_path.exists():
                    self._send(200, {"status": "done", "hit_count": None})
                else:
                    self._send(200, {"status": "no-data", "hit_count": None})

        elif path.startswith("/jellyfilter/edl/") and "/entry/" not in path:
            item_id = path.split("/")[-1]
            edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
            if edl_path.exists():
                self._send(200, json.loads(edl_path.read_text()))
            else:
                self._send(404, {"error": "not found"})

        elif path.startswith("/jellyfilter/transcript/"):
            item_id = path.split("/")[-1]
            # Resolve media_path via the EDL file, then look up transcript
            edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
            if not edl_path.exists():
                self._send(404, {"error": "no EDL for this item"})
                return
            media_path = json.loads(edl_path.read_text()).get("media_path", "")
            try:
                with db.get_conn() as conn:
                    row = conn.execute(
                        "SELECT transcript_text, created_at FROM transcripts WHERE media_path = ?",
                        (media_path,)
                    ).fetchone()
                if row:
                    raw = row["transcript_text"]
                    # Try to parse as segment JSON; fall back to plain text
                    try:
                        segments = json.loads(raw)
                        self._send(200, {"media_path": media_path, "segments": segments, "created_at": row["created_at"]})
                    except (json.JSONDecodeError, TypeError):
                        self._send(200, {"media_path": media_path, "segments": None, "text": raw, "created_at": row["created_at"]})
                else:
                    self._send(404, {"error": "transcript not yet available"})
            except Exception as exc:
                self._send(500, {"error": str(exc)})

        elif path.startswith("/jellyfilter/redetect/"):
            item_id = path.split("/")[-1]
            edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
            if not edl_path.exists():
                self._send(404, {"error": "no EDL for this item"})
                return
            doc = json.loads(edl_path.read_text())
            media_path = doc.get("media_path", "")

            # Load stored word tokens
            try:
                with db.get_conn() as conn:
                    row = conn.execute(
                        "SELECT word_tokens FROM transcripts WHERE media_path = ?",
                        (media_path,)
                    ).fetchone()
            except Exception as exc:
                self._send(500, {"error": str(exc)})
                return

            if not row or not row["word_tokens"]:
                self._send(404, {"error": "no word tokens stored — item must be re-transcribed"})
                return

            try:
                from profanity_detector import detect_profanity
                from edl_writer import write_edl
                word_tokens = json.loads(row["word_tokens"])
                detected = detect_profanity(word_tokens)

                # Preserve manually confirmed entries from the old EDL
                confirmed = {e["id"]: e for e in doc.get("entries", []) if e.get("confirmed")}

                new_edl_path = write_edl(
                    output_dir=str(edl_path.parent),
                    jellyfin_id=item_id,
                    media_path=media_path,
                    duration_seconds=doc.get("duration_seconds", 0),
                    detected=detected,
                )
                # Merge back any confirmed manual entries
                if confirmed:
                    new_doc = json.loads(new_edl_path.read_text())
                    existing_ids = {e["id"] for e in new_doc["entries"]}
                    for entry in confirmed.values():
                        if entry["id"] not in existing_ids:
                            new_doc["entries"].append(entry)
                    new_doc["entries"].sort(key=lambda e: e["start"])
                    new_edl_path.write_text(json.dumps(new_doc, indent=2))

                result = json.loads(new_edl_path.read_text())
                self._send(200, {"entries": len(result["entries"]), "edl": result})
            except Exception as exc:
                self._send(500, {"error": str(exc)})

        elif path == "/jellyfilter/pipeline":
            all_prefs = _load_prefs()
            pipeline = all_prefs.get("_pipeline", {})
            self._send(200, {
                "media_paths": pipeline.get("media_paths", [
                    "/mnt/nfs-media/Movies",
                    "/mnt/nfs-media/TV",
                ]),
            })

        elif path == "/jellyfilter/preferences":
            # Return first user's prefs or a default
            all_prefs = _load_prefs()
            if all_prefs:
                first = next(iter(all_prefs.values()))
                self._send(200, first)
            else:
                self._send(200, {
                    "userId": "",
                    "enabled": False,
                    "filters": {
                        "profanity": {"enabled": True},
                        "violence": {"enabled": False},
                        "sexual-content": {"enabled": False},
                        "substance-use": {"enabled": False},
                    }
                })

        else:
            self._send(404, {"error": "not found"})

    def do_PUT(self):
        path = urlparse(self.path).path.rstrip("/")

        if path == "/jellyfilter/pipeline":
            body = self._body()
            paths = body.get("media_paths", [])
            all_prefs = _load_prefs()
            all_prefs["_pipeline"] = {"media_paths": paths}
            _save_prefs(all_prefs)
            self._send(200, {"media_paths": paths})

        elif path == "/jellyfilter/preferences":
            body = self._body()
            all_prefs = _load_prefs()
            user_id = body.get("userId", "default")
            all_prefs[user_id] = body
            _save_prefs(all_prefs)
            self._send(200, body)

        elif path.startswith("/jellyfilter/edl/") and "/word/" in path:
            # PUT /jellyfilter/edl/{itemId}/word/{word}  {"suppressed": bool}
            parts = path.split("/")
            item_id = parts[parts.index("edl") + 1]
            word = parts[-1]
            body = self._body()
            suppressed = bool(body.get("suppressed", False))
            edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
            if not edl_path.exists():
                self._send(404, {"error": "not found"})
                return
            doc = json.loads(edl_path.read_text())
            updated = 0
            for e in doc["entries"]:
                if e.get("word") == word:
                    e["suppressed"] = suppressed
                    updated += 1
            edl_path.write_text(json.dumps(doc, indent=2))
            self._send(200, {"word": word, "suppressed": suppressed, "updated": updated})

        elif path.startswith("/jellyfilter/edl/") and "/entry/" in path:
            parts = path.split("/")
            item_id = parts[parts.index("edl") + 1]
            entry_id = parts[-1]
            edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
            if not edl_path.exists():
                self._send(404, {"error": "not found"})
                return
            doc = json.loads(edl_path.read_text())
            body = self._body()
            body["id"] = entry_id
            for i, e in enumerate(doc["entries"]):
                if e["id"] == entry_id:
                    doc["entries"][i] = body
                    edl_path.write_text(json.dumps(doc, indent=2))
                    self._send(200, body)
                    return
            self._send(404, {"error": "entry not found"})

        elif path.startswith("/jellyfilter/edl/") and "/category/" in path:
            # PUT /jellyfilter/edl/{itemId}/category/{category}  {"suppressed": bool}
            parts = path.split("/")
            item_id = parts[parts.index("edl") + 1]
            category = parts[-1]
            body = self._body()
            suppressed = bool(body.get("suppressed", False))
            edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
            if not edl_path.exists():
                self._send(404, {"error": "not found"})
                return
            doc = json.loads(edl_path.read_text())
            updated = 0
            for e in doc["entries"]:
                if e.get("category") == category:
                    e["suppressed"] = suppressed
                    updated += 1
            edl_path.write_text(json.dumps(doc, indent=2))
            self._send(200, {"category": category, "suppressed": suppressed, "updated": updated})

        else:
            self._send(404, {"error": "not found"})

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip("/")
        if path.startswith("/jellyfilter/edl/") and "/entry/" in path:
            parts = path.split("/")
            item_id = parts[parts.index("edl") + 1]
            entry_id = parts[-1]
            edl_path = Path("/mnt/nfs-media/jellyfilter/edl") / f"{item_id}.jellyfilter.json"
            if not edl_path.exists():
                self._send(404, {"error": "not found"})
                return
            doc = json.loads(edl_path.read_text())
            before = len(doc["entries"])
            doc["entries"] = [e for e in doc["entries"] if e["id"] != entry_id]
            if len(doc["entries"]) == before:
                self._send(404, {"error": "entry not found"})
                return
            edl_path.write_text(json.dumps(doc, indent=2))
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
        else:
            self._send(404, {"error": "not found"})


def start_api_server(port: int = 8765):
    server = HTTPServer(("0.0.0.0", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log.info("JellyFilter API server listening on port %d", port)
    return server
