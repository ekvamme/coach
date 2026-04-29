const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageBreak, VerticalAlign, ExternalHyperlink,
} = require('docx');

// ---- Style constants ----
const FONT = "Arial";
const TXT = 22;       // 11pt body
const SMALL = 18;     // 9pt small
const ACCENT = "2E5C8A";
const SUBTLE = "595959";
const HIDARK = "1F3864";
const LIGHTBG = "EAF1F8";
const LIGHTYELLOW = "FFF2CC";
const LIGHTRED = "FBE5D6";
const LIGHTGREEN = "E2EFD9";
const LIGHTGRAY = "F2F2F2";

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const cellMargins = { top: 90, bottom: 90, left: 130, right: 130 };

// ---- Exercise → demo URL map (curated, verified via web search) ----
const URLS = {
  "Bottom-up Turkish get-up": "https://www.youtube.com/watch?v=Z_YHkXGiieU",
  "Single-leg row, balance": "https://www.youtube.com/watch?v=SF5cUMD5LYI",
  "Bottom-up KB front carry": "https://www.youtube.com/watch?v=UpBzi0HIdAI",
  "Dead bug": "https://www.youtube.com/watch?v=bxn9FBrt4-A",
  "Side plank": "https://www.youtube.com/watch?v=iNbH7_edNI8",
  "Pallof press": "https://www.youtube.com/watch?v=dBAmQ9bx3JA",
  "Push-up (decline close-grip)": "https://www.youtube.com/watch?v=jssZppXpG4k",
  "Cossack squat": "https://www.youtube.com/watch?v=tpczTeSkHz0",
  "ATG / Bulgarian split squat": "https://www.youtube.com/watch?v=qfpkwZlG-cs",
  "Single-leg RDL": "https://www.youtube.com/watch?v=Zfr6wizR8rs",
  "DB floor press": "https://www.youtube.com/watch?v=AqYFvc9t_vU",
  "Tibialis raises": "https://www.youtube.com/watch?v=O8ZcXfwFuqs",
  "Hollow body hold": "https://www.youtube.com/watch?v=LlDNef_Ztsc",
  "Cat-cow + thread the needle": "https://www.youtube.com/watch?v=OWebrsecy7g",
  "World's greatest stretch": "https://www.youtube.com/watch?v=-CiWQ2IvY34",
  "90/90 hip switches": "https://www.youtube.com/watch?v=HUZimFZJZWU",
  "Couch stretch": "https://www.youtube.com/watch?v=nTJaGnjUkTY",
  "Standing calf stretch (bent + straight knee)": "https://www.youtube.com/watch?v=osYF1clbyMs",
  "Pigeon stretch": "https://www.youtube.com/watch?v=Z3t7KrsvHI4",
  "Pancake stretch": "https://www.youtube.com/watch?v=Zl1R9iGWt18",
  "Frog stretch": "https://www.youtube.com/watch?v=hyTgVKeFU1k",
  "Deep squat hold": "https://www.youtube.com/watch?v=YjjZnQpXB2U",
  "Hip CARs": "https://www.youtube.com/watch?v=zbH4XmSREoc",
  "Ankle dorsiflexion (knee-to-wall)": "https://www.youtube.com/watch?v=u3NbKOXl75k",
  "Foam roller t-spine extension": "https://www.youtube.com/watch?v=hJuoqOHLbzY",
  "Band pull-aparts": "https://www.youtube.com/watch?v=D-3bRfprMGI",
  "Band external rotation": "https://www.youtube.com/watch?v=NMj88M5eu8A",
  "Scap push-ups": "https://www.youtube.com/watch?v=LeMk15TN0No",
  "Prone Y-T-W": "https://www.youtube.com/watch?v=SSy4XHJHIvw",
  "ARC training (climbing endurance)": "https://www.youtube.com/@HoopersBeta",
};

// ---- Helpers ----
const t = (text, opts = {}) => new TextRun({
  text,
  bold: opts.bold,
  italics: opts.italics,
  size: opts.size || TXT,
  color: opts.color,
  font: FONT,
});

function linkText(text, url, opts = {}) {
  return new ExternalHyperlink({
    children: [new TextRun({
      text,
      bold: opts.bold,
      italics: opts.italics,
      size: opts.size || TXT,
      font: FONT,
      style: "Hyperlink",
    })],
    link: url,
  });
}

