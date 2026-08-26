#!/bin/bash
# ============================================================================
# fetch.sh — backgrounded, cooldown-gated, read-only upstream refresh.
# ============================================================================

set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"

CONFIG_FILE="$HOOK_DIR/config.json"
STATE_DIR="$HOOK_DIR/state"
TS_FILE="$STATE_DIR/last-fetch-ts"
LOCK_FILE="$STATE_DIR/fetch.lock"

command -v git >/dev/null 2>&1 || exit 0
git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

read_num() {
  if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG_FILE" ]; then
    local v; v="$(jq -r "$1 // empty" "$CONFIG_FILE" 2>/dev/null)"
    case "$v" in (''|*[!0-9]*) : ;; (*) printf '%s' "$v"; return ;; esac
  fi
  if [ -f "$CONFIG_FILE" ]; then
    local v; v="$(grep -o "\"$2\"[[:space:]]*:[[:space:]]*[0-9]*" "$CONFIG_FILE" 2>/dev/null \
                  | head -1 | grep -o '[0-9]*$')"
    case "$v" in (''|*[!0-9]*) : ;; (*) printf '%s' "$v"; return ;; esac
  fi
  printf '%s' "$3"
}
COOLDOWN="$(read_num '.fetchCooldownSeconds' 'fetchCooldownSeconds' '600')"

if [ -f "$TS_FILE" ]; then
  LAST="$(cat "$TS_FILE" 2>/dev/null || echo 0)"
  case "$LAST" in (*[!0-9]*|'') LAST=0 ;; esac
  ELAPSED=$(( $(date +%s) - LAST ))
  [ "$ELAPSED" -lt "$COOLDOWN" ] && exit 0
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 0
else
  if ! ( set -o noclobber; echo $$ > "$LOCK_FILE" ) 2>/dev/null; then
    LOCK_PID="$(cat "$LOCK_FILE" 2>/dev/null)"
    if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
      exit 0
    fi
    rm -f "$LOCK_FILE"
    ( set -o noclobber; echo $$ > "$LOCK_FILE" ) 2>/dev/null || exit 0
  fi
  trap 'rm -f "$LOCK_FILE"' EXIT
fi

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
if GIT_TERMINAL_PROMPT=0 git -C "$PROJECT_DIR" fetch --quiet --prune 2>/dev/null; then
  date +%s > "$TS_FILE" 2>/dev/null || true
fi

exit 0
