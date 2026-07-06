# JellyFilter — Developer Guide

Content filtering system for Jellyfin. Transcribes your media with Whisper, detects profanity, and mutes it transparently during transcoding via an ffmpeg wrapper.

---

## Architecture

The critical design constraint: **Jellyfin's plugin API has no hook for injecting ffmpeg arguments.** `EncodingHelper.GetAudioFilterParam()` is internal with no extension point. The only plugin-safe solution is an ffmpeg wrapper binary — Jellyfin's ffmpeg path setting points at the wrapper, which reads EDL files and injects `-af volume` filters before calling the real binary.

```
Whisper pipeline (Docker)
  → scans media dirs, transcribes with faster-whisper small.en (CPU, int8)
  → detects profanity via regex word list + profanity-check ML
  → writes EDL JSON to shared dir: {edl_dir}/{jellyfin-id}.jellyfilter.json
  → saves transcript to SQLite
  → serves REST API on port 8765

ffmpeg wrapper (/usr/local/bin/jellyfilter-ffmpeg)
  → Jellyfin calls this instead of real ffmpeg (JELLYFIN_FFMPEG_OPT in /etc/default/jellyfin)
  → reads EDL for the input file, builds -af volume filter, injects it
  → reads preferences.json to filter by category/severity
  → execs real ffmpeg at /usr/lib/jellyfin-ffmpeg/ffmpeg
  → long filter chains (>4000 chars) use -filter_script:a to avoid OS arg limit

Jellyfin plugin (JellyFilter.dll)
  → IPluginServiceRegistrator + IHostedService (Jellyfin 10.9+ pattern)
  → PlaybackStart hook: strips DirectPlayProfiles to force transcoding
  → REST API at /jellyfilter/preferences, /jellyfilter/edl/{id}

Companion UI (React, port 3500)
  → library grid with Filtered/Pending/No Data badges
  → per-item EDL viewer + transcript viewer
  → processing queue + preferences
```

## Shared data directory

The whisper pipeline, wrapper, and plugin all share a directory (typically on NFS or a Docker volume):

| Path | Contents |
|---|---|
| `{edl_dir}/{jellyfin-id}.jellyfilter.json` | EDL per item |
| `{edl_dir}/../jellyfilter.db` | SQLite queue + transcripts |
| `{edl_dir}/../preferences.json` | Global filter preferences |

Configure this path in:
- `whisper-pipeline/config.yaml` → `metadata_dir`
- `plugin/JellyFilter/Configuration/PluginConfiguration.cs` → `EdlDir`
- `plugin/ffmpeg-wrapper/jellyfilter-ffmpeg` → `EDL_DIR`

---

## Whisper pipeline (Python)

**Source:** `whisper-pipeline/src/`

Key files:
- `main.py` — main loop: reset stale queue → start API server → scan → watch → process one at a time
- `transcriber.py` — faster-whisper wrapper, `word_timestamps=True` required for precise timings
- `profanity_detector.py` — two-layer: regex strong list (confidence 0.99) → ML model fallback (≥0.70)
- `edl_writer.py` — writes EDL JSON with padding applied to each hit
- `db.py` — SQLite queue (new→processing→done/failed) + transcript store
- `watcher.py` — watchdog filesystem monitor + initial scan
- `api_server.py` — stdlib HTTP server on port 8765

**Profanity word list targets:** fuck, shit, bitch, bastard, goddamn, asshole, cunt, cock, dick, pussy, whore, slut, racial slurs (require double-g pattern). Allowlist: hell, damn, damned, heck, crap, ass.

**Known false positive fix:** The N-word regex requires `nigg` (double-g) not just `nig` — original pattern `\bn+i+g+\w+` incorrectly matched "night". Fixed pattern: `\bn[i!1]+gg[aeiouh]\w*`.

**GPU:** Defaults to `device=cpu, compute_type=int8`. For CUDA, set `device: cuda, compute_type: float16` in config.yaml and rebuild the Docker image using a CUDA base image.

---

## Jellyfin plugin (C#)

**Source:** `plugin/JellyFilter/`  
Built against Jellyfin 10.11.6 with .NET 9 SDK.

NuGet packages:
- `Jellyfin.Controller` v10.11.6 — `<ExcludeAssets>runtime</ExcludeAssets>` **REQUIRED** or the plugin fails to load
- `Jellyfin.Model` v10.11.6 — same

**Namespace gotchas (don't repeat these mistakes):**
- `IServerApplicationHost` → `using MediaBrowser.Controller;`
- `PlaybackProgressEventArgs` → `using MediaBrowser.Controller.Library;` (NOT Session)
- `ClientCapabilities` → `using MediaBrowser.Model.Session;` (NOT Model.Devices)
- `IAuthorizationContext.GetAuthorizationInfo()` → returns `Task<AuthorizationInfo>`, must be awaited
- `MediaStreamProtocol` → does not exist in 10.11; omit TranscodingProfiles from ClientCapabilities
- `IServerEntryPoint` → removed in Jellyfin 10.9; use `IPluginServiceRegistrator` + `IHostedService`

---

## ffmpeg wrapper

**Source:** `plugin/ffmpeg-wrapper/jellyfilter-ffmpeg`  
**Install to:** `/usr/local/bin/jellyfilter-ffmpeg` on the Jellyfin host

Configure Jellyfin to use it via `JELLYFIN_FFMPEG_OPT` in `/etc/default/jellyfin`:
```
JELLYFIN_FFMPEG_OPT="--ffmpeg=/usr/local/bin/jellyfilter-ffmpeg"
```

`REAL_FFMPEG` is set at the top of the wrapper script — update if jellyfin-ffmpeg is installed elsewhere. Also symlink ffprobe (Jellyfin looks for it in the same directory as ffmpeg):
```bash
ln -s /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe
```

---

## Companion UI

**Source:** `companion-ui/src/`

On first launch the Setup page asks for Jellyfin server URL and API key (stored in localStorage). The JellyFilter API URL defaults to `http://localhost:8765` and can be overridden:
```js
localStorage.setItem("jellyfilter:api_url", "http://your-docker-host:8765")
```

**localStorage keys:**
- `jellyfilter:jellyfin_url` — Jellyfin server URL
- `jellyfilter:api_key` — Jellyfin API key
- `jellyfilter:api_url` — JellyFilter API URL override

**Library deduplication:** Items are deduped by `Name + ProductionYear` client-side. Jellyfin returns one item per video file; multi-version movies create duplicates without this.

---

## Deploy

See `deploy.sh` (whisper + UI + wrapper) and `plugin/build.sh` (C# plugin). Both scripts have configuration variables at the top — edit them before running.

The scripts assume a Proxmox LXC setup (two containers: one for Docker, one for Jellyfin). If your setup differs, the scripts serve as a reference for the steps involved — adapt the copy/SSH commands as needed.

---

## Phase 2 (not built)

- **Per-user session filtering:** Plugin writes session prefs on PlaybackStart; wrapper reads by PlaySessionId. Enables true per-user filtering.
- **Per-movie entry overrides:** Confirm/suppress individual EDL entries per user per item.
- **Scene skipping:** `type: "skip"` entries in EDL. Wrapper injects ffmpeg segment skip logic or plugin injects chapter markers.
- **Severity controls per user:** Already stored in preferences + wrapper already filters by severity; needs UI wiring per-user.
- **Transcript viewer in UI:** API endpoint exists (`/jellyfilter/transcript/{id}`), needs a UI page.
