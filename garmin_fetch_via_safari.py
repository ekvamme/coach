#!/usr/bin/env python3
"""
Fallback Garmin fetcher when SSO is rate-limited.

Drives an already-logged-in Safari tab via AppleScript to pull last N days
of activities, sleep, and RHR through /gc-api/, then imports into state.json.

One-time setup:
  Safari -> Develop -> "Allow JavaScript from Apple Events"
  (Develop menu: Safari -> Settings -> Advanced -> "Show features for web developers")

Each run:
  Have Safari open with a logged-in tab on connect.garmin.com (any page) as
  the frontmost tab, then:

      python3 garmin_fetch_via_safari.py
      python3 garmin_fetch_via_safari.py --days 30

Discovered auth pattern (from /web-react/static/js/index__bundle__*.js):
  1. POST /services/auth/token/di-oauth/refresh with header
     `Connect-Csrf-Token: <meta[name=csrf-token]>` to refresh the session.
  2. Subsequent /gc-api/<service>/... requests work with that same header.
  3. Per-day endpoints take displayName (a UUID) as the path arg, not email.
     It's exposed at window.VIEWER_SOCIAL_PROFILE.displayName.
"""

import argparse
import datetime
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
STATE_PATH = ROOT / "state.json"
DUMP_PATH = ROOT / "garmin-dump.json"
DOWNLOADS = Path.home() / "Downloads"

ACTIVITY_TYPE_MAP = {
    "running": "Run",
    "trail_running": "Trail run",
    "cycling": "Bike",
    "road_biking": "Road bike",
    "mountain_biking": "MTB",
    "indoor_cycling": "Indoor bike",
    "hiking": "Hike",
    "walking": "Walk",
    "rock_climbing": "Climb",
    "indoor_climbing": "Climb",
    "strength_training": "Strength",
    "yoga": "Yoga",
    "lap_swimming": "Swim",
    "open_water_swimming": "Swim",
}


def osa(script):
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f"AppleScript failed: {r.stderr.strip()}")
    return r.stdout.rstrip("\n")


def osa_js_file(path):
    return osa(f'tell application "Safari" to do JavaScript (read POSIX file "{path}" as «class utf8») in front document')


def osa_js_inline(js_one_line):
    escaped = js_one_line.replace("\\", "\\\\").replace('"', '\\"')
    return osa(f'tell application "Safari" to do JavaScript "{escaped}" in front document')


def check_safari_on_garmin():
    info = osa_js_inline('document.title + "|" + location.href')
    if "connect.garmin.com" not in info:
        sys.exit(
            "ERROR: Safari front tab is not on connect.garmin.com.\n"
            f"  got: {info}\n"
            "Open https://connect.garmin.com/ (logged in) and bring that tab to the front, then re-run."
        )
    return info


PULL_JS_TEMPLATE = r"""
window.__safari_garmin_done = false;
window.__safari_garmin_result = null;
(async () => {
  try {
    const csrfMeta = document.querySelector('meta[name=csrf-token]');
    if (!csrfMeta) throw new Error('no csrf meta tag — page not fully logged in');
    const csrf = csrfMeta.content;
    const headers = {'Connect-Csrf-Token': csrf};
    const days = __DAYS__;
    const out = { activities: null, sleep: [], rhr: [], errors: [], generated: new Date().toISOString() };

    // refresh DI session first
    const rr = await fetch('/services/auth/token/di-oauth/refresh', {
      method: 'POST', credentials: 'include',
      headers: {...headers, 'Content-Type': 'application/json'}, body: '{}'
    });
    if (!rr.ok && rr.status !== 201) out.errors.push('refresh ' + rr.status);

    // get displayName via API rather than window var (more reliable across page state)
    let dn = (window.VIEWER_SOCIAL_PROFILE && window.VIEWER_SOCIAL_PROFILE.displayName) || '';
    if (!dn) {
      const pr = await fetch('/gc-api/userprofile-service/socialProfile', {credentials:'include', headers});
      if (pr.ok) {
        const pj = await pr.json();
        dn = pj.displayName || '';
      } else {
        throw new Error('socialProfile ' + pr.status + ' — session may need refresh (reload connect.garmin.com)');
      }
    }
    if (!dn) throw new Error('could not resolve displayName');
    out.displayName = dn;

    try {
      const r = await fetch('/gc-api/activitylist-service/activities/search/activities?limit=' + Math.max(50, days*3) + '&start=0',
                            {credentials:'include', headers});
      if (r.ok) out.activities = await r.json();
      else out.errors.push('activities ' + r.status);
    } catch(e) { out.errors.push('activities err ' + e.message); }

    for (let i = 1; i <= days; i++) {
      const d = new Date(Date.now() - i*86400000).toISOString().slice(0,10);
      try {
        const r = await fetch('/gc-api/wellness-service/wellness/dailySleepData/' + dn + '?date=' + d,
                              {credentials:'include', headers});
        if (r.ok) out.sleep.push({date: d, data: await r.json()});
      } catch(e) {}
    }
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i*86400000).toISOString().slice(0,10);
      try {
        const r = await fetch('/gc-api/usersummary-service/usersummary/daily/' + dn + '?calendarDate=' + d,
                              {credentials:'include', headers});
        if (r.ok) out.rhr.push({date: d, data: await r.json()});
      } catch(e) {}
    }

    window.__safari_garmin_result = JSON.stringify(out);
  } catch (e) {
    window.__safari_garmin_result = JSON.stringify({fatal: e.message});
  } finally {
    window.__safari_garmin_done = true;
  }
})();
'kicked'
"""


