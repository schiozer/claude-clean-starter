#!/bin/bash
# ============================================================================
# run.sh — dependency-check hook (SessionStart).
# ============================================================================
#
# Warns when the `remember` plugin is not installed/enabled. Advisory only —
# never blocks or fails the session. Always exits 0.
# ============================================================================

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"

PLUGIN="remember@claude-plugins-official"
INSTALLED_FILE="$HOME/.claude/plugins/installed_plugins.json"
PROJECT_SETTINGS="$PROJECT_DIR/.claude/settings.json"
USER_SETTINGS="$HOME/.claude/settings.json"

warn() {
  printf 'dependency check: %s\n' "$1" >&2
}

if command -v node >/dev/null 2>&1; then
  node - "$PLUGIN" "$INSTALLED_FILE" "$PROJECT_SETTINGS" "$USER_SETTINGS" <<'NODE' 2>/dev/null || true
const [plugin, installedFile, projectSettings, userSettings] = process.argv.slice(2);
const fs = require("node:fs");

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const installed = readJson(installedFile);
const isInstalled =
  !!installed &&
  installed.plugins &&
  Object.prototype.hasOwnProperty.call(installed.plugins, plugin);

const enabledIn = (p) => {
  const s = readJson(p);
  return !!(s && s.enabledPlugins && s.enabledPlugins[plugin] === true);
};
const isEnabled = enabledIn(projectSettings) || enabledIn(userSettings);

if (installed === null) process.exit(0);

if (!isInstalled) {
  process.stderr.write(
    `dependency check: the '${plugin}' plugin is not installed. ` +
      `Install it via /plugin (marketplace claude-plugins-official) for cross-session memory.\n`
  );
} else if (!isEnabled) {
  process.stderr.write(
    `dependency check: the '${plugin}' plugin is installed but not enabled. ` +
      `Enable it via /plugin so cross-session memory works.\n`
  );
}
process.exit(0);
NODE
else
  if [ -f "$INSTALLED_FILE" ] && ! grep -q "$PLUGIN" "$INSTALLED_FILE" 2>/dev/null; then
    warn "the '$PLUGIN' plugin appears to be missing. Install it via /plugin for cross-session memory."
  fi
fi

exit 0