const para = (children, opts = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [children],
  alignment: opts.alignment,
  spacing: opts.spacing || { after: 80 },
  heading: opts.heading,
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, bold: true, size: 40, font: FONT, color: HIDARK })],
  spacing: { before: 0, after: 120 },
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, bold: true, size: 30, font: FONT, color: HIDARK })],
  spacing: { before: 320, after: 100 },
});

const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  children: [new TextRun({ text, bold: true, size: 26, font: FONT, color: ACCENT })],
  spacing: { before: 240, after: 80 },
});

const h4 = (text) => para([new TextRun({ text, bold: true, size: 22, font: FONT, color: SUBTLE })], { spacing: { before: 120, after: 60 } });

const bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: "bullets", level },
  children: [new TextRun({ text, size: TXT, font: FONT })],
  spacing: { after: 40 },
});

const bulletMix = (runs, level = 0) => new Paragraph({
  numbering: { reference: "bullets", level },
  children: runs,
  spacing: { after: 40 },
});

// Render an exercise bullet: linked label (if URL exists) + spec/weight info
function exBullet(item, level = 0) {
  // item = { label, spec?, weight?, url? }
  const url = item.url || URLS[item.label];
  const labelRun = url ? linkText(item.label, url, { bold: true }) : t(item.label, { bold: true });
  const runs = [labelRun];
  if (item.spec) runs.push(t("  —  " + item.spec, { color: ACCENT }));
  if (item.weight) runs.push(t("  —  " + item.weight, { color: ACCENT }));
  return bulletMix(runs, level);
}

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function cell(content, opts = {}) {
  const fill = opts.fill;
  const width = opts.width;
  const para = Array.isArray(content) ? content : [content];
  return new TableCell({
    borders: cellBorders,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    verticalAlign: VerticalAlign.CENTER,
    children: para,
  });
}

// ---- Common exercise blocks ----

// Standard warm-up and cool-down for strength sessions
const strengthAWarmup = [
  { label: "Foam roller t-spine extension", spec: "2 min" },
  { label: "Band pull-aparts", spec: "2 × 15" },
  { label: "Band external rotation", spec: "2 × 15/side" },
];
const strengthBWarmup = [
  { label: "Foam roller t-spine extension", spec: "2 min" },
  { label: "Scap push-ups", spec: "2 × 8" },
  { label: "Prone Y-T-W", spec: "2 × 8 each letter" },
];
const strengthCooldown = [
  { label: "Band external rotation", spec: "3 × 15/side" },
  { label: "Foam roller t-spine extension", spec: "1–2 min" },
  { label: "Deep squat hold", spec: "2 min (Strength B only)" },
];

// ---- Sessions ----

const climbSession = {
  title: "Climb #1 — Auburn Quarry rope solo",
  notes: "Bike there and back is your warm-up — don't double-cardio today. Track resolution time of any post-session shoulder burning.",
  bullets: [
    "Bike commute to Quarry (zone 2)",
    "10 min easy traversing / shoulder mobility at the wall",
    "Climb at moderate intensity. Avoid max-effort cranking on the left arm in compromised positions (deep underclings, gastons, full lock-offs)",
    "Stop with one good lap in the tank — leaving reps on the table is the point this month",
  ],
  cooldown: [
    { label: "Band external rotation", spec: "3 × 15/side" },
    { label: "Foam roller t-spine extension", spec: "2 min" },
  ],
};

const strengthA = {
  title: "Strength A — pull / cuff / core (50–60 min)",
  notes: "Existing PT staples are the spine of this day.",
  warmup: strengthAWarmup,
  exercises: [
    { label: "Pull-ups", weight: "3 × 8, bodyweight (add 3-sec lower when 3×8 feels easy)" },
    { label: "Bottom-up Turkish get-up", weight: "3 reps/side @ 17.5 lb (test 20 lb every 2 wk once 20 lb KB arrives)" },
    { label: "Single-leg row, balance", weight: "3 × 8/side @ 20 lb" },
    { label: "Bottom-up KB front carry", weight: "2 × 30 m/side @ 20 lb (held at 90° front flexion)" },
    { label: "Dead bug", weight: "3 × 10, bodyweight" },
    { label: "Side plank", weight: "3 × 30 s/side" },
    { label: "Pallof press", weight: "3 × 10/side, band" },
  ],
  cooldown: [
    { label: "Band external rotation", spec: "3 × 15/side" },
    { label: "Foam roller t-spine extension", spec: "1–2 min" },
  ],
};

