#!/usr/bin/env node
// Generates index.html from workouts.json + state.json.
// Pure renderer — does not modify state.

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const workouts = JSON.parse(fs.readFileSync(path.join(ROOT, "workouts.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(ROOT, "state.json"), "utf8"));

// ---------- date helpers (local time, not UTC) ----------
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isoToDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dayName(iso) {
  return ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][isoToDate(iso).getDay()];
}
function fmtFull(iso) {
  const d = isoToDate(iso);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function addDays(iso, n) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return dateToISO(d);
}

// ---------- planning ----------
function plannedSessionForDate(iso) {
  // current_week_overrides take precedence (keyed by ISO date)
  const ov = state.current_week_overrides || {};
  if (ov[iso]) return { ...ov[iso], _override: true };
  const dn = dayName(iso);
  const tmpl = workouts.weekly_template[dn];
  return { ...tmpl, _override: false };
}

function logEntryFor(iso) {
  return (state.log || []).find((e) => e.date === iso) || null;
}

// ---------- HTML helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
const linkFor = (name) => workouts.demo_links[name] || null;

function exerciseRow(ex) {
  const link = linkFor(ex.name);
  const nameHtml = link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(ex.name)}</a>`
    : esc(ex.name);
  const tag = ex.tag === "mobility-insurance"
    ? ` <span class="tag mob">mobility-insurance</span>` : "";
  const note = ex.note ? `<div class="note">${esc(ex.note)}</div>` : "";
  return `
    <li class="ex">
      <div class="ex-head">
        <span class="ex-name">${nameHtml}${tag}</span>
        <span class="ex-pres">${esc(ex.prescription || "")}</span>
      </div>
      ${ex.load ? `<div class="ex-load">${esc(ex.load)}</div>` : ""}
      ${note}
    </li>`;
}

function blockHTML(title, items) {
  if (!items || items.length === 0) return "";
  return `
    <section class="block">
      <h3>${esc(title)}</h3>
      <ul class="ex-list">${items.map(exerciseRow).join("")}</ul>
    </section>`;
}

function notesHTML(notes) {
  if (!notes || notes.length === 0) return "";
  return `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
}

function sessionHTML(session) {
  if (!session) return `<p>No session planned.</p>`;
  const sessionDef = workouts.sessions[session.session_id] || workouts.sessions.rest;
  const cooldownItems = sessionDef.cooldown_ref
    ? (workouts[sessionDef.cooldown_ref] && workouts[sessionDef.cooldown_ref].items) || []
    : sessionDef.cooldown;

  return `
    <div class="session">
      <div class="session-meta">
        <span class="duration">${esc(sessionDef.duration || "")}</span>
        ${session._override ? `<span class="badge override">overridden</span>` : ""}
      </div>
      ${notesHTML(sessionDef.notes)}
      ${blockHTML("Warm-up", sessionDef.warmup)}
      ${blockHTML("Main", sessionDef.exercises)}
      ${blockHTML(sessionDef.cooldown_ref ? cooldownTitleFor(sessionDef.cooldown_ref) : "Cool-down", cooldownItems)}
    </div>`;
}

function cooldownTitleFor(ref) {
  const block = workouts[ref];
  return (block && block.title) || "Cool-down";
}

function statusDot(status) {
  const cls = status ? `dot ${status}` : `dot empty`;
  return `<span class="${cls}" title="${esc(status || "no log")}"></span>`;
}

// ---------- panels ----------
function todayPanel() {
  const iso = todayISO();
  const planned = plannedSessionForDate(iso);
  const sessionDef = workouts.sessions[planned.session_id] || workouts.sessions.rest;
  const todaysLog = logEntryFor(iso);

  return `
    <section class="card today">
      <header>
        <div class="kicker">Today · ${esc(fmtFull(iso))}</div>
        <h2>${esc(sessionDef.title)}</h2>
      </header>
      ${sessionHTML(planned)}
      ${todaysLog ? loggedSummary(todaysLog) : `<p class="dim">Not logged yet. Tell Claude how it went when you're done.</p>`}
    </section>`;
}

function loggedSummary(entry) {
  return `
    <div class="logged">
      <h3>Logged</h3>
      <ul class="kv">
        <li><span class="k">Did</span><span class="v">${esc(entry.did || "—")}</span></li>
        <li><span class="k">Shoulder during</span><span class="v">${statusDot(entry.shoulder_during)} ${esc(entry.shoulder_during || "")}</span></li>
        <li><span class="k">Shoulder post-24h</span><span class="v">${statusDot(entry.shoulder_post_24h)} ${esc(entry.shoulder_post_24h || "")}</span></li>
        ${entry.sleep_side_tolerance ? `<li><span class="k">Sleep tolerance</span><span class="v">${esc(entry.sleep_side_tolerance)}</span></li>` : ""}
        ${entry.notes ? `<li><span class="k">Notes</span><span class="v">${esc(entry.notes)}</span></li>` : ""}
      </ul>
    </div>`;
}

function weekPanel() {
  const today = todayISO();
  const weekStart = addDays(today, -isoToDate(today).getDay()); // Sunday-start week
  const days = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(weekStart, i);
    const planned = plannedSessionForDate(iso);
    const sessionDef = workouts.sessions[planned.session_id] || workouts.sessions.rest;
    const log = logEntryFor(iso);
    const isToday = iso === today;
    days.push(`
      <li class="${isToday ? "today" : ""}">
        <div class="weekday">${esc(dayName(iso).slice(0,3).toUpperCase())}</div>
        <div class="weekdate">${esc(iso.slice(5))}</div>
        <div class="weeklabel">${esc(sessionDef.title)}</div>
        <div class="weekstatus">${statusDot(log && log.shoulder_during)}${statusDot(log && log.shoulder_post_24h)}</div>
      </li>`);
  }
  return `
    <section class="card">
      <h2>This week</h2>
      <ul class="weekgrid">${days.join("")}</ul>
    </section>`;
}

function streakPanel() {
  const today = todayISO();
  const N = 14;
  const cells = [];
  for (let i = N - 1; i >= 0; i--) {
    const iso = addDays(today, -i);
    const log = logEntryFor(iso);
    cells.push(`
      <div class="streakcell" title="${esc(iso)}">
        <div class="streakdate">${esc(iso.slice(8))}</div>
        <div class="streakdots">${statusDot(log && log.shoulder_during)}${statusDot(log && log.shoulder_post_24h)}</div>
      </div>`);
  }
  return `
    <section class="card">
      <h2>Last 14 days · shoulder</h2>
      <p class="dim small">Top dot = during exercise · Bottom dot = post-24h. Drift is the killer, not absolute level.</p>
      <div class="streak">${cells.join("")}</div>
      <div class="legend">
        <span><span class="dot green"></span> green</span>
        <span><span class="dot yellow"></span> yellow</span>
        <span><span class="dot red"></span> red</span>
        <span><span class="dot empty"></span> no log</span>
      </div>
    </section>`;
}

function mobilityPanel() {
  return `
    <section class="card">
      <h2>${esc(workouts.morning_mobility.title)}</h2>
      <ul class="ex-list">${workouts.morning_mobility.items.map(exerciseRow).join("")}</ul>
    </section>`;
}

function garminPanel() {
  const g = state.garmin || {};
  const recent = g.recent_activities || [];
  const sleep = g.recent_sleep || [];
  const rhr = g.recent_resting_hr || [];
  const synced = g.last_synced ? `Last synced: ${esc(g.last_synced)}` : "Not yet synced";

  if (recent.length === 0 && sleep.length === 0 && rhr.length === 0) {
    return `
      <section class="card">
        <h2>Garmin</h2>
        <p class="dim">${synced}. Run <code>python3 garmin_fetch.py</code> to pull recent data.</p>
      </section>`;
  }

  const actHTML = recent.slice(0, 5).map((a) => `
    <li>
      <span class="g-date">${esc(a.date || "")}</span>
      <span class="g-type">${esc(a.type || "")}</span>
      <span class="g-detail">${esc(a.detail || "")}</span>
    </li>`).join("");

  return `
    <section class="card">
      <h2>Garmin · recent</h2>
      <p class="dim small">${synced}</p>
      ${recent.length ? `<h3>Activities</h3><ul class="garmin">${actHTML}</ul>` : ""}
      ${sleep.length ? `<h3>Sleep (last ${sleep.length})</h3><ul class="garmin">${sleep.slice(0,5).map(s => `<li><span class="g-date">${esc(s.date)}</span> <span>${esc(s.summary)}</span></li>`).join("")}</ul>` : ""}
      ${rhr.length ? `<h3>Resting HR (last ${rhr.length})</h3><ul class="garmin">${rhr.slice(0,5).map(r => `<li><span class="g-date">${esc(r.date)}</span> <span>${esc(r.bpm)} bpm</span></li>`).join("")}</ul>` : ""}
    </section>`;
}

function howToPanel() {
  return `
    <section class="card howto">
      <h2>How to report</h2>
      <p>Open Claude Code in this folder and just say it like a sentence:</p>
      <ul>
        <li>"Did Strength A, shoulder green, sleep fine."</li>
        <li>"Skipped today, traveling."</li>
        <li>"Did Strength A but swapped TGU for goblet squats — shoulder yellow, burning lasted ~30 hr."</li>
        <li>"Pull last week from Garmin."</li>
      </ul>
      <p class="dim small">Claude will update <code>state.json</code> and regenerate this page. If you want the schedule reshuffled (e.g., move Tue → Wed), Claude will ask first.</p>
    </section>`;
}

// ---------- assembly ----------
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Coach</title>
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#0f1115" />
<link rel="apple-touch-icon" href="icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<style>
  :root {
    --bg: #0f1115;
    --card: #181b22;
    --ink: #e8eaef;
    --dim: #9aa1ad;
    --line: #262a33;
    --accent: #7fb6ff;
    --green: #4ade80;
    --yellow: #facc15;
    --red: #f87171;
    --empty: #3a3f4a;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  body { padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; margin: 8px 0 16px; color: var(--dim); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
  h2 { font-size: 18px; margin: 0 0 12px; }
  h3 { font-size: 14px; margin: 14px 0 6px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  .card.today header .kicker { font-size: 12px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
  .card.today header h2 { font-size: 22px; margin: 0 0 10px; }
  .session-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; color: var(--dim); font-size: 13px; }
  .badge.override { background: var(--accent); color: #0a0d12; padding: 2px 6px; border-radius: 6px; font-size: 11px; font-weight: 600; }
  .notes { padding-left: 18px; margin: 6px 0 10px; }
  .notes li { color: var(--dim); font-size: 14px; margin-bottom: 4px; }
  .ex-list { list-style: none; padding: 0; margin: 0; }
  .ex { padding: 10px 0; border-bottom: 1px solid var(--line); }
  .ex:last-child { border-bottom: 0; }
  .ex-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .ex-name a { color: var(--accent); text-decoration: none; }
  .ex-name a:active { opacity: 0.6; }
  .ex-pres { color: var(--dim); font-size: 13px; white-space: nowrap; }
  .ex-load { font-size: 13px; color: var(--dim); margin-top: 2px; }
  .note { font-size: 12px; color: var(--dim); margin-top: 4px; font-style: italic; }
  .tag { font-size: 10px; padding: 1px 5px; border-radius: 4px; vertical-align: middle; }
  .tag.mob { background: #2a3142; color: #a8c3ff; margin-left: 4px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--empty); margin-right: 4px; vertical-align: middle; }
  .dot.green { background: var(--green); }
  .dot.yellow { background: var(--yellow); }
  .dot.red { background: var(--red); }
  .dot.empty { background: var(--empty); }
  .logged { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .kv { list-style: none; padding: 0; margin: 0; }
  .kv li { display: grid; grid-template-columns: 130px 1fr; padding: 4px 0; font-size: 14px; }
  .kv .k { color: var(--dim); }
  .weekgrid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .weekgrid li { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 4px; text-align: center; font-size: 11px; min-height: 84px; display: flex; flex-direction: column; gap: 4px; }
  .weekgrid li.today { border-color: var(--accent); }
  .weekday { font-weight: 700; color: var(--dim); letter-spacing: 0.05em; }
  .weekdate { color: var(--dim); font-size: 10px; }
  .weeklabel { font-size: 10px; line-height: 1.2; flex: 1; }
  .weekstatus { display: flex; justify-content: center; gap: 2px; }
  .streak { display: grid; grid-template-columns: repeat(14, 1fr); gap: 4px; }
  .streakcell { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 0; text-align: center; }
  .streakdate { font-size: 10px; color: var(--dim); }
  .streakdots { display: flex; flex-direction: column; align-items: center; gap: 2px; margin-top: 2px; }
  .streakdots .dot { margin-right: 0; width: 8px; height: 8px; }
  .legend { display: flex; gap: 12px; margin-top: 10px; font-size: 12px; color: var(--dim); }
  .dim { color: var(--dim); }
  .small { font-size: 12px; }
  .howto p { margin: 6px 0; }
  .howto ul { padding-left: 18px; }
  .howto li { margin-bottom: 4px; font-size: 14px; }
  code { background: var(--bg); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  ul.garmin { list-style: none; padding: 0; margin: 0; }
  ul.garmin li { display: flex; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  ul.garmin li:last-child { border-bottom: 0; }
  .g-date { color: var(--dim); width: 90px; flex-shrink: 0; }
  .g-type { color: var(--accent); width: 80px; flex-shrink: 0; }
  footer.foot { color: var(--dim); font-size: 11px; text-align: center; margin: 18px 0 0; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Coach</h1>
    ${todayPanel()}
    ${weekPanel()}
    ${streakPanel()}
    ${mobilityPanel()}
    ${garminPanel()}
    ${howToPanel()}
    <footer class="foot">Generated ${esc(new Date().toISOString())} · Phase: ${esc(state.user && state.user.phase || "—")}</footer>
  </div>
  <script>
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "index.html"), html);
console.log(`Wrote index.html (${html.length} bytes) for ${todayISO()} (${dayName(todayISO())}).`);
