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

function recorderPanel() {
  return `
    <section class="card recorder" id="rec">
      <h2>Voice memo</h2>
      <p class="dim small">Record anytime. Memos save on this phone and queue up below — AirDrop them to your Mac whenever.</p>
      <div class="rec-controls">
        <button id="rec-btn" class="rec-btn" aria-label="Record">
          <span class="rec-circle"></span>
        </button>
        <div class="rec-meta">
          <div id="rec-timer" class="rec-timer">00:00</div>
          <div id="rec-status" class="rec-status">Tap to record</div>
        </div>
      </div>

      <div class="queue-head" id="queue-head" hidden>
        <h3 id="queue-title">Queued memos</h3>
        <button id="rec-share-all" class="rec-action primary small-btn">Share all &rarr; AirDrop</button>
      </div>
      <ul id="rec-queue" class="rec-queue"></ul>
      <p id="queue-help" class="dim small" hidden>Memos stay on this phone until you delete them. Clearing Safari data will erase them — share to your Mac before then.</p>
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
  .rec-controls { display: flex; gap: 16px; align-items: center; margin: 8px 0; }
  .rec-btn { width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--line); background: var(--bg); cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .rec-btn:active { transform: scale(0.96); }
  .rec-circle { width: 36px; height: 36px; border-radius: 50%; background: var(--red); transition: all 0.15s ease; }
  .rec-btn.recording { border-color: var(--red); }
  .rec-btn.recording .rec-circle { border-radius: 6px; width: 24px; height: 24px; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .rec-meta { flex: 1; min-width: 0; }
  .rec-timer { font-size: 22px; font-variant-numeric: tabular-nums; }
  .rec-status { font-size: 13px; color: var(--dim); margin-top: 2px; }
  .rec-actions { display: flex; gap: 8px; margin-top: 12px; }
  .rec-action { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font-size: 14px; cursor: pointer; }
  .rec-action.primary { background: var(--accent); color: #0a0d12; border-color: var(--accent); font-weight: 600; }
  .rec-action:active { opacity: 0.7; }
  .rec-error { color: var(--red); font-size: 12px; margin-top: 6px; }
  .queue-head { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 6px; padding-top: 12px; border-top: 1px solid var(--line); }
  .queue-head h3 { margin: 0; }
  .small-btn { padding: 6px 10px; font-size: 13px; flex: 0; }
  .rec-queue { list-style: none; padding: 0; margin: 0; }
  .rec-queue li { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .rec-queue li:last-child { border-bottom: 0; }
  .rec-queue .qm-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .rec-queue .qm-name { color: var(--ink); font-variant-numeric: tabular-nums; font-size: 13px; }
  .rec-queue .qm-sub { color: var(--dim); font-size: 11px; }
  .rec-queue .qm-shared .qm-name::before { content: "✓ "; color: var(--green); }
  .qm-btn { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; color: var(--ink); font-size: 12px; cursor: pointer; }
  .qm-btn.share { color: var(--accent); border-color: var(--accent); }
  .qm-btn.del { color: var(--red); border-color: var(--line); }
  .qm-btn:active { opacity: 0.6; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Coach</h1>
    ${todayPanel()}
    ${recorderPanel()}
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

    (function () {
      const btn = document.getElementById("rec-btn");
      const timerEl = document.getElementById("rec-timer");
      const statusEl = document.getElementById("rec-status");
      const queueEl = document.getElementById("rec-queue");
      const queueHead = document.getElementById("queue-head");
      const queueHelp = document.getElementById("queue-help");
      const queueTitle = document.getElementById("queue-title");
      const shareAllBtn = document.getElementById("rec-share-all");

      let mediaRecorder = null;
      let chunks = [];
      let stream = null;
      let startTime = 0;
      let timerHandle = null;

      // ---------- IndexedDB ----------
      const DB_NAME = "coach";
      const STORE = "memos";
      let dbPromise = null;
      function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
              db.createObjectStore(STORE, { keyPath: "id" });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return dbPromise;
      }
      async function tx(mode, fn) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
          const t = db.transaction(STORE, mode);
          const store = t.objectStore(STORE);
          const result = fn(store);
          t.oncomplete = () => resolve(result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        });
      }
      function addMemo(memo) { return tx("readwrite", (s) => s.put(memo)); }
      function listMemos() {
        return tx("readonly", (s) => {
          return new Promise((res, rej) => {
            const r = s.getAll();
            r.onsuccess = () => res(r.result || []);
            r.onerror = () => rej(r.error);
          });
        }).then((p) => p);
      }
      function getMemo(id) {
        return tx("readonly", (s) => new Promise((res, rej) => {
          const r = s.get(id);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        })).then((p) => p);
      }
      function deleteMemo(id) { return tx("readwrite", (s) => s.delete(id)); }
      function updateMemo(memo) { return tx("readwrite", (s) => s.put(memo)); }

      // ---------- helpers ----------
      function pad(n) { return String(n).padStart(2, "0"); }
      function fmtTime(s) {
        const m = Math.floor(s / 60);
        const r = Math.floor(s % 60);
        return pad(m) + ":" + pad(r);
      }
      function stamp() {
        const d = new Date();
        return d.getFullYear()
          + pad(d.getMonth() + 1)
          + pad(d.getDate())
          + "-"
          + pad(d.getHours())
          + pad(d.getMinutes());
      }
      function fmtRelative(ts) {
        const diff = (Date.now() - ts) / 1000;
        if (diff < 60) return "just now";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        return Math.floor(diff / 86400) + "d ago";
      }
      function setStatus(msg, isError) {
        statusEl.textContent = msg;
        statusEl.classList.toggle("rec-error", !!isError);
      }
      function pickMime() {
        const candidates = ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "audio/webm", "audio/webm;codecs=opus"];
        for (const c of candidates) {
          if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
        }
        return "";
      }
      function extFor(mime) { return mime.startsWith("audio/mp4") ? "m4a" : "webm"; }

      // ---------- recording ----------
      async function start() {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          setStatus("Mic permission denied", true);
          return;
        }
        const mime = pickMime();
        try {
          mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (e) {
          setStatus("Recorder not supported on this device", true);
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        chunks = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mediaRecorder.onstop = onStop;
        mediaRecorder.start();
        startTime = Date.now();
        btn.classList.add("recording");
        setStatus("Recording — tap to stop");
        timerEl.textContent = "00:00";
        timerHandle = setInterval(() => {
          timerEl.textContent = fmtTime((Date.now() - startTime) / 1000);
        }, 250);
      }

      function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      }

      async function onStop() {
        clearInterval(timerHandle);
        btn.classList.remove("recording");
        if (stream) stream.getTracks().forEach(t => t.stop());
        const mime = (mediaRecorder && mediaRecorder.mimeType) || "audio/mp4";
        const blob = new Blob(chunks, { type: mime });
        const ext = extFor(mime);
        const name = "coach-" + stamp() + "." + ext;
        const memo = {
          id: name + "-" + Date.now(),
          name,
          mime,
          blob,
          size: blob.size,
          created: Date.now(),
          duration_ms: Date.now() - startTime,
          shared: false
        };
        try {
          await addMemo(memo);
          setStatus("Saved: " + name + " (" + Math.round(blob.size / 1024) + " KB)");
        } catch (e) {
          setStatus("Save failed: " + e.message, true);
          return;
        }
        timerEl.textContent = "00:00";
        await render();
      }

      // ---------- queue UI ----------
      async function render() {
        const memos = (await listMemos()).sort((a, b) => b.created - a.created);
        if (memos.length === 0) {
          queueHead.hidden = true;
          queueHelp.hidden = true;
          queueEl.innerHTML = "";
          return;
        }
        queueHead.hidden = false;
        queueHelp.hidden = false;
        const pending = memos.filter((m) => !m.shared).length;
        queueTitle.textContent = "Queued memos · " + pending + " pending / " + memos.length + " total";
        shareAllBtn.disabled = pending === 0;
        shareAllBtn.style.opacity = pending === 0 ? "0.4" : "1";

        queueEl.innerHTML = memos.map((m) => {
          const sizeKB = Math.round(m.size / 1024);
          const dur = Math.round(m.duration_ms / 1000);
          return '<li data-id="' + m.id + '" class="' + (m.shared ? "qm-shared" : "") + '">' +
            '<div class="qm-meta">' +
              '<span class="qm-name">' + m.name + '</span>' +
              '<span class="qm-sub">' + fmtRelative(m.created) + ' · ' + dur + 's · ' + sizeKB + ' KB' + (m.shared ? ' · shared' : '') + '</span>' +
            '</div>' +
            '<button class="qm-btn share" data-action="share" data-id="' + m.id + '">Share</button>' +
            '<button class="qm-btn del" data-action="delete" data-id="' + m.id + '" aria-label="Delete">✕</button>' +
          '</li>';
        }).join("");
      }

      async function shareIds(ids) {
        const memos = [];
        for (const id of ids) {
          const m = await getMemo(id);
          if (m) memos.push(m);
        }
        if (memos.length === 0) return;
        const files = memos.map((m) => new File([m.blob], m.name, { type: m.mime, lastModified: m.created }));
        if (!navigator.canShare || !navigator.canShare({ files })) {
          // fallback: download each
          for (const f of files) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(f);
            a.download = f.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }
          setStatus("Sharing not supported — downloaded " + files.length + " file(s) instead.");
          return;
        }
        try {
          await navigator.share({ files, title: "Coach memos", text: files.length + " voice memo(s)" });
          for (const m of memos) { m.shared = true; await updateMemo(m); }
          setStatus("Shared " + files.length + " memo(s). AirDrop to your Mac.");
          await render();
        } catch (e) {
          if (e.name !== "AbortError") setStatus("Share failed: " + e.message, true);
        }
      }

      btn.addEventListener("click", () => {
        if (mediaRecorder && mediaRecorder.state === "recording") stopRecording();
        else start();
      });

      shareAllBtn.addEventListener("click", async () => {
        const memos = (await listMemos()).filter((m) => !m.shared);
        await shareIds(memos.map((m) => m.id));
      });

      queueEl.addEventListener("click", async (ev) => {
        const t = ev.target.closest("button[data-action]");
        if (!t) return;
        const id = t.dataset.id;
        const action = t.dataset.action;
        if (action === "share") await shareIds([id]);
        else if (action === "delete") {
          if (confirm("Delete this memo? It can't be recovered.")) {
            await deleteMemo(id);
            await render();
          }
        }
      });

      render();
    })();
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "index.html"), html);
console.log(`Wrote index.html (${html.length} bytes) for ${todayISO()} (${dayName(todayISO())}).`);
