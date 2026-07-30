#!/usr/bin/env bash
# nightwatch-smart — publish SMART data for every physical disk to a JSON file
# that the unprivileged dashboard container can read.
#
# Why a host-side collector exists at all: smartctl needs root AND raw device
# nodes (/dev/nvme0n1, /dev/sda). The dashboard container runs as uid 1000 with
# no device nodes mounted at all. Handing a web-facing container CAP_SYS_RAWIO
# plus raw disk ioctls just to avoid one systemd timer is a bad trade. The
# container already bind-mounts / at /host/rootfs:ro, so it reads the file below
# with no docker-compose change and no new privilege.
#
# This script deliberately performs NO interpretation — it concatenates
# smartctl's own JSON verbatim. Every threshold, unit conversion and health
# judgement lives in src/lib/smart.ts, so changing how the dashboard reads SMART
# never requires touching the host again.
set -uo pipefail

OUT=${1:-/var/lib/nightwatch/smart.json}
TMP="$OUT.$$.tmp"

install -d -m 0755 "$(dirname "$OUT")"

version=$(smartctl --version 2>/dev/null | head -1 | awk '{print $2}')

emit_device() {
  local dev=$1 json
  # -n standby: never spin up a sleeping disk just to read its temperature.
  # smartd itself polls this way; waking an 8 TB archive drive every 5 minutes
  # would cost more drive life than the monitoring saves.
  #
  # smartctl's exit code is a BITMASK, not a success flag — bit 6 (64) means
  # "errors are recorded in the device's error log", which is precisely the
  # condition this card exists to surface. So never gate on the exit code:
  # always keep whatever JSON came back and let the reader decide from
  # smart_status and smartctl.messages.
  json=$(smartctl -a -j -n standby "$dev" 2>/dev/null)
  if [ -z "$json" ]; then
    json='{"smartctl":{"exit_status":-1,"messages":[{"severity":"error","string":"smartctl produced no output"}]}}'
  fi
  printf '{"device":"%s","json":%s}' "$dev" "$json"
}

{
  printf '{"ts":%s,"collector":"nightwatch-smart/1","smartctlVersion":"%s","devices":[' \
    "$(date +%s%3N)" "${version:-unknown}"

  first=1
  while read -r name type; do
    [ "$type" = "disk" ] || continue
    # Virtual and optical devices have no SMART data and only add noise.
    case "$name" in
      loop* | ram* | zram* | sr* | dm-*) continue ;;
    esac
    [ "$first" = 1 ] || printf ','
    first=0
    emit_device "/dev/$name"
  done < <(lsblk -dno NAME,TYPE 2>/dev/null)

  printf ']}'
} >"$TMP"

# Publish only a structurally complete file. A truncated write (smartctl hung,
# disk full, killed mid-run) leaves the previous good file in place, and the
# dashboard surfaces the ageing `ts` instead of rendering half a fleet.
if [ -s "$TMP" ] && [ "$(tail -c 2 "$TMP")" = "]}" ]; then
  chmod 0644 "$TMP"
  mv -f "$TMP" "$OUT"
else
  echo "nightwatch-smart: refusing to publish truncated output" >&2
  rm -f "$TMP"
  exit 1
fi
