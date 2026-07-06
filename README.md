# JellyFilter

Transparent content filtering for Jellyfin. Whisper transcribes your media library to detect profanity, and NudeNet scans frames to detect explicit visual content — both are muted at transcode time across every Jellyfin client, with no client-side changes required.

## How it works

```
┌─────────────────────────────────────────────────────┐
│  Whisper Pipeline (Docker)                          │
│  Scans media → transcribes → detects profanity      │
│  → extracts frames → NudeNet visual detection       │
│  → writes EDL JSON files to shared storage          │
└───────────────────┬─────────────────────────────────┘
                    │  {edl_dir}/{jellyfin-id}.jellyfilter.json
┌───────────────────▼─────────────────────────────────┐
│  ffmpeg Wrapper (/usr/local/bin/jellyfilter-ffmpeg)  │
│  Intercepts every Jellyfin transcode                 │
│  → reads EDL → injects -af volume mute filter        │
│  → exec's real ffmpeg with modified args             │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│  Jellyfin Plugin (JellyFilter.dll)                  │
│  → REST API at /jellyfilter/*                        │
│  → per-user preferences                             │
│  → forces transcoding by stripping DirectPlayProfiles│
└─────────────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│  Companion UI (React, port 3500)                    │
│  → library grid with Filtered/Pending/No Data badges │
│  → per-item EDL viewer + transcript                  │
│  → processing queue                                  │
│  → preferences (category toggles)                   │
└─────────────────────────────────────────────────────┘
```

### Key design constraint

Jellyfin's plugin API has no hook for injecting ffmpeg arguments — `EncodingHelper` builds the command internally with no extension point. The ffmpeg wrapper is the only plugin-safe solution: Jellyfin's ffmpeg path setting points at the wrapper, which reads EDL files and injects `-af volume=enable='between(t,X,Y)':volume=0` filters before calling the real binary.

---

## Components

| Directory | Language | Purpose |
|---|---|---|
| `whisper-pipeline/` | Python 3.11 | Transcription, profanity detection, NudeNet visual detection |
| `plugin/` | C# .NET 9 | REST API + force-transcode logic |
| `plugin/ffmpeg-wrapper/` | Python | ffmpeg intercept + filter injection |
| `companion-ui/` | React/Vite/Tailwind | Management interface |

---

## Requirements

- **Jellyfin host** — Jellyfin 10.11.x installed as a native package (not Docker). The wrapper binary and plugin DLL are installed here.
- **Docker host** — runs the whisper pipeline and companion UI containers. Can be the same machine as Jellyfin, or separate.
- **Shared storage** — a directory both hosts can read/write (NFS share, Docker volume, or local path if co-hosted). This is where EDL files and the SQLite database live.

---

## EDL Schema

One file per media item at `{edl_dir}/{jellyfin-item-id}.jellyfilter.json`:

```json
{
  "version": 1,
  "media_id": "jellyfin-item-id",
  "media_path": "/mnt/media/Movies/Example (2024)/Example.mkv",
  "duration_seconds": 7200.0,
  "generated_at": "2025-01-01T00:00:00Z",
  "entries": [
    {
      "id": "uuid-v4",
      "start": 234.52,
      "end": 234.89,
      "type": "mute",
      "category": "profanity",
      "severity": "strong",
      "word": "fuck",
      "confidence": 0.99,
      "source": "whisper-auto",
      "confirmed": false
    }
  ]
}
```

`type`: `mute` | `skip` (skip not yet implemented)  
`category`: `profanity` | `sexual-content` | `violence` | `substance-use`  
`severity`: `mild` | `moderate` | `strong`  
`source`: `whisper-auto` | `manual` | `imported`

---

## Detection

### Profanity (audio)

Two-layer approach:

1. **Regex word list** (high confidence, no ML) — targets variants of: `fuck`, `shit`, `bitch`, `bastard`, `goddamn`, `asshole`, `cunt`, `cock`, `dick`, `pussy`, `whore`, `slut`, racial slurs. Confidence is always 0.99.
2. **`profanity-check` ML model** (fallback) — catches borderline language at ≥70% probability.

**Intentionally allowed:** `hell`, `damn`, `damned`, `heck`, `crap`, `ass`

Each detected word gets ±0.15s padding applied before writing to the EDL.

### Sexual content (visual)

[NudeNet](https://github.com/notAI-tech/NudeNet) frame analysis — disabled by default, enable in `config.yaml`:

```yaml
nudity:
  enabled: true
  frame_rate: 1.0            # frames per second to extract
  confidence_threshold: 0.5
  min_scene_duration: 1.0    # seconds — drop short false positives
  merge_gap: 3.0             # seconds — merge nearby detections into one scene
```

ffmpeg extracts frames at the configured rate, NudeNet scores each frame, and nearby positive frames are merged into scenes. Detected scenes are written to the EDL as `category: "sexual-content"` entries alongside any profanity entries.

---

## Whisper Configuration

`whisper-pipeline/config.yaml`:

```yaml
whisper:
  model: small.en      # small.en (~500MB, ~1x realtime on CPU)
                       # medium.en (~1.5GB, better accuracy, upgrade if RAM allows)
  device: cpu          # or cuda if you have a CUDA GPU
  compute_type: int8   # use float16 with cuda

media_paths:
  - /mnt/media/Movies
  - /mnt/media/TV

metadata_dir: /mnt/jellyfilter/edl

jellyfin:
  base_url: http://your-jellyfin-host:8096
  api_key: ""          # set via JELLYFIN_API_KEY env var

profanity:
  padding_before: 0.15
  padding_after: 0.15
```

The pipeline processes one file at a time, saves the full transcript text to SQLite, then writes the EDL. On startup it scans the media directories and queues any unprocessed files. A `watchdog` filesystem monitor queues new files as they arrive.

---

## Deploy

### First-time setup

1. **Edit deploy variables** — open `deploy.sh` and `plugin/build.sh` and set the variables at the top to match your environment (SSH hostname, container IDs, etc.)

2. **Deploy whisper pipeline + UI + ffmpeg wrapper:**
   ```bash
   ./deploy.sh
   ```

3. **Build and install the C# plugin:**
   ```bash
   ./plugin/build.sh
   ```

4. **Add your Jellyfin API key** — get it from Jellyfin Dashboard → API Keys, then set `JELLYFIN_API_KEY` in your Docker environment (`.env` file or compose environment).

5. **Point Jellyfin at the wrapper** — in `/etc/default/jellyfin` on the Jellyfin host:
   ```
   JELLYFIN_FFMPEG_OPT="--ffmpeg=/usr/local/bin/jellyfilter-ffmpeg"
   ```
   Then restart Jellyfin.

6. **Open the companion UI** at `http://your-docker-host:3500` and complete the Setup page.

### Redeploy after code changes

```bash
# Full redeploy (whisper + UI + wrapper)
./deploy.sh

# Plugin only
./plugin/build.sh
```

---

## Plugin (C#)

Built against `Jellyfin.Controller` + `Jellyfin.Model` v10.11.6, targeting .NET 9.

**Must match the installed Jellyfin version exactly.** The NuGet packages must include `<ExcludeAssets>runtime</ExcludeAssets>` or the plugin fails to load.

See `CLAUDE.md` for namespace gotchas and build notes.

---

## Phase 2 (not built)

- Per-movie entry overrides (confirm/suppress individual detections)
- Per-user filtering via session files (C# plugin writes session prefs, wrapper reads by PlaySessionId)
- Scene skipping (`type: "skip"` entries in EDL)
- Severity-based filter controls per user
- Raw transcript viewer in UI
- Timeline visualization of detections
