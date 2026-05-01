#!/bin/bash
# Daily Garmin pull → page regen → git push.
# Triggered by ~/Library/LaunchAgents/com.erik.coach-daily.plist at 22:00.
# Logs to ~/Library/Logs/coach-daily.log.

set -uo pipefail

REPO="/Users/kvamme/Desktop/exercise"
VENV_PYTHON="$REPO/.venv/bin/python"
NODE="/usr/local/bin/node"
CLAUDE="/usr/local/bin/claude"
LOG="$HOME/Library/Logs/coach-daily.log"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

log "=== daily sync start ==="

cd "$REPO" || { log "FATAL: repo not found at $REPO"; exit 1; }

if ! git pull --rebase --autostash >> "$LOG" 2>&1; then
  log "FATAL: git pull failed (likely conflict — resolve manually)"
  exit 1
fi

if ! "$VENV_PYTHON" garmin_fetch.py --no-login >> "$LOG" 2>&1; then
  log "WARN: garmin fetch failed (continuing with regen)"
fi

# Generate / update tomorrow's brief via headless Claude.
# Uses subscription auth (no API key). Runs after Garmin so it can react to
# fresh data; runs before regen so the new brief gets embedded in index.html.
PROMPT_FILE="$REPO/prompts/nightly_brief.md"
if [ ! -f "$PROMPT_FILE" ]; then
  log "WARN: brief prompt missing at $PROMPT_FILE"
else
  log "generating tomorrows brief..."
  BRIEF_PROMPT=$(cat "$PROMPT_FILE")
  if BRIEF_OUT=$("$CLAUDE" -p "$BRIEF_PROMPT" \
      --permission-mode bypassPermissions \
      --output-format text \
      --max-budget-usd 0.30 \
      --no-session-persistence \
      < /dev/null 2>&1); then
    echo "$BRIEF_OUT" | tail -3 >> "$LOG"
  else
    log "WARN: brief generation failed (continuing with regen)"
  fi
fi

if ! "$NODE" generate.js >> "$LOG" 2>&1; then
  log "FATAL: generate.js failed"
  exit 1
fi

if git diff --quiet -- state.json index.html garmin_history.jsonl; then
  log "no changes to commit"
else
  git add state.json index.html garmin_history.jsonl
  if ! git commit -m "auto: nightly garmin sync $(date '+%Y-%m-%d')" >> "$LOG" 2>&1; then
    log "FATAL: git commit failed"
    exit 1
  fi
  if ! git push >> "$LOG" 2>&1; then
    log "FATAL: git push failed"
    exit 1
  fi
  log "pushed updates"
fi

log "=== daily sync done ==="
