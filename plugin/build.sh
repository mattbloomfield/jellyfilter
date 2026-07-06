#!/usr/bin/env bash
# Build the JellyFilter Jellyfin plugin and deploy to the Jellyfin host.
#
# This script assumes a Proxmox LXC setup. If your setup differs, adapt the
# scp/ssh commands to copy the compiled DLL to your Jellyfin host.
set -euo pipefail

# ── Configure these for your environment ────────────────────────────────────
PROXMOX_HOST="your-proxmox-host"   # SSH hostname for your Proxmox node
JELLYFIN_CT="205"                   # LXC container ID running Jellyfin
# ────────────────────────────────────────────────────────────────────────────

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)/JellyFilter"
JELLYFIN_PLUGIN_PATH="/var/lib/jellyfin/plugins/JellyFilter"

echo "=== Building JellyFilter plugin ==="
dotnet publish "$PLUGIN_DIR" -c Release -o /tmp/jellyfilter-plugin-dist

echo "=== Deploying to CT $JELLYFIN_CT (Jellyfin) ==="
ssh "$PROXMOX_HOST" "pct exec $JELLYFIN_CT -- mkdir -p $JELLYFIN_PLUGIN_PATH"

scp /tmp/jellyfilter-plugin-dist/JellyFilter.dll "$PROXMOX_HOST:/tmp/JellyFilter.dll"
ssh "$PROXMOX_HOST" "pct exec $JELLYFIN_CT -- bash -c 'cp /tmp/JellyFilter.dll $JELLYFIN_PLUGIN_PATH/'"

# Copy SQLite dependencies
for dll in /tmp/jellyfilter-plugin-dist/Microsoft.Data.Sqlite.dll /tmp/jellyfilter-plugin-dist/SQLitePCLRaw.*.dll; do
  [ -f "$dll" ] && scp "$dll" "$PROXMOX_HOST:/tmp/" && \
    ssh "$PROXMOX_HOST" "pct exec $JELLYFIN_CT -- bash -c 'cp /tmp/$(basename $dll) $JELLYFIN_PLUGIN_PATH/'" || true
done

echo "=== Restarting Jellyfin ==="
ssh "$PROXMOX_HOST" "pct exec $JELLYFIN_CT -- systemctl restart jellyfin"

echo "=== Done — plugin deployed to $JELLYFIN_PLUGIN_PATH ==="