const wedRun = {
  title: "Run — hilly zone 2 trail",
  notes: "Conversational pace. Resist pushing.",
  bullets: [
    "45–60 min, hilly trail, zone 2",
    "Optional: 4 × ~20 s strides at the end (only if fresh)",
  ],
  cooldown: [
    { label: "Standing calf stretch (bent + straight knee)", spec: "60 s each variation" },
    { label: "Couch stretch", spec: "90 s/side" },
    { label: "Pigeon stretch", spec: "60 s/side" },
    { label: "Foam roller", spec: "glutes / IT band / quads / calves, 90 s each" },
  ],
};

const strengthB = {
  title: "Strength B — push / hinge / mobility-biased lower body (50–60 min)",
  notes: "Bolded movements are the explicit anti-tightening insurance for the running build.",
  warmup: strengthBWarmup,
  exercises: [
    { label: "Push-up (decline close-grip)", weight: "3 × 10–15, bodyweight (regular if too hard)" },
    { label: "Cossack squat", weight: "3 × 6/side, bodyweight (wks 3–4: optional 10–15 lb DB goblet)" },
    { label: "ATG / Bulgarian split squat", weight: "3 × 8/side, bodyweight (wks 3–4: 15 lb DBs), slow eccentric" },
    { label: "Single-leg RDL", weight: "3 × 8/side @ 20 lb (progress to 25 lb when 8/side feels strong), full stretch at bottom" },
    { label: "DB floor press", weight: "3 × 10 @ 25 lb DBs each, slow eccentric" },
    { label: "Tibialis raises", weight: "2 × 20, bodyweight, against wall" },
    { label: "Hollow body hold", weight: "3 × 20 s, bodyweight" },
  ],
  cooldown: [
    { label: "Band external rotation", spec: "3 × 15/side" },
    { label: "Deep squat hold", spec: "2 min" },
  ],
};

const friMob = {
  title: "Mobility or rest",
  notes: "If Tue/Thu cooked you, take it fully off. Otherwise: longer mobility block.",
  exercises: [
    { label: "Foam roller t-spine extension", spec: "2 min" },
    { label: "Band external rotation", spec: "3 × 15/side" },
    { label: "Pancake stretch", spec: "active + passive, 2 min total" },
    { label: "Frog stretch", spec: "60 s" },
    { label: "Deep squat hold", spec: "2 min" },
    { label: "Hip CARs", spec: "5 each direction/side" },
    { label: "Ankle dorsiflexion (knee-to-wall)", spec: "10/side" },
  ],
};

const sat_hike = {
  title: "Long day — trail hike",
  notes: "Conversational pace, light day pack. Base-building.",
  bullets: [
    "2–4 hr hilly trail",
    "Light day pack (water, snacks)",
  ],
  cooldown: [
    { label: "Couch stretch", spec: "90 s/side" },
    { label: "Pigeon stretch", spec: "60 s/side" },
    { label: "Standing calf stretch (bent + straight knee)", spec: "60 s each" },
  ],
};

const sat_homeBoard = {
  title: "Light home tension board session (only if 2 wks of green)",
  notes: "Vertical to slight overhang only. NO 30° steepness yet. Sustained moderate moves, never pumped.",
  bullets: [
    "10 min warm-up: easy traversing on the lowest-angle setting available",
    "20–30 min sustained climbing — moderate movements, easy holds, low-angle wall (this is essentially ARC training — see link)",
    "If shoulder feels great: end with 10 min easy bike or run",
  ],
  exercises: [
    { label: "ARC training (climbing endurance)", spec: "see Hooper's Beta channel for ARC method" },
  ],
  cooldown: [
    { label: "Band external rotation", spec: "3 × 15/side" },
    { label: "Foam roller t-spine extension", spec: "2 min" },
    { label: "Deep squat hold", spec: "2 min" },
  ],
};

