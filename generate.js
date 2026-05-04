#!/usr/bin/env node
// Generates index.html from workouts.json + state.json.
// Today / This week / Last 14 days panels render client-side from embedded JSON,
// so the page picks up the correct day every time it opens — no daily regen needed.
// Pure renderer — does not modify state.

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const workouts = JSON.parse(fs.readFileSync(path.join(ROOT, "workouts.json"), "utf8"));
const state = JSON.parse(fs.readFileSync(path.join(ROOT, "state.json"), "utf8"));

// Escape `<` so JSON content can't break out of <script type="application/json">.
function safeJSON(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// ---------- date helpers (local time, not UTC) — used for the "generated" footer only ----------
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
function dayName(iso) {
  return ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][isoToDate(iso).getDay()];
}

// ---------- HTML helpers (server side — used for static panels only) ----------
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
  const pres = ex.prescription || "";
  return `
    <li class="ex" data-prescription="${esc(pres)}">
      <div class="ex-head">
        <span class="ex-name">${nameHtml}${tag}</span>
        <span class="ex-pres">${esc(pres)}</span>
      </div>
      ${ex.load ? `<div class="ex-load">${esc(ex.load)}</div>` : ""}
      ${note}
      <span class="timer-slot"></span>
    </li>`;
}

// ---------- static (server-rendered) panels ----------
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

