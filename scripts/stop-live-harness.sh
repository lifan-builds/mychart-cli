#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="$ROOT_DIR/browser_profiles/awesome-mychart-live"
DEBUG_PORT="${AWESOME_MYCHART_DEBUG_PORT:-9223}"

profile_pids="$(pgrep -f -- "--user-data-dir=$PROFILE_DIR" || true)"
port_pids="$(pgrep -f -- "--remote-debugging-port=$DEBUG_PORT" || true)"
pids="$(printf "%s\n%s\n" "$profile_pids" "$port_pids" | awk 'NF && !seen[$0]++')"

if [[ -z "$pids" ]]; then
  echo "No mychart-cli live harness Chrome process found."
  exit 0
fi

echo "Stopping mychart-cli live harness Chrome process(es):"
printf "  %s\n" $pids

while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  kill "$pid" 2>/dev/null || true
done <<< "$pids"

sleep 1

remaining="$(printf "%s\n" "$pids" | while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  if kill -0 "$pid" 2>/dev/null; then
    echo "$pid"
  fi
done)"

if [[ -n "$remaining" ]]; then
  echo "Some harness processes are still running after SIGTERM:"
  printf "  %s\n" $remaining
  echo "Close the visible Chrome window or rerun this script."
else
  echo "Harness stopped."
fi