const sat_donnerStart = {
  title: "Donner Pass shakedown trip — Day 1 (replaces home board)",
  notes: "Memorial Day weekend opportunity. Prime granite-crack window before summer heat.",
  bullets: [
    "Drive to Donner Pass (≈45 min from Auburn)",
    "Warm up on a 5.7–5.8 crack (e.g., Black Tie area)",
    "Lead 1–2 routes at 5.9 (onsight pace)",
    "Belay-only or follow on a 10a project to keep pulling load reasonable",
    "Listen carefully to shoulder response — log post-day burning resolution time",
  ],
};

const sat_donnerEnd = {
  title: "Donner Pass shakedown trip — Day 2",
  notes: "Lighter day. Moderate climbing, tape hands early.",
  bullets: [
    "Easier routes today — 5.8 to 5.9 cracks",
    "Tape hands early; let crack technique drive, not strength",
    "Stop with energy in the tank",
    "Drive home, post-day mobility 10 min",
  ],
};

const restDay = {
  title: "Rest",
  notes: "Sunday is full rest. No bonus workouts.",
  bullets: [
    "Optional: 5–10 min daily morning mobility, slow walk",
    "Sleep, hydrate, eat well",
  ],
};

// Render a single day session into paragraphs
function renderDay(dayLabel, date, session) {
  const blocks = [
    h3(`${dayLabel} ${date} — ${session.title}`),
  ];
  if (session.notes) {
    blocks.push(para([t(session.notes, { italics: true, color: SUBTLE, size: SMALL })], { spacing: { after: 80 } }));
  }
  if (session.warmup && session.warmup.length) {
    blocks.push(h4("Warm-up"));
    for (const w of session.warmup) blocks.push(exBullet(w));
  }
  if (session.bullets && session.bullets.length) {
    if (session.warmup) blocks.push(h4("Session"));
    for (const b of session.bullets) blocks.push(bullet(b));
  }
  if (session.exercises && session.exercises.length) {
    if (session.warmup || session.bullets) blocks.push(h4("Main work"));
    for (const e of session.exercises) blocks.push(exBullet(e));
  }
  if (session.cooldown && session.cooldown.length) {
    blocks.push(h4("Cool-down"));
    for (const c of session.cooldown) blocks.push(exBullet(c));
  }
  return blocks;
}

// ---- Pages ----

// Page 1: Title + context
const titleBlock = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: "Exercise Schedule", bold: true, size: 56, font: FONT, color: HIDARK })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: "May 2026 — 4-Week Preview", bold: true, size: 32, font: FONT, color: ACCENT })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [new TextRun({ text: "Phase 1: Establish baseline + ramp climbing 1 → 2×/wk", italics: true, size: 22, font: FONT, color: SUBTLE })],
  }),
  para([t("Exercise names in blue are clickable links to demo videos. Vetted from reputable sources (StrongFirst, Squat University, Knees Over Toes Guy, Eric Cressey, NASM, Hooper's Beta).", { italics: true, color: SUBTLE })], { spacing: { after: 200 } }),
];

const phaseSummary = [
  h2("Phase 1 at a glance"),
  bullet("Goal of the month: lock in a stable, observable response to current load and ramp climbing from 1× to 2×/week if symptoms stay green"),
  bullet("Climbing volume: weeks 1–2 — Quarry once a week. Weeks 3–4 — add a light home tension board session on Saturday if 2 weeks of green status"),
  bullet("Running: 1 hilly trail run / week (45–60 min, zone 2)"),
  bullet("Strength: 2 sessions per week (Tue: pull/cuff/core, Thu: push/hinge/mobility-biased lower body)"),
  bullet("Cardio long day: Saturday — long trail hike (2–4 hr) by default; switched to home board day or Donner/Yosemite shakedown trip when planned"),
  bullet("Bottom-up TGU progression: hold 17.5 lb until 20 lb KB arrives; introduce 20 lb only when 17.5 feels easy across all reps both sides"),
  bullet("Sundays are full rest; Fridays are mobility-only or off"),
];

const stopLight = [
  h2("Stop-light — operational pain-monitoring"),
  para([t("Track the week-over-week trend, not single days. Drift is the killer, not absolute level.", { italics: true, color: SUBTLE })], { spacing: { after: 120 } }),
];

const stopLightTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1400, 7960],
  rows: [
    new TableRow({
      children: [
        cell([para([t("GREEN", { bold: true, color: "385723", size: 22 })])], { fill: LIGHTGREEN, width: 1400 }),
        cell([para([t("Pain-free during exercise. Any post-workout burning fades within ~24 hr. Sleep stable or improving. → Continue or progress.", { size: TXT })])], { width: 7960 }),
      ]
    }),
    new TableRow({
      children: [
        cell([para([t("YELLOW", { bold: true, color: "806000", size: 22 })])], { fill: LIGHTYELLOW, width: 1400 }),
        cell([para([t("Burning lingers more than 24 hr, sleep regresses for one night, OR burning intensity creeping up week-over-week. → Hold loads flat. Likely triggers (in order): home tension board > climbing intensity > top-end TGU. If persists 2 weeks, dial back the suspected trigger 10–20%.", { size: TXT })])], { width: 7960 }),
      ]
    }),
    new TableRow({
      children: [
        cell([para([t("RED", { bold: true, color: "C00000", size: 22 })])], { fill: LIGHTRED, width: 1400 }),
        cell([para([t("Pain DURING exercise, sharp pain anywhere, sleep regresses multiple nights, or symptoms progressively worse for 2+ weeks. → Cut climbing volume in half, drop board/fingerboard work, message PT.", { size: TXT })])], { width: 7960 }),
      ]
    }),
  ]
});

const mobility = [
  h2("Daily mobility — non-negotiable"),
  h3("Every morning (5–7 min, before coffee)"),
  exBullet({ label: "Cat-cow + thread the needle", spec: "8 reps each" }),
  exBullet({ label: "World's greatest stretch", spec: "5/side" }),
  exBullet({ label: "90/90 hip switches", spec: "8/side" }),
  exBullet({ label: "Couch stretch", spec: "60 s/side  (highest-ROI movement for runners)" }),
  h3("After every run (10 min — non-negotiable on long-run day)"),
  exBullet({ label: "Standing calf stretch (bent + straight knee)", spec: "60 s each" }),
  bullet("Active hamstring scoop (hand on wall, leg up), 10 each"),
  exBullet({ label: "Couch stretch", spec: "90 s/side" }),
  exBullet({ label: "Pigeon stretch", spec: "60 s/side" }),
  bullet("Foam roller: glutes, IT band, quads, calves — 90 s each"),
  h3("Two longer blocks/week (15–20 min — Friday + Sunday morning)"),
  exBullet({ label: "Pancake stretch", spec: "active + passive" }),
  exBullet({ label: "Frog stretch", spec: "60 s" }),
  exBullet({ label: "Deep squat hold", spec: "2 min" }),
  exBullet({ label: "Hip CARs", spec: "5 each direction each side" }),
  exBullet({ label: "Ankle dorsiflexion (knee-to-wall)", spec: "10/side" }),
];

// At-a-glance calendar
const dayHeader = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const week1Dates = ["May 4", "May 5", "May 6", "May 7", "May 8", "May 9", "May 10"];
const week1Acts = ["Climb #1\nQuarry", "Strength A", "Run\n45–60 min", "Strength B", "Mobility / off", "Long hike\n2–4 hr", "Rest"];
const week2Dates = ["May 11", "May 12", "May 13", "May 14", "May 15", "May 16", "May 17"];
const week2Acts = ["Climb #1\nQuarry", "Strength A", "Run\n45–60 min", "Strength B", "Mobility / off", "Long hike\n2–4 hr", "Rest"];
const week3Dates = ["May 18", "May 19", "May 20", "May 21", "May 22", "May 23", "May 24"];
const week3Acts = ["Climb #1\nQuarry", "Strength A", "Run\n45–60 min", "Strength B", "Mobility / off", "Light home board\n(if green) OR Donner trip start", "Rest OR\nDonner day 2"];
const week4Dates = ["May 25", "May 26", "May 27", "May 28", "May 29", "May 30", "May 31"];
const week4Acts = ["Memorial Day\nClimb #1 OR Donner day 3", "Strength A", "Run\n45–60 min", "Strength B", "Mobility / off", "Light home board\nOR long hike", "Rest"];

function actCell(date, act, isWeekend = false) {
  const lines = act.split("\n");
  const w = Math.floor(9360 / 7);
  return cell([
    para([t(date, { bold: true, size: SMALL, color: SUBTLE })], { alignment: AlignmentType.CENTER, spacing: { after: 40 } }),
    ...lines.map(l => para([t(l, { size: SMALL })], { alignment: AlignmentType.CENTER, spacing: { after: 0 } })),
  ], { width: w, fill: isWeekend ? LIGHTGRAY : undefined });
}

