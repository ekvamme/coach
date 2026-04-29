#!/usr/bin/env python3
"""
Pulls recent Garmin Connect data and writes it into state.json under `garmin.*`.

First run: needs GARMIN_EMAIL and GARMIN_PASSWORD in .env (or environment).
Garth saves OAuth tokens to ~/.garth so subsequent runs don't need credentials.

Usage:
    python3 garmin_fetch.py            # last 14 days
    python3 garmin_fetch.py --days 30
"""

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import garth

ROOT = Path(__file__).parent
STATE_PATH = ROOT / "state.json"
TOKEN_DIR = Path.home() / ".garth"

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


def load_dotenv():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def auth():
    """Prefer cached tokens; fall back to email/password from env."""
    if TOKEN_DIR.exists():
        try:
            garth.resume(str(TOKEN_DIR))
            # quick sanity check
            garth.client.username
            return
        except Exception as e:
            print(f"  cached token invalid ({e}); re-authenticating", file=sys.stderr)

    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not email or not password:
        print("ERROR: no cached token and GARMIN_EMAIL / GARMIN_PASSWORD not set in .env", file=sys.stderr)
        print("Create .env with:", file=sys.stderr)
        print("  GARMIN_EMAIL=you@example.com", file=sys.stderr)
        print("  GARMIN_PASSWORD=...", file=sys.stderr)
        sys.exit(2)

    garth.login(email, password)
    garth.save(str(TOKEN_DIR))


def fmt_duration(seconds):
    if not seconds:
        return ""
    s = int(seconds)
    h, r = divmod(s, 3600)
    m, s = divmod(r, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def fmt_distance_miles(meters):
    if not meters:
        return ""
    miles = meters / 1609.344
    return f"{miles:.1f} mi"


def short_type(activity):
    raw = (activity.get("activityType") or {}).get("typeKey") or ""
    return ACTIVITY_TYPE_MAP.get(raw, raw.replace("_", " ").title() or "Activity")


def fetch_activities(days):
    """Recent activities in summary form."""
    raw = garth.connectapi(
        "/activitylist-service/activities/search/activities",
        params={"limit": 50, "start": 0},
    )
    cutoff = date.today() - timedelta(days=days)
    out = []
    for a in raw or []:
        start = a.get("startTimeLocal", "")[:10]
        if not start:
            continue
        try:
            d = date.fromisoformat(start)
        except ValueError:
            continue
        if d < cutoff:
            continue
        type_label = short_type(a)
        dist = fmt_distance_miles(a.get("distance"))
        dur = fmt_duration(a.get("duration"))
        avg_hr = a.get("averageHR")
        bits = [b for b in [dist, dur, f"avg HR {int(avg_hr)}" if avg_hr else None] if b]
        out.append({
            "date": start,
            "type": type_label,
            "detail": " · ".join(bits),
            "raw_type": (a.get("activityType") or {}).get("typeKey"),
            "elevation_gain_m": a.get("elevationGain"),
            "training_load": a.get("activityTrainingLoad"),
        })
    out.sort(key=lambda x: x["date"], reverse=True)
    return out


def fetch_sleep(days):
    out = []
    for i in range(days):
        d = date.today() - timedelta(days=i + 1)  # sleep is reported for the night of d
        try:
            data = garth.connectapi(f"/wellness-service/wellness/dailySleepData/{garth.client.username}",
                                    params={"date": d.isoformat()})
        except Exception:
            continue
        dto = (data or {}).get("dailySleepDTO") or {}
        total = dto.get("sleepTimeSeconds")
        deep = dto.get("deepSleepSeconds")
        score = (dto.get("sleepScores") or {}).get("overall", {}).get("value")
        if not total:
            continue
        bits = [fmt_duration(total) + " sleep"]
        if deep:
            bits.append(f"{fmt_duration(deep)} deep")
        if score:
            bits.append(f"score {score}")
        out.append({
            "date": d.isoformat(),
            "summary": " · ".join(bits),
            "total_seconds": total,
            "deep_seconds": deep,
            "score": score,
        })
    return out


def fetch_resting_hr(days):
    out = []
    for i in range(days):
        d = date.today() - timedelta(days=i)
        try:
            data = garth.connectapi(f"/usersummary-service/usersummary/daily/{garth.client.username}",
                                    params={"calendarDate": d.isoformat()})
        except Exception:
            continue
        rhr = (data or {}).get("restingHeartRate")
        if rhr:
            out.append({"date": d.isoformat(), "bpm": rhr})
    out.sort(key=lambda x: x["date"], reverse=True)
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=14)
    args = p.parse_args()

    load_dotenv()
    auth()

    print(f"Pulling last {args.days} days from Garmin Connect...")
    activities = fetch_activities(args.days)
    print(f"  {len(activities)} activities")
    sleep = fetch_sleep(args.days)
    print(f"  {len(sleep)} sleep records")
    rhr = fetch_resting_hr(args.days)
    print(f"  {len(rhr)} resting-HR records")

    state = json.loads(STATE_PATH.read_text())
    state.setdefault("garmin", {})
    state["garmin"]["last_synced"] = date.today().isoformat()
    state["garmin"]["recent_activities"] = activities
    state["garmin"]["recent_sleep"] = sleep
    state["garmin"]["recent_resting_hr"] = rhr
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")
    print(f"Wrote {STATE_PATH}")


if __name__ == "__main__":
    main()
