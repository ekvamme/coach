#!/usr/bin/env python3
"""
Pulls recent Garmin Connect data and writes it into state.json under `garmin.*`.

Uses cyberjunky/python-garminconnect (DI OAuth Bearer token flow). Tokens are
cached at ~/.garminconnect/garmin_tokens.json and auto-refresh indefinitely
once obtained, so cron jobs don't need to re-authenticate.

Run via the project venv that has Python 3.13 + garminconnect installed:
    /Users/kvamme/Desktop/exercise/.venv/bin/python garmin_fetch.py

First run on a machine: needs GARMIN_EMAIL and GARMIN_PASSWORD in .env
(or environment). MFA code prompted on stdin if Garmin requests one.

Usage:
    garmin_fetch.py                  # last 14 days
    garmin_fetch.py --days 30
    garmin_fetch.py --no-login       # never attempt a fresh login (cron-safe)
"""

import argparse
import inspect
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from garminconnect import Garmin

# System Python 3.9 has garminconnect 0.2.8, which lacks prompt_mfa; without
# this guard the wrong-interpreter failure is an opaque TypeError mid-login.
if "prompt_mfa" not in inspect.signature(Garmin.__init__).parameters:
    sys.exit(
        f"ERROR: garminconnect at {Garmin.__module__!r} is too old "
        "(missing 'prompt_mfa'). Run via the project venv:\n"
        "  /Users/kvamme/Desktop/exercise/.venv/bin/python garmin_fetch.py"
    )

ROOT = Path(__file__).parent
STATE_PATH = ROOT / "state.json"
HISTORY_PATH = ROOT / "garmin_history.jsonl"
TOKEN_DIR = Path.home() / ".garminconnect"

# state.json caches a rolling window for the page; the JSONL grows forever for analytics.
DISPLAY_WINDOW_DAYS = 14

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


def get_client(no_login: bool):
    """Return a logged-in Garmin client.

    Prefers cached tokens. If --no-login is set and no cache exists, exits
    cleanly so a misconfigured cron never hammers SSO.
    """
    has_cache = TOKEN_DIR.exists() and (TOKEN_DIR / "garmin_tokens.json").exists()

    if no_login and not has_cache:
        sys.exit(
            "ERROR: --no-login set but no cached tokens at "
            f"{TOKEN_DIR}. Run interactively once first."
        )

    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")

    if not has_cache and (not email or not password):
        sys.exit(
            "ERROR: no cached token and GARMIN_EMAIL / GARMIN_PASSWORD not set in .env"
        )

    client = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("Garmin MFA code: ").strip(),
    )
    client.login(str(TOKEN_DIR))
    return client


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


def fetch_activities(client, days):
    """Returns (display_dicts, raw_dicts). Display is the slim version for state.json;
    raw is what Garmin returned (full field set), used for the history JSONL."""
    end = date.today()
    start = end - timedelta(days=days)
    raw = client.get_activities_by_date(start.isoformat(), end.isoformat()) or []
    out = []
    for a in raw:
        when = (a.get("startTimeLocal") or "")[:10]
        if not when:
            continue
        type_label = short_type(a)
        bits = [b for b in [
            fmt_distance_miles(a.get("distance")),
            fmt_duration(a.get("duration")),
            f"avg HR {int(a['averageHR'])}" if a.get("averageHR") else None,
        ] if b]
        out.append({
            "date": when,
            "type": type_label,
            "detail": " · ".join(bits),
            "raw_type": (a.get("activityType") or {}).get("typeKey"),
            "elevation_gain_m": a.get("elevationGain"),
            "training_load": a.get("activityTrainingLoad"),
        })
    out.sort(key=lambda x: x["date"], reverse=True)
    return out, raw


def append_history(raw_activities, path):
    """Append any activities not yet in the JSONL, deduped by activityId."""
    seen = set()
    if path.exists():
        with open(path) as f:
            for line in f:
                try:
                    seen.add(json.loads(line)["activityId"])
                except (json.JSONDecodeError, KeyError):
                    pass
    added = 0
    with open(path, "a") as f:
        for a in raw_activities:
            aid = a.get("activityId")
            if aid is None or aid in seen:
                continue
            f.write(json.dumps(a) + "\n")
            seen.add(aid)
            added += 1
    return added


def fetch_sleep(client, days):
    out = []
    for i in range(days):
        d = date.today() - timedelta(days=i + 1)
        try:
            data = client.get_sleep_data(d.isoformat())
        except Exception:
            continue
        dto = (data or {}).get("dailySleepDTO") or {}
        total = dto.get("sleepTimeSeconds")
        if not total:
            continue
        deep = dto.get("deepSleepSeconds")
        score = (dto.get("sleepScores") or {}).get("overall", {}).get("value")
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


def fetch_resting_hr(client, days):
    out = []
    for i in range(days):
        d = date.today() - timedelta(days=i)
        try:
            data = client.get_user_summary(d.isoformat())
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
    p.add_argument("--no-login", action="store_true",
                   help="never attempt a fresh SSO login (use only cached tokens; cron-safe)")
    args = p.parse_args()

    load_dotenv()
    client = get_client(no_login=args.no_login)

    # Activities: --days controls how far back we look (allows backfill); the
    # JSONL grows forever. Sleep/RHR don't have a history file yet so we only
    # fetch the display window — keeps backfill runs fast.
    print(f"Pulling last {args.days} days of activities from Garmin Connect...")
    activities, raw_activities = fetch_activities(client, args.days)
    print(f"  {len(activities)} activities")
    new_in_history = append_history(raw_activities, HISTORY_PATH)
    print(f"  {new_in_history} new appended to {HISTORY_PATH.name}")
    print(f"Pulling last {DISPLAY_WINDOW_DAYS} days of sleep + RHR...")
    sleep = fetch_sleep(client, DISPLAY_WINDOW_DAYS)
    print(f"  {len(sleep)} sleep records")
    rhr = fetch_resting_hr(client, DISPLAY_WINDOW_DAYS)
    print(f"  {len(rhr)} resting-HR records")

    today = date.today()
    cutoff = (today - timedelta(days=DISPLAY_WINDOW_DAYS)).isoformat()
    activities_for_state = [a for a in activities if a["date"] >= cutoff]

    state = json.loads(STATE_PATH.read_text())
    state.setdefault("garmin", {})
    state["garmin"]["last_synced"] = today.isoformat()
    state["garmin"]["recent_activities"] = activities_for_state
    state["garmin"]["recent_sleep"] = sleep
    state["garmin"]["recent_resting_hr"] = rhr
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")
    print(f"Wrote {STATE_PATH}")


if __name__ == "__main__":
    main()