DOWNLOAD_JS = r"""
(() => {
  if (!window.__safari_garmin_result) return 'no-result';
  const blob = new Blob([window.__safari_garmin_result], {type: 'application/json'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'garmin-dump.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return 'downloaded';
})()
"""


def fmt_dur(s):
    if not s:
        return ""
    s = int(s)
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def fmt_mi(m):
    return f"{m/1609.344:.1f} mi" if m else ""


def import_dump(dump):
    activities = []
    for a in dump.get("activities") or []:
        start = (a.get("startTimeLocal") or "")[:10]
        if not start:
            continue
        raw = (a.get("activityType") or {}).get("typeKey") or ""
        label = ACTIVITY_TYPE_MAP.get(raw, raw.replace("_", " ").title() or "Activity")
        bits = [b for b in [
            fmt_mi(a.get("distance")),
            fmt_dur(a.get("duration")),
            f"avg HR {int(a['averageHR'])}" if a.get("averageHR") else None,
        ] if b]
        activities.append({
            "date": start,
            "type": label,
            "detail": " · ".join(bits),
            "raw_type": raw,
            "elevation_gain_m": a.get("elevationGain"),
            "training_load": a.get("activityTrainingLoad"),
        })
    activities.sort(key=lambda x: x["date"], reverse=True)

    sleep = []
    for s in dump.get("sleep") or []:
        dto = (s.get("data") or {}).get("dailySleepDTO") or {}
        total = dto.get("sleepTimeSeconds")
        if not total:
            continue
        deep = dto.get("deepSleepSeconds")
        score = (dto.get("sleepScores") or {}).get("overall", {}).get("value")
        bits = [fmt_dur(total) + " sleep"]
        if deep:
            bits.append(f"{fmt_dur(deep)} deep")
        if score:
            bits.append(f"score {score}")
        sleep.append({
            "date": s["date"],
            "summary": " · ".join(bits),
            "total_seconds": total,
            "deep_seconds": deep,
            "score": score,
        })
    sleep.sort(key=lambda x: x["date"], reverse=True)

    rhr = []
    for r in dump.get("rhr") or []:
        bpm = (r.get("data") or {}).get("restingHeartRate")
        if bpm:
            rhr.append({"date": r["date"], "bpm": bpm})
    rhr.sort(key=lambda x: x["date"], reverse=True)

    state = json.loads(STATE_PATH.read_text())
    state.setdefault("garmin", {})
    state["garmin"]["last_synced"] = datetime.date.today().isoformat()
    state["garmin"]["recent_activities"] = activities
    state["garmin"]["recent_sleep"] = sleep
    state["garmin"]["recent_resting_hr"] = rhr
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")
    return len(activities), len(sleep), len(rhr)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--keep-dump", action="store_true",
                   help="leave garmin-dump.json in the repo after import (default: deletes it)")
    args = p.parse_args()

    print("Checking Safari front tab...")
    print(f"  {check_safari_on_garmin()}")

    print(f"Pulling last {args.days} days via Safari...")
    js = PULL_JS_TEMPLATE.replace("__DAYS__", str(args.days))
    js_path = "/tmp/safari_garmin_pull.js"
    Path(js_path).write_text(js)
    osa_js_file(js_path)

    poll_js = ('window.__safari_garmin_done '
               '? "DONE size=" + (window.__safari_garmin_result || "").length '
               ': "pending"')
    for i in range(120):
        time.sleep(1)
        status = osa_js_inline(poll_js)
        if status.startswith("DONE"):
            print(f"  {status}")
            break
        if i and i % 10 == 0:
            print(f"  still working... ({status})")
    else:
        sys.exit("ERROR: timed out waiting for Safari to finish the pull")

    print("Triggering download to ~/Downloads/garmin-dump.json...")
    osa_js_file_inline = "/tmp/safari_garmin_download.js"
    Path(osa_js_file_inline).write_text(DOWNLOAD_JS)
    osa_js_file(osa_js_file_inline)

    src = DOWNLOADS / "garmin-dump.json"
    for _ in range(20):
        if src.exists():
            break
        time.sleep(0.25)
    if not src.exists():
        sys.exit(f"ERROR: download didn't appear at {src}")
    src.replace(DUMP_PATH)
    print(f"  moved to {DUMP_PATH}")

    dump = json.loads(DUMP_PATH.read_text())
    if dump.get("fatal"):
        sys.exit(f"ERROR from Safari JS: {dump['fatal']}")
    if dump.get("errors"):
        print(f"  partial errors: {dump['errors']}")

    print("Importing into state.json...")
    n_a, n_s, n_r = import_dump(dump)
    print(f"  activities: {n_a}, sleep: {n_s}, rhr: {n_r}")

    if not args.keep_dump:
        DUMP_PATH.unlink()
        print(f"  removed {DUMP_PATH.name} (pass --keep-dump to retain)")

    print(f"Wrote {STATE_PATH.name}. Run `node generate.js` next to update index.html.")


if __name__ == "__main__":
    main()
