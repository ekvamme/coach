#!/bin/bash
# Quick health check for the nightly daily_sync.sh job.
# Usage: ./coach_status.sh

LOG="$HOME/Library/Logs/coach-daily.log"
PLIST_LABEL="com.erik.coach-daily"

if [ ! -f "$LOG" ]; then
  echo "No log file yet at $LOG — script hasn't run."
  exit 0
fi

echo "=== Launch agent ==="
if launchctl list | grep -q "$PLIST_LABEL"; then
  echo "  loaded: yes"
else
  echo "  loaded: NO — run: launchctl load ~/Library/LaunchAgents/${PLIST_LABEL}.plist"
fi

echo
echo "=== Wake schedule (pmset) ==="
pmset -g sched | grep -E "wake|poweron" | sed 's/^/  /' || echo "  none — run: sudo pmset repeat wakeorpoweron MTWRFSU 21:55:00"

echo
echo "=== Last 5 runs ==="
# Each run is bracketed by "=== daily sync start ===" / "=== daily sync done ===".
# Pull start lines, then for each, summarize what happened between start and the next start (or end of file).
awk '
  /=== daily sync start ===/ {
    if (run_count > 0) print_run()
    run_count++
    start_ts = substr($0, 2, 19)
    outcome = "incomplete"
    detail = ""
    next
  }
  /Pulling last/ { in_pull = 1; pull_summary = ""; next }
  in_pull && /activities|sleep records|resting-HR records/ {
    gsub(/^ +/, "", $0)
    pull_summary = pull_summary (pull_summary == "" ? "" : ", ") $0
    next
  }
  /WARN: garmin fetch failed/ { detail = "garmin fetch FAILED"; next }
  /FATAL:/ {
    outcome = "FAIL"
    sub(/^\[[^\]]+\] FATAL: /, "")
    detail = $0
    next
  }
  /no changes to commit/ { outcome = "no-changes"; next }
  /pushed updates/ { outcome = "pushed"; next }
  /=== daily sync done ===/ { in_pull = 0; next }
  END { if (run_count > 0) print_run() }
  function print_run() {
    label = outcome
    if (label == "pushed" || label == "no-changes") tag = "[OK]"
    else if (label == "FAIL") tag = "[FAIL]"
    else tag = "[??]"
    line = "  " tag "  " start_ts "  " label
    if (pull_summary != "") line = line "  (" pull_summary ")"
    if (detail != "") line = line "  — " detail
    print line
    pull_summary = ""
    detail = ""
  }
' "$LOG" | tail -5

echo
echo "=== Latest brief (from log) ==="
grep "^BRIEF:" "$LOG" | tail -1 | sed 's/^/  /' || echo "  none yet"

echo
echo "=== Last 12 raw log lines ==="
tail -12 "$LOG" | sed 's/^/  /'
