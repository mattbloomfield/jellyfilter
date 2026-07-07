#!/usr/bin/env bash
# deploy.sh — Deploy JellyFilter whisper pipeline, companion UI, and ffmpeg wrapper.
#
# This script assumes a Proxmox LXC setup with two containers:
#   DOCKER_CT  — runs the Docker stack (whisper pipeline + UI)
#   JELLYFIN_CT — runs Jellyfin natively
#
# If your setup differs, use this script as a reference and adapt the
# copy/exec commands to your environment.
set -euo pipefail

# ── Configure these for your environment ────────────────────────────────────
PROXMOX_HOST="${PROXMOX_HOST:-your-proxmox-host}"   # SSH hostname for your Proxmox node
DOCKER_CT="${DOCKER_CT:-207}"                       # LXC container ID running Docker
JELLYFIN_CT="${JELLYFIN_CT:-205}"                   # LXC container ID running Jellyfin
REAL_FFMPEG="/usr/lib/jellyfin-ffmpeg/ffmpeg"
# ────────────────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Step 1: Sync repo to Proxmox host ==="
ssh "$PROXMOX_HOST" "mkdir -p /tmp/jellyfilter-deploy"
rsync -av --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  "$REPO_ROOT/" "$PROXMOX_HOST:/tmp/jellyfilter-deploy/"

echo ""
echo "=== Step 2: Push repo into CT $DOCKER_CT via pct ==="
ssh "$PROXMOX_HOST" "bash -s" << PROXMOX
set -euo pipefail
cd /tmp
tar czf jellyfilter.tar.gz -C jellyfilter-deploy .
pct push $DOCKER_CT /tmp/jellyfilter.tar.gz /tmp/jellyfilter.tar.gz
pct exec $DOCKER_CT -- bash -c "mkdir -p /root/jellyfilter && tar xzf /tmp/jellyfilter.tar.gz -C /root/jellyfilter"
echo "Repo pushed into CT $DOCKER_CT at /root/jellyfilter"
PROXMOX

echo ""
echo "=== Step 3: Set up EDL directory on shared storage (from CT $DOCKER_CT) ==="
ssh "$PROXMOX_HOST" "pct exec $DOCKER_CT -- bash -c 'mkdir -p /mnt/nfs-media/jellyfilter/edl; chmod -R 777 /mnt/nfs-media/jellyfilter 2>/dev/null || true'"

echo ""
echo "=== Step 4: Append jellyfilter services to docker-compose in CT $DOCKER_CT ==="
ssh "$PROXMOX_HOST" "pct exec $DOCKER_CT -- bash -s" << 'CT_DOCKER'
set -euo pipefail
COMPOSE=/root/media-stack/docker-compose.yml

if grep -q "jellyfilter-whisper" "$COMPOSE"; then
  echo "jellyfilter services already in docker-compose — skipping"
else
  # Strip the comment header (first 3 lines) from the snippet and append
  tail -n +4 /root/jellyfilter/docker/docker-compose.jellyfilter.yml >> "$COMPOSE"
  echo "Appended jellyfilter services"
fi
CT_DOCKER

echo ""
echo "=== Step 5: Build and start jellyfilter containers in CT $DOCKER_CT ==="
ssh "$PROXMOX_HOST" "pct exec $DOCKER_CT -- bash -c 'cd /root/media-stack && docker compose up -d --build jellyfilter-whisper jellyfilter-ui'"

echo ""
echo "=== Step 6: Install ffmpeg wrapper in CT $JELLYFIN_CT ==="
ssh "$PROXMOX_HOST" "bash -s" << PROXMOX2
set -euo pipefail
pct push $JELLYFIN_CT /tmp/jellyfilter-deploy/plugin/ffmpeg-wrapper/jellyfilter-ffmpeg /usr/local/bin/jellyfilter-ffmpeg
echo "Wrapper pushed to CT $JELLYFIN_CT"
PROXMOX2

ssh "$PROXMOX_HOST" "pct exec $JELLYFIN_CT -- bash -c \"
  sed -i 's|PLACEHOLDER_REAL_FFMPEG|$REAL_FFMPEG|g' /usr/local/bin/jellyfilter-ffmpeg
  chmod +x /usr/local/bin/jellyfilter-ffmpeg
  echo 'Wrapper installed:'
  head -5 /usr/local/bin/jellyfilter-ffmpeg
\""

echo ""
echo "=== Done! ==="
echo ""
echo "NEXT STEPS:"
echo "  1. In Jellyfin Dashboard → Playback → FFmpeg path → set to: /usr/local/bin/jellyfilter-ffmpeg"
echo "     Or add to /etc/default/jellyfin: JELLYFIN_FFMPEG_OPT=\"--ffmpeg=/usr/local/bin/jellyfilter-ffmpeg\""
echo "  2. Get a Jellyfin API key: Dashboard → API Keys → + Add"
echo "  3. On the Docker host: echo 'JELLYFIN_API_KEY=<your-key>' >> /root/media-stack/.env"
echo "  4. Restart whisper: docker compose restart jellyfilter-whisper"
echo "  5. Open the companion UI at http://<docker-host>:3500"
