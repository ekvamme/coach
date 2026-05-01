#!/bin/bash
# Daily Garmin pull → page regen → git push.
# Triggered by ~/Library/LaunchAgents/com.erik.coach-daily.plist at 22:00.
# Logs to ~/Library/Logs/coach-daily.log.

set -uo pipefail

REPO="/Users/kvamme/Desktop/exercise"
VENV_PYTHON="$REPO/.venv/bin/python"
NODE="/usr/local/bin/node"
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

if ! "$NODE" generate.js >> "$LOG" 2>&1; then
  log "FATAL: generate.js failed"
  exit 1
fi

if git diff --quiet -- state.json index.html; then
  log "no changes to commit"
else
  git add state.json index.html
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