function buildWeekRow(dates, acts) {
  const cells = dates.map((d, i) => actCell(d, acts[i], i === 6));
  return new TableRow({ children: cells });
}

const headerRow = new TableRow({
  children: dayHeader.map(d => {
    const w = Math.floor(9360 / 7);
    return cell([para([new TextRun({ text: d, bold: true, size: 22, font: FONT, color: "FFFFFF" })], { alignment: AlignmentType.CENTER })], { fill: HIDARK, width: w });
  })
});

const calendar = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1337, 1337, 1337, 1337, 1337, 1337, 1338],
  rows: [
    headerRow,
    buildWeekRow(week1Dates, week1Acts),
    buildWeekRow(week2Dates, week2Acts),
    buildWeekRow(week3Dates, week3Acts),
    buildWeekRow(week4Dates, week4Acts),
  ]
});

const calendarSection = [
  h2("May 2026 — at a glance"),
  calendar,
];

// Strength reference tables with linked exercise names
function refTable(rows, hasHeader = false) {
  const colWidths = [4900, 2200, 2260];
  const trs = rows.map((r, idx) => {
    const isH = hasHeader && idx === 0;
    return new TableRow({
      children: r.map((cellText, i) => {
        let paraChildren;
        // For the first column (exercise name) of non-header rows, link if URL exists
        if (!isH && i === 0 && URLS[cellText]) {
          paraChildren = [linkText(cellText, URLS[cellText], { bold: false })];
        } else {
          paraChildren = [new TextRun({ text: cellText, bold: isH, size: TXT, font: FONT, color: isH ? "FFFFFF" : undefined })];
        }
        return cell([para(paraChildren, { alignment: AlignmentType.LEFT })], { width: colWidths[i], fill: isH ? HIDARK : (idx % 2 === 0 ? LIGHTBG : undefined) });
      }),
      tableHeader: isH,
    });
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: trs,
  });
}

// Build week details
function weekDetail(weekTitle, dates, sessions, notes = []) {
  const blocks = [h2(weekTitle)];
  if (notes.length) {
    blocks.push(para([t(notes.join(" "), { italics: true, color: SUBTLE })], { spacing: { after: 160 } }));
  }
  for (let i = 0; i < 7; i++) {
    blocks.push(...renderDay(dayHeader[i], dates[i], sessions[i]));
  }
  return blocks;
}

const week1Sessions = [climbSession, strengthA, wedRun, strengthB, friMob, sat_hike, restDay];
const week2Sessions = [climbSession, strengthA, wedRun, strengthB, friMob, sat_hike, restDay];
const week3Sessions = [climbSession, strengthA, wedRun, strengthB, friMob, sat_donnerStart, sat_donnerEnd];
const week4Sessions = [
  { ...climbSession, title: "Climb #1 — Auburn Quarry rope solo  (or Donner Day 3 if continuing weekend trip)" },
  strengthA, wedRun, strengthB, friMob,
  sat_homeBoard,
  restDay,
];

// ---- Build document ----