// ---------- client-side renderer ----------
// Defined as a regular function so we can stringify it without escaping
// every backtick. Runs in the browser; never invoked in Node.
function clientRenderer() {
  const workouts = JSON.parse(document.getElementById("data-workouts").textContent);
  const state = JSON.parse(document.getElementById("data-state").textContent);

  function pad(n) { return String(n).padStart(2, "0"); }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function isoToDate(iso) {
    const p = iso.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function dateToISO(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function dayName(iso) {
    return ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][isoToDate(iso).getDay()];
  }
  function fmtFull(iso) {
    return isoToDate(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function addDays(iso, n) {
    const d = isoToDate(iso);
    d.setDate(d.getDate() + n);
    return dateToISO(d);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function linkFor(name) { return workouts.demo_links[name] || null; }

  function exerciseRow(ex) {
    const link = linkFor(ex.name);
    const nameHtml = link
      ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">' + esc(ex.name) + '</a>'
      : esc(ex.name);
    const tag = ex.tag === "mobility-insurance"
      ? ' <span class="tag mob">mobility-insurance</span>' : "";
    const load = ex.load ? '<div class="ex-load">' + esc(ex.load) + '</div>' : "";
    const note = ex.note ? '<div class="note">' + esc(ex.note) + '</div>' : "";
    const pres = ex.prescription || "";
    const programAttr = ex.timer_program
      ? ' data-timer-program="' + esc(JSON.stringify(ex.timer_program)) + '"'
      : "";
    const gripAttr = ex.grip ? ' data-grip="' + esc(ex.grip) + '"' : "";
    const gripLine = ex.grip ? '<div class="ex-grip">' + esc(ex.grip) + '</div>' : "";
    return '<li class="ex" data-prescription="' + esc(pres) + '"' + programAttr + gripAttr + '>' +
      '<div class="ex-head">' +
        '<span class="ex-name">' + nameHtml + tag + '</span>' +
        '<span class="ex-pres">' + esc(pres) + '</span>' +
      '</div>' +
      gripLine + load + note +
      '<span class="timer-slot"></span>' +
    '</li>';
  }

  function blockHTML(title, items) {
    if (!items || items.length === 0) return "";
    return '<section class="block"><h3>' + esc(title) + '</h3>' +
      '<ul class="ex-list">' + items.map(exerciseRow).join("") + '</ul>' +
    '</section>';
  }

  function notesHTML(notes) {
    if (!notes || notes.length === 0) return "";
    return '<ul class="notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join("") + '</ul>';
  }

  function cooldownTitleFor(ref) {
    const block = workouts[ref];
    return (block && block.title) || "Cool-down";
  }

  function statusDot(status) {
    const cls = status ? "dot " + status : "dot empty";
    return '<span class="' + cls + '" title="' + esc(status || "no log") + '"></span>';
  }

  function plannedSessionForDate(iso) {
    const ov = state.current_week_overrides || {};
    if (ov[iso]) return Object.assign({}, ov[iso], { _override: true });
    const tmpl = workouts.weekly_template[dayName(iso)];
    return Object.assign({}, tmpl, { _override: false });
  }

  function logEntryFor(iso) {
    return (state.log || []).find(function (e) { return e.date === iso; }) || null;
  }

  // ---------- completion detection ----------
  // Sources, in priority order:
  //   1. log entry exists in state.json (canonical — written when Erik talks to Claude)
  //   2. Garmin activity on this date matches the planned session type
  //   3. localStorage manual mark (the "✓ Mark complete" button)
  const SESSION_TO_GARMIN = {
    run_hilly_z2: ["running", "trail_running"],
    long_day: ["running", "trail_running", "hiking", "indoor_climbing", "rock_climbing", "sport_climbing"],
    climb_quarry: ["indoor_climbing", "sport_climbing", "rock_climbing", "bouldering"]
  };
  function manualMap() {
    try { return JSON.parse(localStorage.getItem("coach.manual_complete") || "{}"); }
    catch (e) { return {}; }
  }
  function setManual(map) {
    try { localStorage.setItem("coach.manual_complete", JSON.stringify(map)); } catch (e) {}
  }
  function findGarminMatch(iso, sessionId) {
    const expected = SESSION_TO_GARMIN[sessionId];
    if (!expected) return null;
    const acts = (state.garmin && state.garmin.recent_activities) || [];
    for (let i = 0; i < acts.length; i++) {
      if (acts[i].date === iso && expected.indexOf(acts[i].raw_type) !== -1) return acts[i];
    }
    return null;
  }
  function completionFor(iso) {
    const log = logEntryFor(iso);
    if (log) return { done: true, source: "log" };
    const planned = plannedSessionForDate(iso);
    const m = findGarminMatch(iso, planned.session_id);
    if (m) return { done: true, source: "garmin", activity: m };
    const mm = manualMap();
    if (mm[iso]) return { done: true, source: "manual", ts: mm[iso] };
    return { done: false };
  }

  // ---------- prescription duration parser ----------
  // Returns { phases: [{seconds, label}, ...] } or null if no time-based timer applies.
  function parseDuration(pres) {
    if (!pres) return null;
    const sec = pres.match(/(\d+)\s*(?:s|sec|seconds?)\b/i);
    const minRange = pres.match(/(\d+)\s*[–-]\s*(\d+)\s*min\b/i);
    const min = pres.match(/(\d+)\s*min\b/i);
    let baseSecs = null;
    if (minRange) baseSecs = Math.round(((+minRange[1] + +minRange[2]) / 2) * 60);
    else if (min) baseSecs = +min[1] * 60;
    else if (sec) baseSecs = +sec[1];
    if (baseSecs == null || baseSecs < 5) return null;

    const perArea = pres.match(/per\s+area:\s*(.+)$/i);
    if (perArea) {
      const areas = perArea[1].split(/\s*,\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (areas.length >= 2) {
        return { phases: areas.map(function (a) { return { seconds: baseSecs, label: a }; }) };
      }
    }
    const ev = pres.match(/each[,\s]+([a-z][a-z\-]*)\s*\+\s*([a-z][a-z\-]*)/i);
    if (ev) {
      return { phases: [
        { seconds: baseSecs, label: ev[1] },
        { seconds: baseSecs, label: ev[2] }
      ]};
    }
    if (/each\s+side/i.test(pres)) {
      return { phases: [
        { seconds: baseSecs, label: "left" },
        { seconds: baseSecs, label: "right" }
      ]};
    }
    return { phases: [{ seconds: baseSecs, label: "" }] };
  }
  function timerSummary(timer) {
    const ea = timer.phases[0].seconds;
    const eaText = ea < 60 ? ea + "s" : (ea % 60 === 0 ? (ea / 60) + "m" : (Math.round(ea / 6) / 10) + "m");
    return timer.phases.length > 1 ? eaText + " × " + timer.phases.length : eaText;
  }
  function fmtClock(s) {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function decorateTimers(root) {
    const slots = root.querySelectorAll(".ex[data-prescription] .timer-slot");
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.firstChild) continue;
      const li = slot.closest(".ex");
      // Structured timer programs supersede prescription parsing — handled separately.
      if (li.dataset.timerProgram) continue;
      const t = parseDuration(li.dataset.prescription);
      if (!t) continue;
      const btn = document.createElement("button");
      btn.className = "timer-btn";
      btn.textContent = "▶ " + timerSummary(t);
      btn.setAttribute("aria-label", "Start " + timerSummary(t) + " timer");
      btn._timer = t;
      btn._summary = timerSummary(t);
      slot.appendChild(btn);
    }
  }

  function decorateProgramTimers(root) {
    const els = root.querySelectorAll(".ex[data-timer-program]");
    for (let i = 0; i < els.length; i++) {
      const li = els[i];
      const slot = li.querySelector(".timer-slot");
      if (!slot || slot.firstChild) continue;
      let prog;
      try { prog = JSON.parse(li.dataset.timerProgram); } catch (e) { continue; }
      const exName = (li.querySelector(".ex-name") || {}).textContent || "Workout";
      const grip = li.dataset.grip || "";
      const totalReps = prog.sets * prog.reps_per_set;
      const totalWorkSec = totalReps * prog.work_seconds;
      const summary = "▶ Start full-screen timer · " + prog.sets + "×" + prog.reps_per_set
        + " · " + prog.work_seconds + "s on / " + prog.rest_seconds + "s off"
        + " (" + Math.round(totalWorkSec / 60) + " min total work)";
      const btn = document.createElement("button");
      btn.className = "fullscreen-timer-btn";
      btn.textContent = summary;
      btn.setAttribute("aria-label", "Start full-screen hangboard timer");
      btn.addEventListener("click", function () {
        primeAudio(); // unlock audio synchronously inside the user gesture
        startProgramTimer(prog, exName, grip);
      });
      slot.appendChild(btn);
    }
  }

  // ---------- full-screen program timer ----------
  // Expands a program into a flat phase array. Phase types: prep (blue,
  // optional safety briefing once at the start), ready (yellow, 3s before
  // each rep), work (green), rest (red, between reps), set_rest (dark red,
  // longer pause between sets).
  function expandProgram(prog) {
    const phases = [];
    if (prog.prep_seconds && prog.prep_seconds > 0) {
      phases.push({
        type: "prep", seconds: prog.prep_seconds,
        label: "PREP", sub: prog.prep_message || "Get into position."
      });
    }
    for (let s = 0; s < prog.sets; s++) {
      for (let r = 0; r < prog.reps_per_set; r++) {
        phases.push({
          type: "ready", seconds: prog.transition_seconds,
          label: "GET READY", sub: "Set " + (s + 1) + " of " + prog.sets + " · Hang " + (r + 1) + " of " + prog.reps_per_set
        });
        phases.push({
          type: "work", seconds: prog.work_seconds,
          label: "HANG", sub: "Set " + (s + 1) + " of " + prog.sets + " · Hang " + (r + 1) + " of " + prog.reps_per_set
        });
        const isLastRepOfSet = r === prog.reps_per_set - 1;
        const isLastSet = s === prog.sets - 1;
        if (isLastRepOfSet && isLastSet) break;
        if (isLastRepOfSet) {
          phases.push({
            type: "set_rest", seconds: prog.set_rest_seconds,
            label: "SET REST", sub: "Recover before set " + (s + 2) + " of " + prog.sets
          });
        } else {
          phases.push({
            type: "rest", seconds: prog.rest_seconds,
            label: "REST", sub: "Set " + (s + 1) + " of " + prog.sets + " · Hang " + (r + 2) + " of " + prog.reps_per_set + " coming"
          });
        }
      }
    }
    phases.push({ type: "done", seconds: 0, label: "DONE", sub: "Workout complete. Tap to close." });
    return phases;
  }

  let program = null;
  function startProgramTimer(prog, exerciseName, grip) {
    if (active) stopActiveTimer(false);
    program = {
      phases: expandProgram(prog),
      idx: 0, startedAt: Date.now(), paused: false, elapsedAtPause: 0,
      wakeLock: null, raf: null, prog: prog,
      exerciseName: exerciseName || "Workout",
      grip: grip || ""
    };
    const overlay = document.getElementById("ft-overlay");
    document.getElementById("ft-exercise").textContent = program.exerciseName;
    const gripEl = document.getElementById("ft-grip");
    gripEl.textContent = program.grip;
    gripEl.style.display = program.grip ? "" : "none";
    overlay.classList.add("active");
    overlay.removeAttribute("aria-hidden");
    document.body.classList.add("ft-open");
    if (navigator.wakeLock) {
      navigator.wakeLock.request("screen").then(function (lock) {
        if (program) program.wakeLock = lock;
      }).catch(function () {});
    }
    renderProgramPhase();
    tickProgram();
  }

  function renderProgramPhase() {
    if (!program) return;
    const p = program.phases[program.idx];
    const overlay = document.getElementById("ft-overlay");
    overlay.dataset.phase = p.type;
    document.getElementById("ft-label").textContent = p.label;
    document.getElementById("ft-sub").textContent = p.sub;
    document.getElementById("ft-progress").textContent =
      "Phase " + (program.idx + 1) + " of " + program.phases.length;
    document.getElementById("ft-pause").textContent = program.paused ? "▶ Resume" : "❚❚ Pause";
    if (p.type === "done") {
      document.getElementById("ft-time").textContent = "✓";
      document.getElementById("ft-pause").style.display = "none";
    } else {
      document.getElementById("ft-pause").style.display = "";
    }
  }

  function tickProgram() {
    if (!program || program.paused) return;
    const p = program.phases[program.idx];
    if (p.type === "done") return;
    const now = Date.now();
    const elapsed = (now - program.startedAt) / 1000;
    const remaining = p.seconds - elapsed;
    if (remaining <= 0) {
      program.idx++;
      program.startedAt = now;
      const next = program.phases[program.idx];
      // Distinct cues: double-beep on rep start (work), single beep on transitions.
      if (next.type === "work") beep(true);
      else if (next.type === "done") {
        beep(true);
        setTimeout(function () { beep(true); }, 400);
      } else beep(false);
      renderProgramPhase();
      if (next.type === "done") return;
      program.raf = requestAnimationFrame(tickProgram);
      return;
    }
    document.getElementById("ft-time").textContent = String(Math.ceil(remaining));
    program.raf = requestAnimationFrame(tickProgram);
  }

  function pauseProgram() {
    if (!program) return;
    if (program.paused) {
      program.startedAt = Date.now() - program.elapsedAtPause;
      program.paused = false;
      renderProgramPhase();
      tickProgram();
    } else {
      program.elapsedAtPause = Date.now() - program.startedAt;
      program.paused = true;
      if (program.raf) cancelAnimationFrame(program.raf);
      renderProgramPhase();
    }
  }

  function closeProgram() {
    if (!program) return;
    if (program.raf) cancelAnimationFrame(program.raf);
    if (program.wakeLock) try { program.wakeLock.release(); } catch (e) {}
    program = null;
    const overlay = document.getElementById("ft-overlay");
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("ft-open");
  }

  // ---------- timer controller (one active timer at a time) ----------
  let active = null;
  // One AudioContext lives for the whole page. iOS Safari only allows audio
  // creation during a user gesture and silently drops contexts created later;
  // we prime this on the first timer button tap and reuse it forever.
  let _audioCtx = null;
  function primeAudio() {
    if (_audioCtx) {
      if (_audioCtx.state === "suspended") _audioCtx.resume();
      return _audioCtx;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      _audioCtx = new Ctx();
      // Play a silent tone to fully unlock iOS audio. Without this the first
      // real beep fired from a setTimeout / RAF loop is a no-op.
      const o = _audioCtx.createOscillator();
      const g = _audioCtx.createGain();
      g.gain.value = 0;
      o.connect(g); g.connect(_audioCtx.destination);
      o.start(); o.stop(_audioCtx.currentTime + 0.01);
    } catch (e) { _audioCtx = null; }
    return _audioCtx;
  }
  function beep(double) {
    const ctx = _audioCtx;
    if (ctx) {
      try {
        if (ctx.state === "suspended") ctx.resume();
        function tone(freq, t0, dur) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = freq;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
          o.connect(g); g.connect(ctx.destination);
          o.start(t0);
          o.stop(t0 + dur + 0.05);
        }
        const t0 = ctx.currentTime;
        tone(880, t0, 0.18);
        if (double) tone(1175, t0 + 0.22, 0.22);
      } catch (e) {}
    }
    if (navigator.vibrate) try { navigator.vibrate(double ? [80, 60, 80] : [60]); } catch (e) {}
  }
  function teardownTimerUI(li) {
    const slot = li.querySelector(".timer-slot"); if (!slot) return;
    ["timer-cancel", "timer-phase", "timer-bar"].forEach(function (c) {
      const e = slot.querySelector("." + c);
      if (e) e.remove();
    });
  }
  function ensureTimerUI(li, btn) {
    const slot = li.querySelector(".timer-slot");
    let cancel = slot.querySelector(".timer-cancel");
    if (!cancel) {
      cancel = document.createElement("button");
      cancel.className = "timer-cancel";
      cancel.textContent = "✕";
      cancel.setAttribute("aria-label", "Cancel timer");
      cancel.addEventListener("click", function (e) { e.stopPropagation(); stopActiveTimer(false); });
      btn.insertAdjacentElement("afterend", cancel);
    }
    let phase = slot.querySelector(".timer-phase");
    if (!phase) {
      phase = document.createElement("div");
      phase.className = "timer-phase";
      slot.appendChild(phase);
    }
    let bar = slot.querySelector(".timer-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "timer-bar";
      const fill = document.createElement("div");
      fill.className = "timer-fill";
      bar.appendChild(fill);
      slot.appendChild(bar);
    }
    return { phase: phase, fill: bar.querySelector(".timer-fill") };
  }
  function phaseLabel(p, idx, total) {
    const counter = total > 1 ? "(" + (idx + 1) + "/" + total + ") " : "";
    return counter + (p.label || "hold");
  }
  function stopActiveTimer(beepDone) {
    if (!active) return;
    if (active.raf) cancelAnimationFrame(active.raf);
    active.btn.classList.remove("running", "paused");
    active.btn.textContent = "▶ " + active.summary;
    teardownTimerUI(active.li);
    if (active.wakeLock) try { active.wakeLock.release(); } catch (e) {}
    if (beepDone) beep(true);
    active = null;
  }
  async function startTimer(btn) {
    if (active && active.btn === btn) {
      if (active.paused) {
        active.startedAt = Date.now() - active.elapsedAtPause;
        active.paused = false;
        active.btn.classList.remove("paused");
        tickActive();
      } else {
        active.elapsedAtPause = Date.now() - active.startedAt;
        active.paused = true;
        if (active.raf) cancelAnimationFrame(active.raf);
        active.btn.classList.add("paused");
      }
      return;
    }
    if (active) stopActiveTimer(false);
    const timer = btn._timer || parseDuration(btn.closest(".ex").dataset.prescription);
    if (!timer) return;
    const li = btn.closest(".ex");
    const ui = ensureTimerUI(li, btn);
    let wakeLock = null;
    try {
      if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {}
    active = {
      btn: btn, li: li, phases: timer.phases, currentIdx: 0,
      startedAt: Date.now(), elapsedAtPause: 0, paused: false,
      summary: btn._summary || timerSummary(timer),
      wakeLock: wakeLock, ui: ui
    };
    btn.classList.add("running");
    ui.phase.textContent = phaseLabel(timer.phases[0], 0, timer.phases.length);
    ui.fill.style.width = "0%";
    btn.textContent = fmtClock(timer.phases[0].seconds);
    tickActive();
  }
  function tickActive() {
    if (!active || active.paused) return;
    const now = Date.now();
    const phase = active.phases[active.currentIdx];
    const elapsed = (now - active.startedAt) / 1000;
    const remaining = phase.seconds - elapsed;
    if (remaining <= 0) {
      active.currentIdx++;
      if (active.currentIdx >= active.phases.length) {
        stopActiveTimer(true);
        return;
      }
      beep(false);
      active.startedAt = now;
      const next = active.phases[active.currentIdx];
      active.ui.phase.textContent = phaseLabel(next, active.currentIdx, active.phases.length);
      active.ui.fill.style.width = "0%";
      active.btn.textContent = fmtClock(next.seconds);
      active.raf = requestAnimationFrame(tickActive);
      return;
    }
    active.btn.textContent = fmtClock(remaining);
    active.ui.fill.style.width = (((phase.seconds - remaining) / phase.seconds) * 100).toFixed(1) + "%";
    active.raf = requestAnimationFrame(tickActive);
  }

  function sessionHTML(session) {
    if (!session) return "<p>No session planned.</p>";
    const sessionDef = workouts.sessions[session.session_id] || workouts.sessions.rest;
    const cooldownItems = sessionDef.cooldown_ref
      ? ((workouts[sessionDef.cooldown_ref] && workouts[sessionDef.cooldown_ref].items) || [])
      : sessionDef.cooldown;
    const meta = '<div class="session-meta">' +
      '<span class="duration">' + esc(sessionDef.duration || "") + '</span>' +
      (session._override ? '<span class="badge override">overridden</span>' : "") +
    '</div>';
    const reason = session._override && session.reason
      ? '<div class="override-reason">' + esc(session.reason) + '</div>'
      : "";
    return '<div class="session">' + meta + reason +
      notesHTML(sessionDef.notes) +
      blockHTML("Warm-up", sessionDef.warmup) +
      blockHTML("Main", sessionDef.exercises) +
      blockHTML(sessionDef.cooldown_ref ? cooldownTitleFor(sessionDef.cooldown_ref) : "Cool-down", cooldownItems) +
    '</div>';
  }

  function loggedSummary(entry) {
    return '<div class="logged"><h3>Logged</h3>' +
      '<ul class="kv">' +
        '<li><span class="k">Did</span><span class="v">' + esc(entry.did || "—") + '</span></li>' +
        '<li><span class="k">Shoulder during</span><span class="v">' + statusDot(entry.shoulder_during) + ' ' + esc(entry.shoulder_during || "") + '</span></li>' +
        '<li><span class="k">Shoulder post-24h</span><span class="v">' + statusDot(entry.shoulder_post_24h) + ' ' + esc(entry.shoulder_post_24h || "") + '</span></li>' +
        (entry.sleep_side_tolerance ? '<li><span class="k">Sleep tolerance</span><span class="v">' + esc(entry.sleep_side_tolerance) + '</span></li>' : "") +
        (entry.notes ? '<li><span class="k">Notes</span><span class="v">' + esc(entry.notes) + '</span></li>' : "") +
      '</ul>' +
    '</div>';
  }

  function briefBlock(iso) {
    const briefs = state.daily_briefs || {};
    const b = briefs[iso];
    if (!b) return "";
    const row = function (label, text) {
      if (!text) return "";
      return '<div class="brief-row"><span class="brief-label">' + esc(label) + '</span><p>' + esc(text) + '</p></div>';
    };
    return '<section class="brief">' +
      '<h3>Today’s brief</h3>' +
      row("Why", b.why_today) +
      row("Evidence", b.evidence) +
      row("Building toward", b.building_toward) +
      row("Adjusted", b.modification) +
    '</section>';
  }

  function todayPanel() {
    const iso = todayISO();
    const planned = plannedSessionForDate(iso);
    const sessionDef = workouts.sessions[planned.session_id] || workouts.sessions.rest;
    const log = logEntryFor(iso);
    const comp = completionFor(iso);

    let footer;
    if (log) {
      footer = loggedSummary(log);
    } else if (comp.done && comp.source === "garmin") {
      const a = comp.activity;
      footer =
        '<div class="complete-banner">' +
          '<span class="check">✓</span>' +
          '<div class="complete-text">' +
            '<strong>Done · auto-detected</strong>' +
            '<span>' + esc(a.type) + ' · ' + esc(a.detail) + ' · via Garmin</span>' +
          '</div>' +
        '</div>' +
        '<p class="dim small">Tell Claude how it went (shoulder color, notes) and the full log will be saved.</p>';
    } else if (comp.done && comp.source === "manual") {
      const t = new Date(comp.ts);
      const tStr = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      footer =
        '<div class="complete-banner">' +
          '<span class="check">✓</span>' +
          '<div class="complete-text"><strong>Marked done</strong><span>at ' + esc(tStr) + '</span></div>' +
          '<button class="complete-undo" data-action="undo-complete">undo</button>' +
        '</div>' +
        '<p class="dim small">Tell Claude how it went and the full log will be saved.</p>';
    } else {
      footer =
        '<button class="complete-btn" data-action="mark-complete">✓ Mark complete</button>' +
        '<p class="dim small">Or tell Claude how it went and the full log will be saved.</p>';
    }

    const checkBadge = comp.done ? ' <span class="check-badge" title="completed">✓</span>' : '';
    return '<section class="card today">' +
      '<header>' +
        '<div class="kicker">Today · ' + esc(fmtFull(iso)) + '</div>' +
        '<h2>' + esc(sessionDef.title) + checkBadge + '</h2>' +
      '</header>' +
      sessionHTML(planned) +
      footer +
      briefBlock(iso) +
    '</section>';
  }

  function weekPanel() {
    const today = todayISO();
    const weekStart = addDays(today, -isoToDate(today).getDay());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(weekStart, i);
      const planned = plannedSessionForDate(iso);
      const sessionDef = workouts.sessions[planned.session_id] || workouts.sessions.rest;
      const log = logEntryFor(iso);
      const isToday = iso === today;
      const comp = completionFor(iso);
      const cls = ((isToday ? "today " : "") + (comp.done ? "done" : "")).trim();
      days.push(
        '<li class="' + cls + '">' +
          '<div class="weekday">' + esc(dayName(iso).slice(0,3).toUpperCase()) + (comp.done ? '<span class="weekcheck">✓</span>' : '') + '</div>' +
          '<div class="weekdate">' + esc(iso.slice(5)) + '</div>' +
          '<div class="weeklabel">' + esc(sessionDef.title) + '</div>' +
          '<div class="weekstatus">' + statusDot(log && log.shoulder_during) + statusDot(log && log.shoulder_post_24h) + '</div>' +
        '</li>'
      );
    }
    return '<section class="card"><h2>This week</h2>' +
      '<ul class="weekgrid">' + days.join("") + '</ul>' +
    '</section>';
  }

  function streakPanel() {
    const today = todayISO();
    const N = 14;
    const cells = [];
    for (let i = N - 1; i >= 0; i--) {
      const iso = addDays(today, -i);
      const log = logEntryFor(iso);
      const comp = completionFor(iso);
      cells.push(
        '<div class="streakcell ' + (comp.done ? "done" : "") + '" title="' + esc(iso) + (comp.done ? " · done" : "") + '">' +
          '<div class="streakdate">' + esc(iso.slice(8)) + '</div>' +
          '<div class="streakdots">' + statusDot(log && log.shoulder_during) + statusDot(log && log.shoulder_post_24h) + '</div>' +
        '</div>'
      );
    }
    return '<section class="card">' +
      '<h2>Last 14 days · shoulder</h2>' +
      '<p class="dim small">Top dot = during exercise · Bottom dot = post-24h. Drift is the killer, not absolute level.</p>' +
      '<div class="streak">' + cells.join("") + '</div>' +
      '<div class="legend">' +
        '<span><span class="dot green"></span> green</span>' +
        '<span><span class="dot yellow"></span> yellow</span>' +
        '<span><span class="dot red"></span> red</span>' +
        '<span><span class="dot empty"></span> no log</span>' +
      '</div>' +
    '</section>';
  }

  let lastDay = todayISO();
  function renderDynamic() {
    document.getElementById("today-panel").innerHTML = todayPanel();
    document.getElementById("week-panel").innerHTML = weekPanel();
    document.getElementById("streak-panel").innerHTML = streakPanel();
    decorateTimers(document.body);
    decorateProgramTimers(document.body);
    lastDay = todayISO();
  }
  renderDynamic();

  // Re-render at the next day boundary so an open PWA picks it up without a refresh.
  setInterval(function () {
    if (todayISO() !== lastDay) renderDynamic();
  }, 60000);

  // ...and when the PWA comes back to the foreground after being backgrounded.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      if (todayISO() !== lastDay) renderDynamic();
      // re-pump the active timer so the UI catches up after the tab was hidden
      if (active && !active.paused) {
        if (active.raf) cancelAnimationFrame(active.raf);
        tickActive();
      }
      if (program && !program.paused) {
        if (program.raf) cancelAnimationFrame(program.raf);
        tickProgram();
      }
    }
  });

  // Full-screen timer controls (overlay lives in static HTML).
  const ftPause = document.getElementById("ft-pause");
  const ftClose = document.getElementById("ft-close");
  const ftOverlay = document.getElementById("ft-overlay");
  if (ftPause) ftPause.addEventListener("click", function () { pauseProgram(); });
  if (ftClose) ftClose.addEventListener("click", function () { closeProgram(); });
  if (ftOverlay) ftOverlay.addEventListener("click", function (e) {
    // Tap anywhere on the overlay (other than the controls) when DONE to close.
    if (program && program.phases[program.idx] && program.phases[program.idx].type === "done"
        && !e.target.closest("#ft-controls")) {
      closeProgram();
    }
  });

  // Click delegation for timer-btn taps and mark-complete / undo buttons.
  document.addEventListener("click", function (e) {
    const tBtn = e.target.closest(".timer-btn");
    if (tBtn) {
      e.preventDefault();
      primeAudio();
      startTimer(tBtn);
      return;
    }
    const action = e.target.closest("[data-action]");
    if (!action) return;
    const a = action.dataset.action;
    if (a === "mark-complete") {
      const iso = todayISO();
      const m = manualMap();
      m[iso] = Date.now();
      setManual(m);
      renderDynamic();
    } else if (a === "undo-complete") {
      const iso = todayISO();
      const m = manualMap();
      delete m[iso];
      setManual(m);
      renderDynamic();
    }
  });
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
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; overflow-x: hidden; }
  h1 { font-size: 18px; margin: 8px 0 16px; color: var(--dim); font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
  h2 { font-size: 18px; margin: 0 0 12px; }
  h3 { font-size: 14px; margin: 14px 0 6px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  .card.today header .kicker { font-size: 12px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
  .card.today header h2 { font-size: 22px; margin: 0 0 10px; }
  .session-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; color: var(--dim); font-size: 13px; }
  .badge.override { background: var(--accent); color: #0a0d12; padding: 2px 6px; border-radius: 6px; font-size: 11px; font-weight: 600; }
  .override-reason { color: var(--accent); font-size: 12px; margin: 0 0 10px; line-height: 1.4; overflow-wrap: anywhere; }
  .notes { padding-left: 18px; margin: 6px 0 10px; }
  .notes li { color: var(--dim); font-size: 14px; margin-bottom: 4px; overflow-wrap: anywhere; }
  .ex-list { list-style: none; padding: 0; margin: 0; }
  .ex { padding: 10px 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
  .ex:last-child { border-bottom: 0; }
  .ex-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; min-width: 0; }
  .ex-name { min-width: 0; overflow-wrap: anywhere; }
  .ex-name a { color: var(--accent); text-decoration: none; }
  .ex-name a:active { opacity: 0.6; }
  .ex-pres { color: var(--dim); font-size: 13px; text-align: right; flex-shrink: 0; max-width: 60%; overflow-wrap: anywhere; }
  .ex-load { font-size: 13px; color: var(--dim); margin-top: 2px; overflow-wrap: anywhere; }
  .note { font-size: 12px; color: var(--dim); margin-top: 4px; font-style: italic; overflow-wrap: anywhere; }
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
  .timer-slot { display: block; margin-top: 8px; }
  .timer-slot:empty { display: none; }
  .timer-slot:has(.timer-btn:only-child) { margin-top: 6px; }
  .timer-btn {
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 5px 12px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
  }
  .timer-btn:active { opacity: 0.6; }
  .timer-btn.running { background: var(--accent); color: #0a0d12; border-color: var(--accent); font-weight: 600; }
  .timer-btn.paused { background: transparent; color: var(--accent); border-color: var(--accent); opacity: 0.7; }
  .timer-cancel {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--dim);
    border-radius: 14px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    margin-left: 6px;
    font-family: inherit;
  }
  .timer-cancel:active { opacity: 0.6; }
  .timer-phase { font-size: 11px; color: var(--accent); font-style: italic; margin-top: 6px; }
  .timer-bar { height: 3px; background: var(--bg); border-radius: 2px; margin-top: 4px; overflow: hidden; }
  .timer-fill { height: 100%; background: var(--accent); width: 0%; }
  .complete-btn {
    margin-top: 14px;
    padding: 12px 14px;
    background: transparent;
    border: 1px solid var(--green);
    color: var(--green);
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    font-family: inherit;
  }
  .complete-btn:active { opacity: 0.7; }
  .brief { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .brief h3 { font-size: 11px; margin: 0 0 8px; }
  .brief-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; margin-bottom: 8px; }
  .brief-row:last-child { margin-bottom: 0; }
  .brief-label { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; padding-top: 2px; }
  .brief-row p { margin: 0; font-size: 13px; line-height: 1.45; color: var(--ink); overflow-wrap: anywhere; min-width: 0; }
  @media (max-width: 480px) {
    .brief-row { grid-template-columns: 1fr; gap: 2px; }
  }
  .complete-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: rgba(74, 222, 128, 0.08);
    border: 1px solid var(--green);
    border-radius: 10px;
    margin-top: 14px;
  }
  .complete-banner .check { color: var(--green); font-weight: 700; font-size: 18px; flex-shrink: 0; }
  .complete-banner .complete-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .complete-banner .complete-text strong { color: var(--green); font-size: 14px; }
  .complete-banner .complete-text span { color: var(--dim); font-size: 12px; }
  .complete-undo {
    background: transparent;
    border: 0;
    color: var(--dim);
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
    font-family: inherit;
    padding: 4px 6px;
  }
  .check-badge { color: var(--green); font-size: 16px; margin-left: 6px; vertical-align: middle; }
  .weekcheck { color: var(--green); font-size: 11px; margin-left: 3px; font-weight: 700; }
  .weekgrid li.done { border-color: var(--green); }
  .streakcell.done { border-color: var(--green); background: rgba(74, 222, 128, 0.08); }

  /* full-screen program timer (hangboard) */
  .fullscreen-timer-btn {
    display: block;
    width: 100%;
    margin: 8px 0 0;
    padding: 14px 16px;
    border: 0;
    border-radius: 10px;
    background: var(--green);
    color: #08130c;
    font-weight: 700;
    font-size: 15px;
    line-height: 1.3;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .fullscreen-timer-btn:active { transform: scale(0.98); }
  body.ft-open { overflow: hidden; }
  #ft-overlay {
    position: fixed; inset: 0;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    z-index: 1000;
    padding: 24px;
    color: #fff;
    font-family: inherit;
    transition: background-color 250ms ease;
    background: #111;
  }
  #ft-overlay.active { display: flex; }
  #ft-overlay[data-phase="prep"] { background: #1e3a5f; }
  #ft-overlay[data-phase="ready"] { background: #b8860b; }
  #ft-overlay[data-phase="work"] { background: #167c3e; }
  #ft-overlay[data-phase="rest"] { background: #b91c1c; }
  #ft-overlay[data-phase="set_rest"] { background: #7f1d1d; }
  #ft-overlay[data-phase="done"] { background: #0a0a0a; }
  #ft-header {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 16px);
    left: 0; right: 0;
    text-align: center;
    padding: 0 24px;
  }
  #ft-exercise {
    font-size: clamp(15px, 4vw, 22px);
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    opacity: 0.92;
  }
  #ft-grip {
    margin-top: 4px;
    font-size: clamp(13px, 3.5vw, 18px);
    font-weight: 600;
    opacity: 0.85;
  }
  /* During the prep phase the message is the focus, not the countdown. */
  #ft-overlay[data-phase="prep"] #ft-sub {
    font-size: clamp(20px, 4.5vw, 28px);
    line-height: 1.45;
    font-weight: 600;
    margin: 24px 16px 16px;
    max-width: 560px;
  }
  #ft-overlay[data-phase="prep"] #ft-time {
    font-size: clamp(80px, 22vw, 180px);
  }
  #ft-label {
    font-size: clamp(40px, 10vw, 80px);
    font-weight: 900;
    letter-spacing: 2px;
    margin: 0 0 8px;
    text-shadow: 0 2px 12px rgba(0,0,0,0.4);
  }
  #ft-sub {
    font-size: clamp(16px, 3.5vw, 22px);
    opacity: 0.92;
    margin: 0 0 24px;
    max-width: 90%;
  }
  #ft-time {
    font-size: clamp(120px, 32vw, 260px);
    font-weight: 900;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    margin: 0;
    text-shadow: 0 4px 24px rgba(0,0,0,0.5);
  }
  #ft-progress {
    margin-top: 20px;
    font-size: 13px;
    opacity: 0.75;
    letter-spacing: 1px;
  }
  #ft-controls {
    position: fixed;
    bottom: 32px;
    left: 0; right: 0;
    display: flex;
    justify-content: center;
    gap: 16px;
  }
  #ft-pause, #ft-close {
    appearance: none;
    border: 2px solid rgba(255,255,255,0.6);
    background: rgba(0,0,0,0.25);
    color: #fff;
    font-family: inherit;
    font-weight: 700;
    font-size: 16px;
    padding: 14px 24px;
    border-radius: 999px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  #ft-pause:active, #ft-close:active { transform: scale(0.97); }
  #ft-close { font-size: 14px; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Coach</h1>
    <div id="today-panel"></div>
    ${recorderPanel()}
    <div id="week-panel"></div>
    <div id="streak-panel"></div>
    ${mobilityPanel()}
    ${garminPanel()}
    ${howToPanel()}
    <footer class="foot">Generated ${esc(new Date().toISOString())} · Phase: ${esc(state.user && state.user.phase || "—")}</footer>
  </div>

  <div id="ft-overlay" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ft-exercise">
    <div id="ft-header">
      <div id="ft-exercise"></div>
      <div id="ft-grip"></div>
    </div>
    <h2 id="ft-label">GET READY</h2>
    <p id="ft-sub"></p>
    <div id="ft-time">0</div>
    <div id="ft-progress"></div>
    <div id="ft-controls">
      <button id="ft-pause" type="button">❚❚ Pause</button>
      <button id="ft-close" type="button" aria-label="Close timer">✕ End</button>
    </div>
  </div>

  <script id="data-workouts" type="application/json">${safeJSON(workouts)}</script>
  <script id="data-state" type="application/json">${safeJSON(state)}</script>

  <script>
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  </script>

  <script>
    (${clientRenderer.toString()})();
  </script>

  <script>
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
console.log(`Wrote index.html (${html.length} bytes) at ${todayISO()} (${dayName(todayISO())}). Day rendering is now client-side.`);
