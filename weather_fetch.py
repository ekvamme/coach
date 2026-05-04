#!/usr/bin/env python3
"""
Pulls Auburn, CA weather from Open-Meteo and writes it into state.json under `weather`.

Open-Meteo is free, no API key, no rate-limit hassles for our usage. We pull:
  - past 24h actual precipitation (the lookback that decides whether quarry rock is dry)
  - next 48h hourly forecast (precipitation, temp, precip probability)

Decision rule per Erik (2026-05-04): ANY measurable precip in the last 24h blocks
outdoor climbing (quarry + tension board). Forecast precip in the next 24h also blocks.
Running and other outdoor cardio are informational only — not blocked.

Usage:
    weather_fetch.py
"""

import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
STATE_PATH = ROOT / "state.json"

# Auburn, CA — used for all sessions. Erik confirmed single coord is sufficient.
LAT = 38.8965
LON = -121.0769
LOCATION_LABEL = "Auburn, CA"

API_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    "&hourly=temperature_2m,precipitation,precipitation_probability"
    "&past_days=1&forecast_days=2"
    "&timezone=auto"
    "&temperature_unit=fahrenheit"
    "&precipitation_unit=mm"
)


def fetch():
    try:
        with urllib.request.urlopen(API_URL, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        sys.exit(f"ERROR: weather fetch failed: {e}")


def summarize(data):
    """Reduce the raw API payload to the brief-friendly cache."""
    h = data["hourly"]
    times = [datetime.fromisoformat(t) for t in h["time"]]
    precip = h["precipitation"]
    precip_prob = h["precipitation_probability"]
    temp = h["temperature_2m"]

    # Use the API-reported timezone (auto-detected from coords) as "now".
    tz_offset_sec = data.get("utc_offset_seconds", 0)
    now = datetime.now(timezone.utc).astimezone(
        timezone(offset=__import__("datetime").timedelta(seconds=tz_offset_sec))
    ).replace(tzinfo=None)

    past_24h = [(t, precip[i]) for i, t in enumerate(times) if 0 <= (now - t).total_seconds() <= 24 * 3600]
    next_24h = [(t, precip[i], precip_prob[i], temp[i]) for i, t in enumerate(times)
                if 0 <= (t - now).total_seconds() <= 24 * 3600]

    precip_last_24h_mm = round(sum(p for _, p in past_24h), 2)
    precip_next_24h_mm = round(sum(p for _, p, _, _ in next_24h), 2)
    precip_prob_max_next_24h = max((pp for _, _, pp, _ in next_24h), default=0)
    temp_high_next_24h_f = round(max((tt for _, _, _, tt in next_24h), default=0))
    temp_low_next_24h_f = round(min((tt for _, _, _, tt in next_24h), default=0))

    blocked = precip_last_24h_mm > 0 or precip_next_24h_mm > 0
    reasons = []
    if precip_last_24h_mm > 0:
        reasons.append(f"{precip_last_24h_mm} mm precip in past 24h (rock still wet)")
    if precip_next_24h_mm > 0:
        reasons.append(f"{precip_next_24h_mm} mm forecast in next 24h (max prob {precip_prob_max_next_24h}%)")

    return {
        "last_synced": datetime.now().isoformat(timespec="seconds"),
        "location": f"{LOCATION_LABEL} ({LAT:.4f}, {LON:.4f})",
        "precip_last_24h_mm": precip_last_24h_mm,
        "precip_next_24h_mm": precip_next_24h_mm,
        "precip_prob_max_next_24h_pct": precip_prob_max_next_24h,
        "temp_high_next_24h_f": temp_high_next_24h_f,
        "temp_low_next_24h_f": temp_low_next_24h_f,
        "outdoor_climbing_blocked": blocked,
        "block_reason": "; ".join(reasons) if blocked else None,
    }


def main():
    data = fetch()
    summary = summarize(data)
    state = json.loads(STATE_PATH.read_text())
    state["weather"] = summary
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")
    print(f"Weather: {summary['temp_low_next_24h_f']}–{summary['temp_high_next_24h_f']}°F. "
          f"Past 24h precip: {summary['precip_last_24h_mm']} mm. "
          f"Outdoor climbing blocked: {summary['outdoor_climbing_blocked']}"
          + (f" ({summary['block_reason']})" if summary['block_reason'] else ""))


if __name__ == "__main__":
    main()
