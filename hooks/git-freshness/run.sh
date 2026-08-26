#!/bin/bash
# ============================================================================
# run.sh — git-freshness hook (SessionStart).
# ============================================================================
#
# Using already-fetched refs (NO network), computes how far the current branch
# is behind/ahead of its upstream and prints a structured block to STDOUT so
# Claude Code injects it into session context. Then spawns a background fetch
# for the NEXT session. Never touches the working tree. Fail-open throughout.
# ============================================================================

set -u

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"

CONFIG_FILE="$HOOK_DIR/config.json"
STATE_DIR="$HOOK_DIR/state"
TS_FILE="$STATE_DIR/last-fetch-ts"

cat >/dev/null 2>&1 || true

read_cfg() {
  if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG_FILE" ]; then
    local v; v="$(jq -r "$1 // empty" "$CONFIG_FILE" 2>/dev/null)"
    [ -n "$v" ] && { printf '%s' "$v"; return; }
  fi
  if [ -f "$CONFIG_FILE" ]; then
    local v; v="$(grep -o "\"$2\"[[:space:]]*:[[:space:]]*[^,}]*" "$CONFIG_FILE" 2>/dev/null \
                  | head -1 | sed -E 's/.*:[[:space:]]*"?([^",}]*)"?.*/\1/')"
    [ -n "$v" ] && { printf '%s' "$v"; return; }
  fi
  printf '%s' "$3"
}

ENABLED="$(read_cfg '.enabled' 'enabled' 'true')"
[ "$ENABLED" = "false" ] && exit 0

FALLBACK_REF="$(read_cfg '.fallbackRef' 'fallbackRef' 'origin/main')"

command -v git >/dev/null 2>&1 || exit 0
git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

BRANCH="$(git -C "$PROJECT_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null)" || exit 0
[ -n "$BRANCH" ] || exit 0

UPSTREAM="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
if [ -z "$UPSTREAM" ]; then
  if git -C "$PROJECT_DIR" rev-parse --verify --quiet "$FALLBACK_REF" >/dev/null 2>&1; then
    UPSTREAM="$FALLBACK_REF"
  else
    exit 0
  fi
fi

COUNTS="$(git -C "$PROJECT_DIR" rev-list --left-right --count "${UPSTREAM}...HEAD" 2>/dev/null)" || exit 0
BEHIND="$(printf '%s' "$COUNTS" | awk '{print $1}')"
AHEAD="$(printf '%s' "$COUNTS" | awk '{print $2}')"
BEHIND="${BEHIND:-0}"; AHEAD="${AHEAD:-0}"

DIRTY_COUNT="$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | grep -c .)"
DIRTY_COUNT="${DIRTY_COUNT:-0}"
if [ "$DIRTY_COUNT" -gt 0 ]; then
  TREE_STATE="dirty (${DIRTY_COUNT} uncommitted change(s))"
else
  TREE_STATE="clean"
fi

FRESHNESS="never fetched in this session series (background refresh starting now)"
if [ -f "$TS_FILE" ]; then
  LAST_FETCH="$(cat "$TS_FILE" 2>/dev/null || echo 0)"
  case "$LAST_FETCH" in (*[!0-9]*|'') LAST_FETCH=0 ;; esac
  if [ "$LAST_FETCH" -gt 0 ]; then
    NOW="$(date +%s)"
    AGE=$(( NOW - LAST_FETCH ))
    [ "$AGE" -lt 0 ] && AGE=0
    if   [ "$AGE" -lt 60 ];    then FRESHNESS="as of last fetch, ${AGE}s ago"
    elif [ "$AGE" -lt 3600 ];  then FRESHNESS="as of last fetch, $(( AGE / 60 ))m ago"
    elif [ "$AGE" -lt 86400 ]; then FRESHNESS="as of last fetch, $(( AGE / 3600 ))h ago"
    else                            FRESHNESS="as of last fetch, $(( AGE / 86400 ))d ago"
    fi
  fi
fi

if [ "$BEHIND" -gt 0 ]; then
  printf '=== GIT UPSTREAM ===\n'
  printf 'branch: %s\n' "$BRANCH"
  printf 'upstream: %s\n' "$UPSTREAM"
  printf 'behind: %s  ahead: %s\n' "$BEHIND" "$AHEAD"
  printf 'working tree: %s\n' "$TREE_STATE"
  printf 'freshness: %s\n' "$FRESHNESS"
  printf 'AGENT GUIDANCE: The local branch is %s commit(s) behind %s. ' "$BEHIND" "$UPSTREAM"
  printf 'OFFER the user to pull/rebase; do NOT run it automatically. '
  if [ "$DIRTY_COUNT" -gt 0 ]; then
    printf 'The working tree is dirty — suggest stashing or committing first, or `git pull --rebase --autostash`. '
  fi
  if [ "$AHEAD" -gt 0 ]; then
    printf 'The branch is also %s commit(s) ahead, so a rebase (not a fast-forward) is needed. ' "$AHEAD"
  fi
  printf 'These counts are from cached refs (%s); a background refresh is running for next session.\n' "$FRESHNESS"
  printf '=== END GIT UPSTREAM ===\n'
else
  printf '=== GIT UPSTREAM ===\n'
  printf 'branch: %s  upstream: %s  up to date (ahead: %s)  tree: %s  [%s]\n' \
    "$BRANCH" "$UPSTREAM" "$AHEAD" "$TREE_STATE" "$FRESHNESS"
  printf '=== END GIT UPSTREAM ===\n'
fi

if [ -x "$HOOK_DIR/fetch.sh" ]; then
  CLAUDE_PROJECT_DIR="$PROJECT_DIR" "$HOOK_DIR/fetch.sh" </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

exit 0
