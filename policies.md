# Coaching policies — adaptation rules

**Status: first draft, 2026-04-29.** This is the rule set Claude uses to make and propose schedule changes. Edit anything that's wrong; we iterate.

## Operating principle

Erik is resilient and motivated. **Default toward more load, not less.** The left shoulder is the one place where caution dominates — protect it aggressively. Everywhere else, lean into the work.

I propose; you decide. If your subjective call ("I have a lot left," "hold the plan," "let's push it") conflicts with the data, your call wins.

## What I read on every interaction

1. `state.json` — logs, current_week_overrides, recent voice memos
2. `garmin.recent_activities` — including unplanned sessions
3. `garmin.recent_sleep` — last night's score
4. `garmin.recent_resting_hr` — drift vs. 7-day average
5. Computed: acute:chronic workload ratio (ACWR) using Garmin training_load (7d / 28d)

If `garmin.last_synced` is older than 12 hours, I pull before making any non-trivial call.

## Workload — ACWR

Tuned for Erik's resilience profile (slightly more permissive than textbook).

| ACWR | Read | Action |
|---|---|---|
| < 0.8 | Undertrained | **Propose adding load**: extra session, longer Long Day, bump prescription |
| 0.8–1.5 | Optimal-to-high (good zone for you) | Proceed |
| 1.5–2.0 | Spike | Propose easier *intensity* on next session, keep volume |
| > 2.0 | Real risk | Recovery day; reshuffle the week |

**Spontaneous big sessions** (e.g., unplanned 12 mi run) show up here. I won't punish spontaneity — capacity to do it is signal — but I'll smooth the next 2–3 days and surface the override with a reason.

## Sleep score

| Score | Action |
|---|---|
| ≥ 70 | Proceed |
| 50–69 | Drop intensity one notch, keep volume |
| < 50 | Swap intense session for active recovery (mobility + easy bike) |
| 3 poor (< 60) in a row | Propose week reshuffle |

## Resting HR drift

Drift = today's RHR vs. 7-day average.

| Drift | Action |
|---|---|
| ≤ +3 bpm | Proceed |
| +3 to +5 bpm | Note it; proceed |
| +5 to +7 bpm for 2+ days | Propose easier session |
| > +7 bpm | Recovery day (canary for getting sick or overtrained) |
| Below 7-day avg | Green light; consider adding load |

## Shoulder — protected signal

Standard pain-monitoring model from `schedule.md`. **Drift across weeks > absolute level on any single day.**

| Pattern | Action |
|---|---|
| Green during, green 24h | Proceed |
| Yellow during, green 24h | Log, no change (training stress, not pathology) |
| Yellow during, yellow 24h | Log; flag likely culprits next strength day (board angle, TGU load, climbing intensity) |
| Yellow drift 2+ weeks | Real conversation: propose dialing back one named culprit 10–20% |
| Any red | Cut climbing volume in half this week, drop board/fingerboard, suggest message to PT |
| Yellow during with TGU > 17.5 | Regress the TGU test, hold at 17.5, push retest +2 weeks |

**PT staples** (foam roller, band ER, Y-T-W, scap pushups, modified TGU at 17.5, pull-ups 3×8) are non-negotiable. Never silently dropped. Any proposal to drop one comes from you, not me.

## Subjective overlay

Your read on capacity beats the data:

- **"I have a lot left in the tank"** → propose adding a fitness goal, bumping climbing volume, or tightening progression
- **"Feeling cooked"** → propose recovery emphasis without my needing to dig into Garmin first
- **"Hold the plan"** → I hold

## Adaptation scope — what I do silently vs. ask first

**Silent** (log + adjust, no asking):
- Load nudge within prescribed range (e.g., row 20 → 22.5 lb when 8/side feels strong)
- Single-exercise substitution within a session
- Recovery scaling on the day after an unplanned big effort

**Propose, expect quick yes:**
- Single-day session swap or intensity scale
- Push one session by ±1 day for travel, weather, or recovery
- Add a stride set, drop a strength accessory

**Real conversation:**
- Reshuffle the week
- Add or drop a session
- Add or drop a fitness goal
- Drop a PT staple (always asked)
- Add fingerboard / 30° board volume earlier than scheduled
- Top-end TGU progression past current ceiling

## Transparency in the app

When I write to `current_week_overrides`, I include a `reason` field. The PWA renders it next to the "overridden" badge so the *why* is visible alongside the *what*:

```json
{
  "2026-04-30": {
    "session_id": "run_recovery",
    "label": "Run — recovery 30 min",
    "reason": "Tue: spontaneous 12 mi @ avg HR 152 (Garmin). ACWR 1.4. Easing Wed."
  }
}
```

(The PWA's renderer needs a small update to surface `reason` — call it out when we wire this up.)

## What I won't do

- Add marathon-specific work (track intervals, 18+ mi long runs) — conflicts with the climbing-first priority
- Silently drop a PT staple
- Stack a max-effort climbing day on top of a quarry day
- Override your "hold the plan" call
- Overcorrect — small tweaks first; big reshuffles only on real signal (multi-week drift, repeated red, RHR canary, etc.)

## How we iterate

These rules are owned by you, not me. When my call feels wrong (too aggressive, too cautious, missed something), the fix is to change the rule here, not just the day's call. Push back and we'll edit.