const docContent = [
  ...titleBlock,
  ...phaseSummary,
  ...stopLight,
  stopLightTable,
  ...mobility,
  pageBreak(),
  ...calendarSection,
  para([t("Notes:", { bold: true })], { spacing: { before: 240, after: 60 } }),
  bullet("Memorial Day weekend (May 23–25) is an ideal Donner Pass shakedown opportunity — replaces the Sat home-board session"),
  bullet("Weeks 1–2 = baseline tracking. Don't add anything; just observe. Log post-workout burning resolution time."),
  bullet("Add the Saturday home board session in Week 3 only if 2 consecutive weeks of green status"),
  pageBreak(),
  ...weekDetail("Week 1 — May 4–10  (Baseline)", week1Dates, week1Sessions, [
    "Goal: establish your post-workout symptom baseline. No new exercises, no progressions. Track when burning shows up and how long it takes to resolve."
  ]),
  pageBreak(),
  ...weekDetail("Week 2 — May 11–17  (Baseline, second look)", week2Dates, week2Sessions, [
    "Compare this week's symptom pattern to last week's. Same or improving = green for week 3 progression. Worse = hold."
  ]),
  pageBreak(),
  ...weekDetail("Week 3 — May 18–24  (Add 2nd climb if green)", week3Dates, week3Sessions, [
    "If 2 weeks of green: add a Saturday home-board session (vertical to slight overhang only). If planning Donner trip Memorial Day weekend, the trip replaces the home board — 2 days outdoor counts as the same dose."
  ]),
  pageBreak(),
  ...weekDetail("Week 4 — May 25–31  (Hold or progress)", week4Dates, week4Sessions, [
    "Memorial Day Monday: if continuing Donner trip from week 3, this is Day 3 (light follow-only); if not, Quarry day. Hold loads; nudge bottom-up TGU to 20 lb only if 17.5 lb felt easy across all reps the prior 2 weeks."
  ]),
  pageBreak(),
  h1("Strength Reference"),
  h2("Strength A — pull / cuff / core"),
  para([t("Tuesdays. ~50–60 min. Existing PT staples are the spine of this day. Click any exercise name for a demo video.", { italics: true, color: SUBTLE })], { spacing: { after: 120 } }),
  refTable([
    ["Exercise", "Sets × reps", "Load"],
    ["Pull-ups", "3 × 8", "Bodyweight; add 3-sec lower when easy"],
    ["Bottom-up Turkish get-up", "3/side", "17.5 lb; test 20 lb every 2 wk once available"],
    ["Single-leg row, balance", "3 × 8/side", "20 lb"],
    ["Bottom-up KB front carry", "2 × 30 m/side", "20 lb (held at 90° front flexion)"],
    ["Dead bug", "3 × 10", "Bodyweight"],
    ["Side plank", "3 × 30 s/side", "Bodyweight"],
    ["Pallof press", "3 × 10/side", "Band"],
  ], true),
  h2("Strength B — push / hinge / mobility-biased lower body"),
  para([t("Thursdays. ~50–60 min. Bolded movements protect against running-related hip tightness.", { italics: true, color: SUBTLE })], { spacing: { after: 120 } }),
  refTable([
    ["Exercise", "Sets × reps", "Load"],
    ["Push-up (decline close-grip)", "3 × 10–15", "Bodyweight (regular if too hard)"],
    ["Cossack squat", "3 × 6/side", "Bodyweight; wks 3–4 optional 10–15 lb DB goblet"],
    ["ATG / Bulgarian split squat", "3 × 8/side", "Bodyweight; wks 3–4: 15 lb DBs"],
    ["Single-leg RDL", "3 × 8/side", "20 lb (progress to 25 lb when strong)"],
    ["DB floor press", "3 × 10", "25 lb DBs each, slow eccentric"],
    ["Tibialis raises", "2 × 20", "Bodyweight"],
    ["Hollow body hold", "3 × 20 s", "Bodyweight"],
  ], true),
  para([t("Cool-down both sessions: ", { italics: true, color: SUBTLE, size: SMALL }),
        linkText("Band external rotation", URLS["Band external rotation"], { italics: true, size: SMALL }),
        t(" 3×15/side · ", { italics: true, color: SUBTLE, size: SMALL }),
        linkText("Foam roller t-spine extension", URLS["Foam roller t-spine extension"], { italics: true, size: SMALL }),
        t(" 1–2 min · ", { italics: true, color: SUBTLE, size: SMALL }),
        linkText("Deep squat hold", URLS["Deep squat hold"], { italics: true, size: SMALL }),
        t(" 2 min (Strength B only)", { italics: true, color: SUBTLE, size: SMALL }),
       ], { spacing: { before: 200 } }),
];

const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ]
    }]
  },
  styles: {
    default: { document: { run: { font: FONT, size: TXT } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 40, bold: true, font: FONT, color: HIDARK },
        paragraph: { spacing: { before: 0, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: FONT, color: HIDARK },
        paragraph: { spacing: { before: 320, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: ACCENT },
        paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 2 } },
    ],
    characterStyles: [
      { id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont",
        run: { color: "0563C1", underline: { type: "single" } } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      }
    },
    children: docContent,
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/Users/kvamme/Desktop/exercise/may_2026_preview.docx", buffer);
  console.log("Wrote /Users/kvamme/Desktop/exercise/may_2026_preview.docx");
});
