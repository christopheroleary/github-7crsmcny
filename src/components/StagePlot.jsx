import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Plus, Trash2, RotateCcw, Download, Printer, Copy, Save, FolderOpen,
  Check, X, ImageDown, Crosshair, ClipboardPaste,
  Maximize2, Minimize2, ZoomIn, ZoomOut, BringToFront,
} from "../utils/stagePlotIcons.jsx";

/* ────────────────────────────────────────────────────────────────
   Stage Plot — auto-built from the line-up, adjustable by hand.

   Coordinates are METRES in stage space: (0,0) is the upstage
   stage-right corner. Negative x / y > depth are legal — that's the
   apron and the floor, where PA, subs and the FOH desk live.

   In Seeau: seed `useState(defaultConfig)` from the gig row
   and swap the `window.storage` calls for Supabase. The whole config
   is one JSON blob.
   ──────────────────────────────────────────────────────────────── */

/* ── tokens ─────────────────────────────────────────────────────── */

const C = {
  page: "#E7EAEE", paper: "#FFFFFF", floor: "#F1F4F6",
  ink: "#0F1419", ink70: "#49535F", ink40: "#8A95A2", hair: "#D3D9E0",
  deck: "#212A33", deckHi: "#2C3742", deckEdge: "#3B4855", deckText: "#E6EBF0",
  amp: "#1F8A70", mic: "#5B2A86", wedge: "#EE9B2C", iem: "#2F6FED",
  power: "#E24E36", pa: "#334155", light: "#7C3AED", dj: "#C0392B",
  riser: "#C8CFD7", tape: "#F3C118",
};

/* backline: "instrument" is the generalised case -- anyone whose sound
   reaches the desk via a per-person choice of mic'd amp / DI / mic-only
   (the SOURCES list below). Guitar, bass, percussion, horn and the manual
   "other" catch-all all share it; keys/drums/dj/vocals have their own
   fixed rig instead and never show a source picker. */
const ROLES = {
  vocals: { label: "Lead vocal", short: "VOX", backline: null, tint: "#8E44AD" },
  guitar: { label: "Guitar", short: "GTR", backline: "instrument", tint: "#1F8A70" },
  bass: { label: "Bass", short: "BASS", backline: "instrument", tint: "#C77B22" },
  keys: { label: "Keys", short: "KEYS", backline: "keys", tint: "#2F6FED" },
  drums: { label: "Drums", short: "DRUMS", backline: "kit", tint: "#5C6B7A" },
  percussion: { label: "Percussion", short: "PERC", backline: "instrument", tint: "#9C6B1F" },
  horn: { label: "Horn / sax", short: "HORN", backline: "instrument", tint: "#0E7C86" },
  dj: { label: "DJ", short: "DJ", backline: "dj", tint: "#C0392B" },
  other: { label: "Other", short: "MISC", backline: "instrument", tint: "#B03A6E" },
};

const STAGES = {
  pub: { label: "Pub / bar", w: 5, d: 3.5, riser: false },
  club: { label: "Club", w: 8, d: 5, riser: false },
  large: { label: "Theatre / festival", w: 12, d: 8, riser: true },
};

/* Kit mics are picked channel by channel — every kit is somebody's
   compromise, so nothing here is forced. */
const KIT_CHANNELS = [
  { id: "kickIn", label: "Kick in", mic: "Dynamic" },
  { id: "kickOut", label: "Kick out", mic: "Condenser" },
  { id: "snareTop", label: "Snare top", mic: "SM57" },
  { id: "snareBtm", label: "Snare bottom", mic: "SM57" },
  { id: "hats", label: "Hi-hat", mic: "Condenser" },
  { id: "rack1", label: "Rack tom", mic: "Clip mic" },
  { id: "rack2", label: "Rack tom 2", mic: "Clip mic" },
  { id: "floor1", label: "Floor tom", mic: "Clip mic" },
  { id: "floor2", label: "Floor tom 2", mic: "Clip mic" },
  { id: "ride", label: "Ride", mic: "Condenser" },
  { id: "ohR", label: "OH stage right", mic: "Condenser" },
  { id: "ohL", label: "OH stage left", mic: "Condenser" },
];

const KIT_PRESETS = {
  minimal: { label: "Minimal", ch: ["kickIn", "snareTop", "ohR", "ohL"] },
  standard: { label: "Standard", ch: ["kickIn", "snareTop", "hats", "rack1", "floor1", "ohR", "ohL"] },
  full: { label: "Full", ch: ["kickIn", "kickOut", "snareTop", "snareBtm", "hats", "rack1", "floor1", "ohR", "ohL"] },
};

const kitChannels = (m) =>
  m && m.kitCh && m.kitCh.length ? m.kitCh : KIT_PRESETS[(m && m.kit) || "standard"].ch;

/* how a rig reaches the desk */
const SOURCES = {
  amp: { label: "Mic'd amp", cab: true, di: false },
  ampDI: { label: "Amp on stage, DI from head", cab: true, di: true, silent: true },
  both: { label: "Mic'd amp + DI", cab: true, di: true },
  di: { label: "DI only, no amp", cab: false, di: true },
  modeller: { label: "Modeller, stereo DI", cab: false, di: true, stereo: true },
  mic: { label: "Mic only, no DI/amp", cab: false, di: false, mic: true },
};

/* placeable gear. w/h in metres, top-down footprint */
const GEAR = {
  paTop: { label: "PA top", w: 0.55, h: 0.6, group: "PA" },
  paSub: { label: "Sub", w: 0.7, h: 0.65, group: "PA" },
  fohDesk: { label: "FOH desk", w: 1.2, h: 0.65, group: "Control" },
  monDesk: { label: "Monitor desk", w: 0.9, h: 0.55, group: "Control" },
  stageBox: { label: "Stage box", w: 0.45, h: 0.35, group: "Control" },
  lightBar: { label: "LED bar", w: 1.3, h: 0.28, group: "Lights" },
  uplight: { label: "Uplighter", w: 0.3, h: 0.3, group: "Lights" },
  mover: { label: "Moving head", w: 0.36, h: 0.36, group: "Lights" },
  hazer: { label: "Hazer", w: 0.42, h: 0.36, group: "Lights" },
  panelLight: { label: "Panel light", w: 0.42, h: 0.34, group: "Lights" },
  talkback: {
    label: "Talkback mic", w: 0.3, h: 0.3, group: "Extras",
    sub: "Monitors / IEMs only — not in the mains",
    ch: { name: "Talkback — band only", source: "SM58, monitor sends only", warn: true },
  },
  micStand: { label: "Extra mic", w: 0.3, h: 0.3, group: "Extras", ch: { name: "Extra mic", source: "SM58" } },
  laptop: { label: "Laptop stand", w: 0.7, h: 0.4, group: "Extras" },
  riserBlk: { label: "Riser block", w: 2, h: 1, group: "Extras" },
  fan: { label: "Fan", w: 0.34, h: 0.34, group: "Extras" },
  custom: { label: "Other", w: 0.8, h: 0.5, group: "Extras" },
};

/* Generic, sensibly-roled shapes for the "Band size" quick-presets --
   every real gig's plot is already auto-seeded from its actual roster
   (see stagePlotAdapter.js), this is for starting from scratch or
   reshaping one by hand. */
const BAND_PRESETS = {
  1: [{ role: "vocals", name: "Vocal", sings: true, lead: true }],
  2: [{ role: "guitar", name: "Guitar", sings: true, lead: true }, { role: "drums", name: "Drums" }],
  3: [{ role: "guitar", name: "Guitar", sings: true, lead: true }, { role: "bass", name: "Bass" }, { role: "drums", name: "Drums" }],
  4: [{ role: "vocals", name: "Lead vocal", sings: true, lead: true }, { role: "guitar", name: "Guitar" }, { role: "bass", name: "Bass" }, { role: "drums", name: "Drums" }],
  5: [{ role: "vocals", name: "Lead vocal", sings: true, lead: true }, { role: "guitar", name: "Guitar" }, { role: "bass", name: "Bass" }, { role: "keys", name: "Keys" }, { role: "drums", name: "Drums" }],
  6: [{ role: "vocals", name: "Lead vocal", sings: true, lead: true }, { role: "guitar", name: "Guitar" }, { role: "guitar", name: "Guitar 2" }, { role: "bass", name: "Bass" }, { role: "keys", name: "Keys" }, { role: "drums", name: "Drums" }],
  7: [{ role: "vocals", name: "Lead vocal", sings: true, lead: true }, { role: "guitar", name: "Guitar" }, { role: "guitar", name: "Guitar 2" }, { role: "bass", name: "Bass" }, { role: "keys", name: "Keys" }, { role: "drums", name: "Drums" }, { role: "horn", name: "Sax" }],
};
const PRESET_LABELS = { 1: "Solo", 2: "Duo", 3: "Trio", 4: "4-piece", 5: "5-piece", 6: "6-piece", 7: "7-piece" };

const S = 94;            // px per metre
const PAD = 30;          // px margin for dimension text
/* How far off the deck new gear lands, and how far anything may be
   dragged. The drawn area is worked out from the content, so empty
   floor is never wasted. */
const PLACE = { l: 1.0, r: 1.0, d: 2.0 };
const LIMIT = { l: 3.5, r: 3.5, u: 2.0, d: 4.5 };

let seq = 0;
const uid = (p = "m") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── default gig ────────────────────────────────────────────────── */

const defaultConfig = () => ({
  band: "LadsLadsLads",
  strap: "Rock / pop covers trio",
  venue: "", date: "",
  stage: "pub", custom: { w: 5, d: 3.5 },
  riser: false, lefty: false, tracks: false,
  members: [
    { id: uid(), name: "Nick", role: "guitar", sings: true, lead: false, guest: false, source: "amp", monitor: "iem", kit: "standard" },
    { id: uid(), name: "Chris", role: "bass", sings: true, lead: true, guest: false, source: "ampDI", monitor: "iem", kit: "standard" },
    { id: uid(), name: "Macca", role: "drums", sings: false, lead: false, guest: false, source: "amp", monitor: "iem", kit: "standard" },
  ],
  gear: [],
  power: { on: true, hidden: [], extra: [] },
  overrides: {},
  zOrder: {},
  notes: "Load-in through the side door. We bring our own wedges.",
});

const stageSize = (cfg) => (cfg.stage === "custom" ? cfg.custom : STAGES[cfg.stage]);

/* A seed from the host app may be partial (e.g. no `gear`, no `power`
   yet) — fill in anything missing rather than let the plot crash. */
function mergeIntoDefaults(seed) {
  const base = defaultConfig();
  return {
    ...base,
    ...seed,
    custom: { ...base.custom, ...(seed.custom || {}) },
    power: { ...base.power, ...(seed.power || {}) },
    members: Array.isArray(seed.members) && seed.members.length ? seed.members : base.members,
    gear: Array.isArray(seed.gear) ? seed.gear : [],
    overrides: seed.overrides || {},
    zOrder: seed.zOrder || {},
  };
}

/* ── where a new piece of gear lands ────────────────────────────── */

function defaultSpot(type, n, W, D) {
  const side = n % 2 === 0 ? -1 : 1;             // alternate stage right / left
  const tier = Math.floor(n / 2) * 0.55;
  const outX = side < 0 ? -PLACE.l + 0.1 - tier : W + PLACE.r - 0.1 + tier;
  switch (type) {
    case "paTop": return { x: outX, y: D - 0.7 };
    case "paSub": return { x: outX, y: D + 0.55 };
    case "fohDesk": return { x: W / 2, y: D + PLACE.d - 0.4 };
    case "monDesk": return { x: W - 0.75, y: D - 1.5 };
    case "stageBox": return { x: W - 0.45, y: 0.5 };
    case "lightBar": return { x: side < 0 ? 1 : W - 1, y: 0.22 };
    case "uplight": return { x: side < 0 ? 0.35 + tier : W - 0.35 - tier, y: 0.3 };
    case "mover": return { x: side < 0 ? 0.9 : W - 0.9, y: 0.3 };
    case "hazer": return { x: W - 0.45, y: 0.9 };
    case "panelLight": return { x: side < 0 ? 0.6 + tier : W - 0.6 - tier, y: 0.9 };
    case "talkback": return { x: W / 2 + 1.5, y: 1.5 };
    case "laptop": return { x: W / 2 + 1.2, y: 1.4 };
    case "riserBlk": return { x: W / 2, y: 1.2 };
    case "micStand": return { x: W / 2, y: D - 1.1 };
    case "fan": return { x: W / 2 + 1.4, y: 0.6 };
    default: return { x: W / 2 + (n % 3) * 0.6 - 0.6, y: D / 2 };
  }
}

/* ── layout engine ──────────────────────────────────────────────── */

function buildItems(cfg) {
  const { w: W, d: D } = stageSize(cfg);
  const items = [];
  const members = cfg.members;
  const drummer = members.find((m) => m.role === "drums");
  const backliners = members.filter((m) => m.role !== "drums" && ROLES[m.role].backline);

  const edge = 0.5;
  const kitW = 2.3, kitD = 1.9;
  const kitX = W / 2, kitY = 0.3 + kitD / 2;

  if (drummer) {
    items.push({
      key: `${drummer.id}.kit`, kind: "kit", memberId: drummer.id,
      label: drummer.name, x: kitX, y: kitY, w: kitW, h: kitD,
    });
  }

  const zones = drummer
    ? [{ from: edge, to: Math.max(edge + 0.4, kitX - kitW / 2 - 0.4) },
       { from: Math.min(W - edge - 0.4, kitX + kitW / 2 + 0.4), to: W - edge }]
    : [{ from: edge, to: W / 2 - 0.15 }, { from: W / 2 + 0.15, to: W - edge }];

  const lanes = [[], []];
  backliners.forEach((m, i) => lanes[i % 2].push(m));

  const backX = {};
  lanes.forEach((lane, li) => {
    const z = zones[li];
    lane.forEach((m, i) => {
      const x = clamp(z.from + ((z.to - z.from) * (i + 1)) / (lane.length + 1), edge + 0.35, W - edge - 0.35);
      backX[m.id] = x;
      const back = ROLES[m.role].backline;
      const src = SOURCES[m.source] || SOURCES.amp;
      const isRig = back === "instrument";
      const micOnly = isRig && src.mic;
      const boxOnly = isRig && !src.cab && !src.mic;
      const kind = back === "dj" ? "dj" : back === "keys" ? "keys" : micOnly ? "instMic" : boxOnly ? "di" : "amp";
      const ampSub = src.silent ? "Amp — DI only" : src.di ? "Amp + DI" : "Amp";
      items.push({
        key: `${m.id}.back`, kind, memberId: m.id, labelBelow: true,
        label: boxOnly ? `${m.name} — ${ROLES[m.role].short} DI` : m.name,
        sub: back === "dj" ? "DJ booth" : back === "keys" ? "Keys" : micOnly ? ROLES[m.role].label : boxOnly ? "" : ampSub,
        tint: micOnly ? ROLES[m.role].tint : undefined,
        tag: micOnly ? ROLES[m.role].short : undefined,
        x, y: back === "dj" ? 0.95 : micOnly ? 0.72 : boxOnly ? 0.6 : 0.78,
        w: back === "dj" ? 1.4 : micOnly ? 0.42 : boxOnly ? 0.5 : 0.85,
        h: back === "dj" ? 0.6 : micOnly ? 0.42 : boxOnly ? 0.4 : 0.62,
      });
      if (isRig && src.cab && src.di) {
        items.push({
          key: `${m.id}.backdi`, kind: "di", memberId: m.id, labelBelow: true, noPower: true,
          label: `${m.name} DI`, sub: src.silent ? "From amp head" : "Split from rig",
          x: clamp(x + 0.75, edge, W - edge), y: 0.62, w: 0.42, h: 0.34,
        });
      }
    });
  });

  const singers = members.filter((m) => m.sings && m.role !== "drums");
  const micY = clamp(D - 1.05, 1.4, D - 0.7);
  const wedgeY = clamp(D - 0.42, 1.9, D - 0.28);

  // The lead(s) anchor at/around dead centre rather than wherever their
  // backline rig happens to be -- real co-leads (more than one person
  // genuinely marked lead) spread out evenly straddling the centre line.
  // Backing singers keep inheriting their rig's x, as before.
  const leadMembers = singers.filter((m) => m.lead);
  const leadX = new Map(leadMembers.map((m, i) => [m.id, W / 2 + (i - (leadMembers.length - 1) / 2) * 1.15]));

  const seats = singers
    .map((m) => ({ m, x: leadX.has(m.id) ? leadX.get(m.id) : (backX[m.id] != null ? backX[m.id] : W / 2) }))
    .sort((a, b) => a.x - b.x);

  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < seats.length; i++) {
      const gap = seats[i].x - seats[i - 1].x;
      if (gap < 1.15) {
        const push = (1.15 - gap) / 2;
        seats[i - 1].x -= push;
        seats[i].x += push;
      }
    }
    seats.forEach((s) => (s.x = clamp(s.x, edge + 0.5, W - edge - 0.5)));
  }

  seats.forEach(({ m, x }) => {
    items.push({
      key: `${m.id}.mic`, kind: "mic", memberId: m.id, labelBelow: true,
      label: m.name, sub: m.lead ? "Lead vocal" : "Vocal",
      x, y: micY, w: 0.42, h: 0.42,
    });
  });

  members.forEach((m) => {
    if (m.monitor === "none") return;
    const isDrummer = m.role === "drums";
    const seat = seats.find((s) => s.m.id === m.id);
    const hasRig = backX[m.id] != null;

    if (m.monitor === "iem") {
      items.push({
        key: `${m.id}.iem`, kind: "iem", memberId: m.id, label: m.name, labelBelow: true,
        x: isDrummer ? kitX + kitW / 2 + 0.4 : seat ? seat.x + 0.55 : hasRig ? backX[m.id] + 0.55 : W / 2,
        y: isDrummer ? kitY - 0.4 : seat ? micY - 0.5 : 1.5,
        w: 0.44, h: 0.32,
      });
      return;
    }
    if (isDrummer) {
      items.push({
        key: `${m.id}.wedge`, kind: "wedge", memberId: m.id, label: m.name,
        x: clamp(kitX + kitW / 2 + 0.55, 0.6, W - 0.6), y: kitY + 0.35,
        w: 0.72, h: 0.5, rot: -90,
      });
      return;
    }
    items.push({
      key: `${m.id}.wedge`, kind: "wedge", memberId: m.id, label: m.name,
      x: seat ? seat.x : hasRig ? backX[m.id] : W / 2,
      y: seat ? wedgeY : hasRig ? 1.65 : wedgeY,
      w: 0.78, h: 0.55, rot: 0,
    });
  });

  if (cfg.tracks) {
    items.push({
      key: "tracks.di", kind: "di", label: "Tracks / click", labelBelow: true,
      x: drummer ? clamp(kitX - kitW / 2 - 0.6, 0.5, W - 0.5) : W / 2, y: 0.55,
      w: 0.5, h: 0.4,
    });
  }

  cfg.gear.forEach((g, i) => {
    const spec = GEAR[g.type] || GEAR.custom;
    const spot = defaultSpot(g.type, g.n != null ? g.n : i, W, D);
    items.push({
      key: `${g.id}.gear`, kind: g.type, gearId: g.id, labelBelow: true,
      label: g.label || spec.label, sub: spec.sub,
      x: spot.x, y: spot.y, w: spec.w, h: spec.h, removable: true,
    });
  });

  /* power: one per backline rig, per wedge, per speaker, per lighting
     fixture, per person, per stage corner */
  if (cfg.power.on) {
    const drops = [];
    items.filter((i) => ["amp", "keys", "kit", "dj", "di"].includes(i.kind) && !i.noPower)
      .forEach((it) => drops.push({ key: `pwr.rig.${it.key}`, x: it.x - it.w / 2 - 0.3, y: it.y - it.h / 2 - 0.05, note: "Backline" }));
    items.filter((i) => i.kind === "wedge")
      .forEach((it) => drops.push({ key: `pwr.mon.${it.key}`, x: it.x + it.w / 2 + 0.28, y: it.y, note: "Monitor" }));
    items.filter((i) => ["paTop", "paSub"].includes(i.kind) && !i.noPower)
      .forEach((it) => drops.push({ key: `pwr.pa.${it.key}`, x: it.x - it.w / 2 - 0.3, y: it.y, note: "Speaker" }));
    items.filter((i) => ["lightBar", "uplight", "mover", "hazer", "panelLight"].includes(i.kind) && !i.noPower)
      .forEach((it) => drops.push({ key: `pwr.light.${it.key}`, x: it.x + it.w / 2 + 0.28, y: it.y, note: "Lighting" }));
    members.forEach((m) => {
      const seat = seats.find((s) => s.m.id === m.id);
      const x = seat ? seat.x + 0.45 : backX[m.id] != null ? backX[m.id] + 0.5 : W / 2;
      const y = seat ? micY - 0.45 : 1.25;
      drops.push({ key: `pwr.person.${m.id}`, x, y, note: `${m.name} — pedals / wireless` });
    });
    [[0.3, 0.3], [W - 0.3, 0.3], [0.3, D - 0.3], [W - 0.3, D - 0.3]].forEach(([x, y], i) =>
      drops.push({ key: `pwr.corner.${i}`, x, y, note: "Stage corner" }));
    cfg.power.extra.forEach((p) =>
      drops.push({ key: `pwr.extra.${p.id}`, x: p.x, y: p.y, note: "Added", removable: true }));

    drops
      .filter((d) => !cfg.power.hidden.includes(d.key))
      .forEach((d) => items.push({ ...d, kind: "power", label: "13A", w: 0.3, h: 0.3, power: true }));
  }

  const placed = items.map((it) => {
    const ov = cfg.overrides[it.key];
    return ov ? { ...it, x: ov.x, y: ov.y, moved: true } : it;
  });

  return flipClashingLabels(markClashes(placed));
}

/* If something sits where a caption would go, put the caption above instead. */
function flipClashingLabels(items) {
  const box = (i) => ({ x1: i.x - i.w / 2, x2: i.x + i.w / 2, y1: i.y - i.h / 2, y2: i.y + i.h / 2 });
  const hits = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  return items.map((it) => {
    if (!it.labelBelow) return it;
    const zone = { x1: it.x - 0.5, x2: it.x + 0.5, y1: it.y + it.h / 2 + 0.02, y2: it.y + it.h / 2 + 0.46 };
    const clash = items.some((o) => o.key !== it.key && !o.power && hits(zone, box(o)));
    return clash ? { ...it, labelAbove: true } : it;
  });
}

/* Flags two draggable objects actually sitting on top of each other --
   different from flipClashingLabels above, which only reacts to a caption
   overlapping something. Power drops are excluded both ways: small,
   expected to sit close to other things, not worth flagging. */
function markClashes(items) {
  const box = (i) => ({ x1: i.x - i.w / 2, x2: i.x + i.w / 2, y1: i.y - i.h / 2, y2: i.y + i.h / 2 });
  const hits = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  const solid = items.filter((i) => i.kind !== "power");
  return items.map((it) => {
    if (it.kind === "power") return it;
    const b = box(it);
    return solid.some((o) => o.key !== it.key && hits(b, box(o))) ? { ...it, clash: true } : it;
  });
}

function positionCode(x, y, W, D) {
  if (y > D + 0.1) return "FLOOR";
  if (x < -0.1 || x > W + 0.1) return "OFF-STAGE";
  const dep = clamp(y, 0, D) / D;
  const band = dep < 0.36 ? "US" : dep < 0.68 ? "MS" : "DS";
  const lr = clamp(x, 0, W) / W;
  return band + (lr < 0.34 ? "R" : lr < 0.66 ? "C" : "L");
}

/* ── input list ─────────────────────────────────────────────────── */

function buildInputs(cfg) {
  const rows = [];
  const push = (name, source, warn) => rows.push({ ch: rows.length + 1, name, source, warn });
  const drummer = cfg.members.find((m) => m.role === "drums");
  if (drummer) {
    const sel = kitChannels(drummer);
    KIT_CHANNELS.filter((c) => sel.includes(c.id)).forEach((c) => push(c.label, c.mic));
  }

  cfg.members.filter((m) => ROLES[m.role].backline === "instrument").forEach((m) => {
    const src = SOURCES[m.source] || SOURCES.amp;
    const lbl = m.role === "bass" ? "bass" : ROLES[m.role].label.toLowerCase();
    if (src.stereo) {
      push(`${m.name} — ${lbl} L`, "DI");
      push(`${m.name} — ${lbl} R`, "DI");
      return;
    }
    if (src.mic) { push(`${m.name} — ${lbl}`, "Condenser"); return; }
    if (src.cab && !src.silent) push(`${m.name} — ${lbl} cab`, m.role === "bass" ? "Dynamic" : "SM57");
    if (src.di) push(`${m.name} — ${lbl} DI`, src.silent ? "DI out of amp head" : "Active DI");
  });

  cfg.members.filter((m) => m.role === "keys").forEach((m) => {
    push(`${m.name} — keys L`, "Stereo DI"); push(`${m.name} — keys R`, "Stereo DI");
  });

  cfg.members.filter((m) => m.role === "dj").forEach((m) => {
    push(`${m.name} — DJ L`, "Stereo DI"); push(`${m.name} — DJ R`, "Stereo DI");
  });

  if (cfg.tracks) { push("Tracks L", "Stereo DI"); push("Tracks R", "Stereo DI"); }

  cfg.members.filter((m) => m.sings).sort((a, b) => Number(b.lead) - Number(a.lead))
    .forEach((m) => push(`${m.name} — ${m.lead ? "lead" : "backing"} vocal`, m.role === "drums" ? "Beta 58 / boom" : "SM58"));

  const voiced = cfg.gear.filter((g) => GEAR[g.type] && GEAR[g.type].ch);
  voiced.forEach((g) => {
    const spec = GEAR[g.type];
    const same = voiced.filter((x) => x.type === g.type);
    const n = same.length > 1 ? ` ${same.indexOf(g) + 1}` : "";
    push(`${spec.ch.name}${n}`, spec.ch.source, spec.ch.warn);
  });

  return rows;
}

/* ── svg pieces ─────────────────────────────────────────────────── */

/* SVG <text> doesn't wrap on its own -- split into at most two short
   lines (a third would just crowd the neighbour it's already clashing
   with), ellipsizing the second if it's still too long. */
function wrapLabel(label, maxChars = 11) {
  const words = String(label).split(" ");
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  });
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    const second = lines[1].length > maxChars - 1 ? `${lines[1].slice(0, maxChars - 1)}…` : lines[1];
    return [lines[0], second];
  }
  return lines;
}

function Caption({ item, dy = 0 }) {
  const half = (item.h * S) / 2;
  // Wrap only once a label's already been flagged as clashing (labelAbove)
  // -- keeps the common case tight and single-line, and a wrapped label
  // takes less lateral space, which is exactly what helps it stop
  // clashing with a neighbour in turn.
  const lines = item.labelAbove ? wrapLabel(item.label) : null;
  const wrapped = lines && lines.length > 1 ? lines : null;
  const lineGap = 13;
  const labelH = wrapped ? (wrapped.length - 1) * lineGap : 0;
  const y = item.labelAbove ? -half - (item.sub ? 22 : 10) - dy - labelH : half + 13 + dy;
  return (
    <>
      {wrapped ? (
        <text textAnchor="middle" className="sp-lbl" fill={C.ink}>
          {wrapped.map((ln, i) => <tspan key={i} x={0} y={y + i * lineGap}>{ln}</tspan>)}
        </text>
      ) : (
        <text y={y} textAnchor="middle" className="sp-lbl" fill={C.ink}>{item.label}</text>
      )}
      {item.sub && <text y={y + labelH + 12} textAnchor="middle" className="sp-sub" fill={C.ink70}>{item.sub}</text>}
    </>
  );
}

/* Right-handed kit seen from above, audience at the bottom.
   Facing the audience, the drummer's left (hats, snare side) reads
   screen-right, floor tom and ride read screen-left. */
function Kit({ item, riser, lefty }) {
  const w = item.w * S, h = item.h * S;
  const f = lefty ? -1 : 1;
  const P = (x, y) => [f * x * w, y * h];
  const drum = { fill: "#FFF", stroke: C.ink, strokeWidth: 2 };
  const cym = { fill: "#E9EDF1", stroke: C.ink40, strokeWidth: 1.5, strokeDasharray: "3.5 3" };
  const tag = { className: "sp-tag", fill: C.ink70, textAnchor: "middle" };

  /* y is positive downstage, so the throne sits at the top of the
     footprint and the kick points out at the audience. */
  const parts = [
    { p: P(0.00, -0.34), r: 15, s: { fill: "none", stroke: C.ink40, strokeWidth: 2 }, t: "" },     // throne
    { p: P(0.09, -0.10), r: 17, s: drum, t: "Sn" },                                                // snare, drummer's left
    { p: P(0.28, -0.15), r: 15, s: cym, t: "HH" },                                                 // hi-hat
    { p: P(0.00, 0.20), r: 31, s: { ...drum, strokeWidth: 2.6 }, t: "K" },                         // kick
    { p: P(-0.12, 0.06), r: 15, s: drum, t: "RT" },                                                // rack tom
    { p: P(-0.30, -0.06), r: 21, s: drum, t: "FT" },                                                // floor tom
    { p: P(-0.34, 0.22), r: 22, s: cym, t: "Ride" },                                                // ride
    { p: P(0.31, 0.19), r: 20, s: cym, t: "Cr" },                                                  // crash over hats
    { p: P(-0.07, 0.35), r: 18, s: cym, t: "Cr" },                                                  // crash over rack tom
  ];

  return (
    <g>
      {riser ? (
        <rect x={-w / 2 - 12} y={-h / 2 - 12} width={w + 24} height={h + 24} rx={3}
          fill={C.riser} stroke={C.ink} strokeWidth={4} />
      ) : (
        <rect x={-w / 2 - 10} y={-h / 2 - 10} width={w + 20} height={h + 20} rx={3}
          fill="#FBFCFD" stroke={C.ink40} strokeWidth={1.8} strokeDasharray="7 5" />
      )}
      {parts.map((pt, i) => (
        <g key={i} transform={`translate(${pt.p[0]},${pt.p[1]})`}>
          <circle r={pt.r} {...pt.s} />
          {pt.t && <text y={3.5} {...tag}>{pt.t}</text>}
        </g>
      ))}
      <text y={-h / 2 - (riser ? 22 : 20)} textAnchor="middle" className="sp-lbl" fill={C.ink}>{item.label}</text>
      <text y={h / 2 + 26} textAnchor="middle" className="sp-sub" fill={C.ink70}>
        {riser ? "Drums on riser" : "Drums"}{lefty ? " (left-handed)" : ""}
      </text>
    </g>
  );
}

function Cab({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill="#FFF" stroke={C.amp} strokeWidth={3} strokeDasharray="8 5" />
      <Caption item={item} />
    </g>
  );
}

function KeysRig({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill="#FFF" stroke={ROLES.keys.tint} strokeWidth={3} />
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <line key={i} x1={-w / 2 + (w / 7) * i} y1={-h / 2} x2={-w / 2 + (w / 7) * i} y2={h / 2}
          stroke={ROLES.keys.tint} strokeWidth={1} opacity={0.4} />
      ))}
      <Caption item={item} />
    </g>
  );
}

function DjBooth({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={5} fill="#FFF" stroke={C.dj} strokeWidth={2.5} />
      <rect x={-w * 0.16} y={-h * 0.3} width={w * 0.32} height={h * 0.42} rx={2} fill="#FFF" stroke={C.dj} strokeWidth={1.6} />
      <circle cx={-w * 0.28} cy={h * 0.04} r={h * 0.2} fill="none" stroke={C.dj} strokeWidth={1.8} />
      <circle cx={w * 0.28} cy={h * 0.04} r={h * 0.2} fill="none" stroke={C.dj} strokeWidth={1.8} />
      <text y={h / 2 - 5} textAnchor="middle" className="sp-tag" fill={C.dj}>STEREO DI</text>
      <Caption item={item} />
    </g>
  );
}

function DIBox({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} fill="#FFF" stroke={C.ink} strokeWidth={2.5} />
      <text y={4} textAnchor="middle" className="sp-mono" fill={C.ink}>DI</text>
      <Caption item={item} />
    </g>
  );
}

/* Same simple rectangle footprint as DIBox, above -- just filled in the
   lighting tint so it reads as a fixture rather than an audio box. */
function PanelLight({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} fill={C.light} />
      <text y={4} textAnchor="middle" className="sp-mono" fill="#FFF">LED</text>
      <Caption item={item} />
    </g>
  );
}

function MicStand({ item, tint, tagFill, tag }) {
  return (
    <g>
      <circle r={17} fill={tint || C.mic} />
      <circle r={17} fill="none" stroke="#FFF" strokeWidth={2} />
      {tag && <text y={4} textAnchor="middle" className="sp-tag" fill={tagFill || "#FFF"}>{tag}</text>}
      <Caption item={item} dy={12} />
    </g>
  );
}

function Wedge({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g transform={`rotate(${item.rot || 0})`}>
      <polygon points={`${-w / 2},${h / 2} ${w / 2},${h / 2} ${w / 2 - 12},${-h / 2} ${-w / 2 + 12},${-h / 2}`}
        fill={C.wedge} stroke="#B9741A" strokeWidth={2} />
      <text y={5} textAnchor="middle" className="sp-mono" fill="#4A2C05" transform={`rotate(${-(item.rot || 0)})`}>WEDGE</text>
    </g>
  );
}

function IemPack({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={5} fill={C.iem} />
      <text y={4} textAnchor="middle" className="sp-mono" fill="#FFF">IEM</text>
      <Caption item={item} />
    </g>
  );
}

function PowerDrop({ selected }) {
  return (
    <g>
      <circle r={13} fill="#FFF" stroke={C.power} strokeWidth={selected ? 3 : 2} />
      <path d="M2,-8 L-4,1 L0,1 L-2,8 L4,-1 L0,-1 Z" fill={C.power} />
    </g>
  );
}

function Speaker({ item, sub }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill={sub ? C.pa : "#FFF"} stroke={C.pa} strokeWidth={2.5} />
      <circle r={Math.min(w, h) * 0.28} fill="none" stroke={sub ? "#FFF" : C.pa} strokeWidth={2} />
      {!sub && <path d={`M${-w * 0.22},${h / 2 + 6} L0,${h / 2 + 16} L${w * 0.22},${h / 2 + 6}`} fill="none" stroke={C.pa} strokeWidth={2} />}
      <Caption item={item} dy={sub ? 0 : 10} />
    </g>
  );
}

function Desk({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill="#FFF" stroke={C.pa} strokeWidth={2.5} />
      {[0.2, 0.35, 0.5, 0.65, 0.8].map((t, i) => (
        <line key={i} x1={-w / 2 + w * t} y1={-h * 0.12} x2={-w / 2 + w * t} y2={h * 0.34} stroke={C.pa} strokeWidth={1.6} />
      ))}
      {[0.25, 0.45, 0.65].map((t, i) => (
        <circle key={i} cx={-w / 2 + w * t} cy={-h * 0.3} r={3} fill={C.pa} />
      ))}
      <Caption item={item} />
    </g>
  );
}

function LightBar({ item }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3} fill={C.light} />
      {[0.14, 0.32, 0.5, 0.68, 0.86].map((t, i) => (
        <circle key={i} cx={-w / 2 + w * t} cy={0} r={h * 0.28} fill="#FFF" opacity={0.85} />
      ))}
      <Caption item={item} />
    </g>
  );
}

function LightPod({ item, mover }) {
  const r = (Math.min(item.w, item.h) * S) / 2;
  return (
    <g>
      <path d={`M${-r * 1.5},${-r * 2.6} L${r * 1.5},${-r * 2.6} L0,0 Z`} fill={C.light} opacity={0.16} />
      <circle r={r} fill={mover ? "#FFF" : C.light} stroke={C.light} strokeWidth={2.5} />
      {mover && <circle r={r * 0.42} fill={C.light} />}
      <Caption item={item} />
    </g>
  );
}

function Box({ item, tint }) {
  const w = item.w * S, h = item.h * S;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={5} fill="#FFF" stroke={tint || C.ink70} strokeWidth={2} strokeDasharray="5 4" />
      <Caption item={item} />
    </g>
  );
}

function Piece({ item, cfg, selected }) {
  switch (item.kind) {
    case "kit": return <Kit item={item} riser={cfg.riser} lefty={cfg.lefty} />;
    case "amp": return <Cab item={item} />;
    case "keys": return <KeysRig item={item} />;
    case "dj": return <DjBooth item={item} />;
    case "di": return <DIBox item={item} />;
    case "mic": return <MicStand item={item} />;
    case "instMic": return <MicStand item={item} tint={item.tint} tag={item.tag} />;
    case "wedge": return <Wedge item={item} />;
    case "iem": return <IemPack item={item} />;
    case "power": return <PowerDrop selected={selected} />;
    case "paTop": return <Speaker item={item} />;
    case "paSub": return <Speaker item={item} sub />;
    case "fohDesk": case "monDesk": return <Desk item={item} />;
    case "lightBar": return <LightBar item={item} />;
    case "uplight": return <LightPod item={item} />;
    case "mover": return <LightPod item={item} mover />;
    case "panelLight": return <PanelLight item={item} />;
    case "riserBlk": return <Box item={item} tint={C.ink40} />;
    case "micStand": return <MicStand item={item} />;
    case "talkback": return <MicStand item={item} tint={C.wedge} tagFill="#4A2C05" tag="TB" />;
    default: return <Box item={item} />;
  }
}

/* ── hooks ──────────────────────────────────────────────────────── */

function useNarrow(bp = 1040) {
  const [narrow, setNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${bp - 1}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, [bp]);
  return narrow;
}

/* For the full-screen mode's "rotate for a better view" hint. */
function useIsPortrait() {
  const [portrait, setPortrait] = useState(typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false);
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    on();
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return portrait;
}

/* ── main ───────────────────────────────────────────────────────── */

/**
 * Props (all optional — omit everything and it behaves exactly as the
 * standalone tool does):
 *
 *   initialConfig   A config object (see defaultConfig() for the shape).
 *                   Typically produced by buildStagePlotSeed() in
 *                   stagePlotAdapter.js from your gig + lineup + venue rows.
 *
 *   onSave(config)  Called when the user presses "Save to gig". Receives
 *                   the full config object — persist it as jsonb on the
 *                   gig row, e.g. via savePlotForGig() in
 *                   supabasePersistence.js. May be async.
 *
 *   onConfigChange(config)   Fired ~800ms after the last edit, for
 *                   autosave. Optional — most integrations only need onSave.
 *
 *   saveLabel       Button text for the onSave action. Defaults to
 *                   "Save to gig".
 *
 *   readOnly        Hides every editing control and export/import sheet,
 *                   for a client-facing or read-only day-sheet view.
 */
export default function StagePlot({ initialConfig, onSave, onConfigChange, saveLabel, readOnly }) {
  const [cfg, setCfg] = useState(() => (initialConfig ? mergeIntoDefaults(initialConfig) : defaultConfig()));
  const [saving, setSaving] = useState(false);
  const changeTimer = useRef(null);

  // A fresh gig loading in should replace the plot, but the effect must
  // not fire on the identical object every re-render — compare by the
  // gig id the caller stamped on it, falling back to a content check.
  const lastSeed = useRef(initialConfig);
  useEffect(() => {
    if (initialConfig && initialConfig !== lastSeed.current) {
      lastSeed.current = initialConfig;
      setCfg(mergeIntoDefaults(initialConfig));
    }
  }, [initialConfig]);

  // onConfigChange is the same async save() that can reject -- calling it
  // bare inside a setTimeout left a rejection completely unhandled and
  // invisible, which is almost certainly the real explanation for
  // "worked on the solo gig, silently failed on the 7-piece": a jsonb
  // column has no meaningful size ceiling for a config this size (a few
  // KB either way), so this was never a size limit, just this exact
  // silent-failure path hit on a transient blip. One quiet retry covers
  // that; only flash if the retry also fails.
  const autosave = useCallback((config) => {
    if (!onConfigChange) return;
    Promise.resolve(onConfigChange(config)).catch(() => {
      window.setTimeout(() => {
        Promise.resolve(onConfigChange(config)).catch((err) => {
          console.error("Stage plot autosave failed", err);
          flash("Autosave failed — check your connection, then press Save to gig");
        });
      }, 4000);
    });
  }, [onConfigChange]);

  useEffect(() => {
    if (!onConfigChange) return;
    window.clearTimeout(changeTimer.current);
    changeTimer.current = window.setTimeout(() => { changeTimer.current = null; autosave(cfg); }, 800);
    return () => window.clearTimeout(changeTimer.current);
  }, [cfg, onConfigChange, autosave]);

  // Mobile browsers can suspend timers indefinitely once a tab is
  // backgrounded -- flush a pending autosave immediately on the way out
  // rather than let it race being switched away from, which is how an
  // edit (a delete, mid-debounce) was silently getting lost and then
  // reappearing on return.
  useEffect(() => {
    if (!onConfigChange) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden" && changeTimer.current) {
        window.clearTimeout(changeTimer.current);
        changeTimer.current = null;
        autosave(cfg);
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [cfg, onConfigChange, autosave]);

  const saveToGig = async () => {
    if (!onSave) return;
    setSaving(true);
    try { await onSave(cfg); flash("Saved to gig"); }
    catch (err) { flash("Couldn't save — check your connection"); }
    setSaving(false);
  };

  const [selected, setSelected] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [snap, setSnap] = useState(true);
  const [tab, setTab] = useState("plot");
  const [toast, setToast] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState("export");
  const [png, setPng] = useState("");
  const [importLen, setImportLen] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [zoomCenter, setZoomCenter] = useState(null);
  const importRef = useRef(null);
  const fileRef = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const panTargetRef = useRef(null);
  const panRafRef = useRef(null);
  const narrow = useNarrow();
  const portrait = useIsPortrait();

  const { w: W, d: D } = stageSize(cfg);
  const items = useMemo(() => buildItems(cfg), [cfg]);
  const inputs = useMemo(() => buildInputs(cfg), [cfg]);
  const selItem = items.find((i) => i.key === selected);
  // Paint order only, driven by cfg.zOrder (see bringToFront) -- SVG
  // paints in document order, so a higher rank simply gets drawn later.
  const orderedItems = useMemo(() => {
    const zOrder = cfg.zOrder || {};
    return items
      .map((it, i) => ({ it, z: zOrder[it.key] ?? i }))
      .sort((a, b) => a.z - b.z)
      .map((x) => x.it);
  }, [items, cfg.zOrder]);
  const wedges = cfg.members.filter((m) => m.monitor === "wedge").length;
  const iems = cfg.members.filter((m) => m.monitor === "iem").length;
  const drops = items.filter((i) => i.kind === "power").length;

  /* The sheet is cropped to the stage plus whatever sits around it, so
     an empty floor costs nothing. */
  const bounds = useMemo(() => {
    const m = { l: 0.45, r: 0.45, u: 0.5, d: 0.6 };
    let x0 = -m.l, y0 = -m.u, x1 = W + m.r, y1 = D + m.d;
    items.forEach((it) => {
      x0 = Math.min(x0, it.x - it.w / 2 - 0.55);
      x1 = Math.max(x1, it.x + it.w / 2 + 0.55);
      y0 = Math.min(y0, it.y - it.h / 2 - 0.45);
      y1 = Math.max(y1, it.y + it.h / 2 + 0.5);
    });
    return { x0, y0, x1, y1 };
  }, [items, W, D]);

  /* Hold the frame steady mid-drag so the plot never shrinks away
     under your finger; it may only grow to keep the item in shot. */
  const [held, setHeld] = useState(bounds);
  useEffect(() => {
    if (dragKey) return;
    setHeld((h) => (h.x0 === bounds.x0 && h.y0 === bounds.y0 && h.x1 === bounds.x1 && h.y1 === bounds.y1 ? h : bounds));
  }, [dragKey, bounds]);

  const cancelPan = useCallback(() => {
    if (panRafRef.current) { window.clearTimeout(panRafRef.current); panRafRef.current = null; }
    panTargetRef.current = null;
  }, []);

  useEffect(() => cancelPan, [cancelPan]);

  // Deliberate and reversible, not automatic-on-every-select (which would
  // be disorienting mid-drag) -- a dedicated toggle in the selection bar.
  // Turning it off (or losing the selection) drops the pan state too, so
  // the next zoom starts fresh from wherever the screen happens to be.
  useEffect(() => {
    if (!selected) { setZoomed(false); setZoomCenter(null); cancelPan(); }
  }, [selected, cancelPan]);

  // How far the zoomed crop reaches from its centre, in metres -- ~1.7x
  // magnification relative to the whole stage, moderate rather than an
  // extreme macro jump.
  const ZOOM_HALF = Math.max(W, D) / 3.4;
  // The inner fraction of the crop an item can move around in freely,
  // with zero panning -- only the outer band past this counts as "the
  // edge". Kept generous so a plain drag inside the frame never nudges
  // the view at all.
  const SAFE_FRACTION = 0.82;

  // Given a candidate crop centre and a point that should sit within it,
  // returns the minimal centre that keeps the point inside the safe
  // zone -- null if it already is. Shared by the toggle (so the crop the
  // selected item started in already has room to drag in) and the
  // in-drag follow (so the view only nudges by the overshoot, never
  // chases the item's exact position -- chasing it 1:1 is what made the
  // item look frozen while the floor scrolled under it).
  const nudgeForPoint = (center, x, y) => {
    const safeHalf = ZOOM_HALF * SAFE_FRACTION;
    const dx = x - center.x, dy = y - center.y;
    let tx = center.x, ty = center.y, needed = false;
    if (Math.abs(dx) > safeHalf) { tx = x - Math.sign(dx) * safeHalf; needed = true; }
    if (Math.abs(dy) > safeHalf) { ty = y - Math.sign(dy) * safeHalf; needed = true; }
    return needed ? { x: tx, y: ty } : null;
  };

  const toggleZoom = () => {
    setZoomed((z) => {
      const next = !z;
      if (next) {
        // Anchored to whatever's already on screen, not the selected
        // item -- zooming should magnify in place, never jump the view
        // to recentre on something. The one exception: if the selected
        // item itself starts outside the safe zone of that stage-centred
        // crop (common for anyone standing toward a side of the stage),
        // nudge just enough that dragging it has real room to move
        // before the view starts following -- otherwise it'd start
        // panning on the very first pixel of any drag.
        const stageCenter = { x: (bounds.x0 + bounds.x1) / 2, y: (bounds.y0 + bounds.y1) / 2 };
        const nudge = selItem ? nudgeForPoint(stageCenter, selItem.x, selItem.y) : null;
        setZoomCenter(nudge || stageCenter);
      } else {
        setZoomCenter(null);
        cancelPan();
      }
      return next;
    });
  };

  // While zoomed and dragging, ease the crop toward the item only once
  // it's actually nearing the edge of what's currently visible -- not
  // continuously, so the view stays still for small movements in the
  // middle of the frame.
  const panToward = useCallback((x, y) => {
    panTargetRef.current = { x, y };
    if (panRafRef.current) return; // a loop is already running toward the (now updated) target
    // A plain timer, not requestAnimationFrame -- rAF is throttled to
    // never fire at all in some contexts (backgrounded/non-focused tabs,
    // some embedded/automated browser frames), which would silently kill
    // this animation outright rather than just running less smoothly.
    // ~60fps cadence, imperceptibly different from rAF for a step this
    // short, and reliable everywhere.
    const step = () => {
      const t = panTargetRef.current;
      if (!t) { panRafRef.current = null; return; }
      setZoomCenter((c) => {
        if (!c) return c;
        const nx = c.x + (t.x - c.x) * 0.1;
        const ny = c.y + (t.y - c.y) * 0.1;
        if (Math.abs(nx - t.x) < 0.03 && Math.abs(ny - t.y) < 0.03) {
          panRafRef.current = null;
          return { x: t.x, y: t.y };
        }
        panRafRef.current = window.setTimeout(step, 16);
        return { x: nx, y: ny };
      });
    };
    panRafRef.current = window.setTimeout(step, 16);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const view = zoomed && zoomCenter
    ? { x0: zoomCenter.x - ZOOM_HALF, y0: zoomCenter.y - ZOOM_HALF, x1: zoomCenter.x + ZOOM_HALF, y1: zoomCenter.y + ZOOM_HALF }
    : dragKey
    ? {
        x0: Math.min(held.x0, bounds.x0), y0: Math.min(held.y0, bounds.y0),
        x1: Math.max(held.x1, bounds.x1), y1: Math.max(held.y1, bounds.y1),
      }
    : bounds;

  /* Safari ignores touch-action on SVG children, so block the scroll
     outright for the duration of a drag. */
  useEffect(() => {
    if (!dragKey) return;
    const stop = (e) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    return () => document.removeEventListener("touchmove", stop);
  }, [dragKey]);

  /* dragKey normally clears in onUp, bound to the specific dragged <g> via
     pointer capture -- but if that node vanishes from the DOM mid-drag
     (the item got deleted, or a narrow-mode tab switch unmounted the
     whole sheet) the browser drops capture silently and never fires
     pointerup/pointercancel on a node that's gone. onUp then never runs,
     dragKey never clears, and the touchmove block above is permanent
     until the page is torn down -- this is the "screen locked, had to
     restart the app" bug. Three independent nets so no single miss can
     wedge it again: */

  // 1. A window-level listener that clears drag state on ANY release,
  //    regardless of which element the event actually landed on.
  useEffect(() => {
    if (!dragKey) return;
    const clear = () => { drag.current = null; setDragKey(null); };
    window.addEventListener("pointerup", clear, true);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("lostpointercapture", clear, true);
    return () => {
      window.removeEventListener("pointerup", clear, true);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("lostpointercapture", clear, true);
    };
  }, [dragKey]);

  // 2. If the dragged/selected key no longer exists in the current
  //    layout (deleted mid-interaction), drop the stale reference
  //    immediately rather than wait on a release event that may never come.
  useEffect(() => {
    if (dragKey && !items.some((i) => i.key === dragKey)) {
      drag.current = null;
      setDragKey(null);
    }
    if (selected && !items.some((i) => i.key === selected)) {
      setSelected(null);
    }
  }, [items, dragKey, selected]);

  // 3. Nobody's finger is still on the glass once the app is
  //    backgrounded -- force-clear any in-progress drag the moment the
  //    tab is hidden, rather than let a rotation or app-switch leave the
  //    block permanently armed.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && drag.current) {
        drag.current = null;
        setDragKey(null);
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);

  const flash = useCallback((msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const patch = (p) => setCfg((c) => ({ ...c, ...p }));
  const patchMember = (id, p) => setCfg((c) => ({ ...c, members: c.members.map((m) => (m.id === id ? { ...m, ...p } : m)) }));

  const setStage = (k) => patch({ stage: k, riser: STAGES[k] ? STAGES[k].riser : cfg.riser });

  const addMember = () => setCfg((c) => ({
    ...c,
    members: [...c.members, {
      id: uid(), name: `Member ${c.members.length + 1}`, role: "guitar",
      sings: false, lead: false, guest: false, source: "amp", monitor: "iem", kit: "standard",
    }],
  }));

  const removeMember = (id) => {
    // Belt-and-braces alongside the reconciliation effect above: clear
    // immediately rather than wait a render cycle for a delete that hits
    // the currently selected/dragged item.
    if (selected && selected.includes(id)) setSelected(null);
    if (dragKey && dragKey.includes(id)) { drag.current = null; setDragKey(null); }
    setCfg((c) => {
      const overrides = { ...c.overrides };
      Object.keys(overrides).forEach((k) => k.includes(id) && delete overrides[k]);
      return { ...c, members: c.members.filter((m) => m.id !== id), overrides };
    });
  };

  const addGear = (type) => setCfg((c) => {
    const used = c.gear.filter((g) => g.type === type).map((g) => g.n || 0);
    let n = 0;
    while (used.includes(n)) n++;
    return { ...c, gear: [...c.gear, { id: uid("g"), type, n }] };
  });

  const removeGear = (gearId) => {
    if (selected && selected.includes(gearId)) setSelected(null);
    if (dragKey && dragKey.includes(gearId)) { drag.current = null; setDragKey(null); }
    setCfg((c) => {
      const overrides = { ...c.overrides };
      Object.keys(overrides).forEach((k) => k.includes(gearId) && delete overrides[k]);
      return { ...c, gear: c.gear.filter((g) => g.id !== gearId), overrides };
    });
  };

  const addPowerDrop = () => setCfg((c) => ({
    ...c,
    power: { ...c.power, on: true, extra: [...c.power.extra, { id: uid("p"), x: W / 2, y: D / 2 }] },
  }));

  const hidePower = (key) => {
    if (selected === key) setSelected(null);
    if (dragKey === key) { drag.current = null; setDragKey(null); }
    setCfg((c) => ({
      ...c,
      power: key.startsWith("pwr.extra.")
        ? { ...c.power, extra: c.power.extra.filter((p) => !key.endsWith(p.id)) }
        : { ...c.power, hidden: [...c.power.hidden, key] },
    }));
  };

  const restorePower = () => setCfg((c) => ({ ...c, power: { ...c.power, hidden: [] } }));

  /* drag */
  const toMetres = (evt) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: (p.x - PAD) / S + view.x0, y: (p.y - PAD) / S + view.y0 };
  };

  const onDown = (item) => (e) => {
    if (readOnly || item.passive) return;
    e.preventDefault(); e.stopPropagation();
    const p = toMetres(e);
    if (!p) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    // Just a select for now -- dragKey (which arms the document-wide
    // touch block below) only gets set once onMove sees real movement.
    // A plain tap-to-select used to arm that block immediately, which is
    // most of why "the screen locks as soon as you select something" and
    // "locks on a quick select/unselect" were happening.
    drag.current = { key: item.key, id: e.pointerId, ox: p.x - item.x, oy: p.y - item.y, startX: e.clientX, startY: e.clientY, moved: false };
    setSelected(item.key);
  };

  const onMove = (item) => (e) => {
    const d = drag.current;
    if (!d || d.key !== item.key || d.id !== e.pointerId) return;
    e.preventDefault();
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      d.moved = true;
      setDragKey(item.key);
    }
    const p = toMetres(e);
    if (!p) return;
    const g = snap ? 0.1 : 0.01;
    const nx = clamp(Math.round((p.x - d.ox) / g) * g, -LIMIT.l, W + LIMIT.r);
    const ny = clamp(Math.round((p.y - d.oy) / g) * g, -LIMIT.u, D + LIMIT.d);
    // Only ease the zoomed crop toward the item once it's actually
    // nearing the visible edge, not on every move -- the screen stays
    // put for small adjustments in the middle of the frame. Critically,
    // the pan target is NOT the item's own position -- chasing that
    // exactly (and re-targeting it on every subsequent move while still
    // "over") made the view track the item almost 1:1, which visually
    // cancels out the item's on-screen movement: the item looks like
    // it's standing still while the floor scrolls under it. Instead,
    // nudge the crop by only the overshoot, just enough to pin the item
    // at the edge of the safe zone -- it keeps moving normally on screen
    // right up to that edge, and only the excess beyond it pans the view.
    if (zoomed && zoomCenter) {
      const target = nudgeForPoint(zoomCenter, nx, ny);
      if (target) panToward(target.x, target.y);
    }
    setCfg((c) => ({ ...c, overrides: { ...c.overrides, [item.key]: { x: nx, y: ny } } }));
  };

  const onUp = (item) => (e) => {
    if (!drag.current || drag.current.key !== item.key) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    drag.current = null;
    setDragKey(null);
  };

  // Only paint order, never position -- SVG paints in document order, so
  // "bring to front" bumps a persisted per-item rank used to sort what
  // actually gets rendered last (see orderedItems below). The max has to
  // be taken across every current item's EFFECTIVE rank (its zOrder entry,
  // or its plain array index for anything never explicitly ranked) --
  // starting fresh ranks at 0 sorted a newly-fronted item ahead of only
  // other explicitly-ranked items, not the (usually much larger) natural
  // index of the many un-ranked items like power drops, so it never
  // actually reached the front at all.
  const bringToFront = (key) => setCfg((c) => {
    const zOrder = c.zOrder || {};
    const maxZ = items.reduce((m, it, i) => Math.max(m, zOrder[it.key] ?? i), 0);
    return { ...c, zOrder: { ...zOrder, [key]: maxZ + 1 } };
  });

  const resetOne = (key) => setCfg((c) => {
    const overrides = { ...c.overrides };
    delete overrides[key];
    return { ...c, overrides };
  });

  /* export */
  const serialize = () => {
    const svg = svgRef.current.cloneNode(true);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", String(vbW));   // Safari won't rasterise without these
    svg.setAttribute("height", String(vbH));
    svg.querySelectorAll(".sp-sel, .sp-clash").forEach((n) => n.remove());
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `.sp-lbl{font:600 14px 'Space Grotesk',Inter,sans-serif}
      .sp-sub{font:400 11px Inter,sans-serif}.sp-tag{font:600 9px 'IBM Plex Mono',monospace}
      .sp-mono{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.06em}
      .sp-dim{font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.08em}`;
    svg.insertBefore(style, svg.firstChild);
    return new XMLSerializer().serializeToString(svg);
  };

  const fileBase = () => `${cfg.band || "stage"}-plot${cfg.venue ? "-" + cfg.venue : ""}`.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();

  const renderPNG = () =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const k = 2;
          const cv = document.createElement("canvas");
          cv.width = Math.round(vbW * k);
          cv.height = Math.round(vbH * k);
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL("image/png"));
        } catch (err) { reject(err); }
      };
      img.onerror = () => reject(new Error("rasterise failed"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialize());
    });

  /* Downloads are blocked inside sandboxed frames, so try the anchor
     and fall back to the save sheet, where the image can be long-pressed. */
  const tryDownload = (href, filename, revoke) => {
    try {
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 4000);
      return true;
    } catch (err) { return false; }
  };

  const downloadSVG = () => {
    const blob = new Blob([serialize()], { type: "image/svg+xml;charset=utf-8" });
    tryDownload(URL.createObjectURL(blob), `${fileBase()}.svg`, true);
    flash("If nothing saved, copy the SVG below");
  };

  const downloadPNG = async () => {
    try {
      const url = png || (await renderPNG());
      if (!png) setPng(url);
      tryDownload(url, `${fileBase()}.png`);
      flash("If nothing saved, long-press the image");
    } catch (err) { flash("Couldn't render the PNG"); }
  };

  const openSaveSheet = async () => {
    setSheetOpen(true);
    // The <svg ref={svgRef}> only exists in the DOM while tab==="plot" --
    // on a narrow screen "Export & import" lives on the Set up tab, so
    // opening straight from there left svgRef.current null and renderPNG
    // threw before ever showing anything. Force the plot tab open first
    // and wait a paint (double rAF: the first fires before this frame's
    // render commits, the second only after it's actually painted) so the
    // SVG is guaranteed mounted by the time we read the ref.
    setTab("plot");
    setPng("");
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      setPng(await renderPNG());
    }
    catch (err) { flash("Couldn't render the image — the SVG still works"); }
  };

  /* A pretty-printed config is mostly whitespace, and long strings are
     exactly what gets clipped in transit — so export it compact. */
  const compactConfig = () => {
    const r = (n) => Math.round(n * 100) / 100;
    const ov = {};
    Object.entries(cfg.overrides || {}).forEach(([k, v]) => { ov[k] = { x: r(v.x), y: r(v.y) }; });
    return JSON.stringify({ ...cfg, overrides: ov });
  };

  const loadFromText = (raw) => {
    const text = (raw || "").trim();
    if (!text) { flash("Nothing to load"); return; }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const open = (text.match(/[{[]/g) || []).length;
      const close = (text.match(/[}\]]/g) || []).length;
      flash(open > close
        ? `Cut off — ${text.length} characters, ${open - close} bracket(s) never closed`
        : `Not valid JSON (${text.length} characters)`);
      return;
    }
    if (!parsed || !Array.isArray(parsed.members)) { flash("No line-up in that config"); return; }
    setCfg(mergeIntoDefaults(parsed));
    if (importRef.current) importRef.current.value = "";
    setImportLen(0);
    setSheetOpen(false);
    flash(`Loaded — ${parsed.members.length} on stage`);
  };

  const saveConfigFile = () => {
    const blob = new Blob([compactConfig()], { type: "application/json" });
    tryDownload(URL.createObjectURL(blob), `${fileBase()}.json`, true);
    flash("Saved as a .json file");
  };

  const onConfigFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => loadFromText(String(r.result));
    r.onerror = () => flash("Couldn't read that file");
    r.readAsText(f);
    e.target.value = "";
  };

  const pasteConfig = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) { flash("Clipboard was empty"); return; }
      if (importRef.current) importRef.current.value = t;
      setImportLen(t.length);
      flash(`${t.length} characters pasted`);
    } catch (err) {
      flash("Browser blocked clipboard access — paste into the box");
    }
  };

  const copyText = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); flash(msg); }
    catch (err) { flash("Copy blocked by the browser"); }
  };

  const inputListText = () => {
    const head = `${cfg.band} — input list${cfg.venue ? ` — ${cfg.venue}` : ""}${cfg.date ? ` — ${cfg.date}` : ""}`;
    const body = inputs.map((r) => `${String(r.ch).padStart(2, "0")}  ${r.name}  (${r.source})`).join("\n");
    const tail = `\n\nMonitoring: ${wedges} wedge mix${wedges === 1 ? "" : "es"}, ${iems} IEM mix${iems === 1 ? "" : "es"}\nPower: ${drops} × 13A drops`;
    const tb = inputs.some((r) => r.warn)
      ? "\n\nTalkback goes to the band's wedges and in-ears only — please keep it out of the mains."
      : "";
    return `${head}\n${"-".repeat(head.length)}\n${body}${tail}${tb}${cfg.notes ? `\n\nNotes: ${cfg.notes}` : ""}`;
  };

  // A generic, sensibly-roled line-up for a given band size -- for
  // starting a plot from scratch or reshaping one, separate from the
  // gig-rostered auto-seed most plots never need to touch. Replaces the
  // current line-up, so it's confirmed first if there's anyone on stage
  // already worth losing.
  const applyPreset = (size) => {
    const shape = BAND_PRESETS[size];
    if (!shape) return;
    if (cfg.members.length > 0 && !window.confirm(`Replace the current ${cfg.members.length}-person line-up with a fresh ${PRESET_LABELS[size]}?`)) return;
    setCfg((c) => ({
      ...c,
      members: shape.map((s) => ({
        id: uid(), name: s.name, role: s.role,
        sings: !!s.sings, lead: !!s.lead, guest: false,
        source: s.role === "horn" || s.role === "percussion" ? "mic" : "amp",
        monitor: "iem", kit: "standard",
      })),
      overrides: {},
    }));
    setSelected(null);
    flash(`Loaded a ${PRESET_LABELS[size]} line-up`);
  };

  const gearGroups = ["PA", "Lights", "Control", "Extras"];

  /* ── panel ── */
  const panel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      <Section title="Gig">
        <Field label="Band"><input style={inp} value={cfg.band} onChange={(e) => patch({ band: e.target.value })} /></Field>
        <Field label="Strapline"><input style={inp} value={cfg.strap} onChange={(e) => patch({ strap: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 8 }}>
          <Field label="Venue" grow><input style={inp} value={cfg.venue} placeholder="The Bootleg" onChange={(e) => patch({ venue: e.target.value })} /></Field>
          <Field label="Date" grow><input style={inp} type="date" value={cfg.date} onChange={(e) => patch({ date: e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="Stage">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {Object.entries(STAGES).map(([k, v]) => (
            <Chip key={k} on={cfg.stage === k} onClick={() => setStage(k)}>{v.label}</Chip>
          ))}
          <Chip on={cfg.stage === "custom"} onClick={() => patch({ stage: "custom", custom: { w: W, d: D } })}>Custom</Chip>
        </div>
        {cfg.stage === "custom" && (
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Width (m)" grow>
              <input style={inp} type="number" min="2" max="20" step="0.5" value={cfg.custom.w}
                onChange={(e) => patch({ custom: { ...cfg.custom, w: Number(e.target.value) || 2 } })} />
            </Field>
            <Field label="Depth (m)" grow>
              <input style={inp} type="number" min="2" max="14" step="0.5" value={cfg.custom.d}
                onChange={(e) => patch({ custom: { ...cfg.custom, d: Number(e.target.value) || 2 } })} />
            </Field>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 10 }}>
          <Toggle on={cfg.riser} onClick={() => patch({ riser: !cfg.riser })}>Drum riser</Toggle>
          <Toggle on={cfg.lefty} onClick={() => patch({ lefty: !cfg.lefty })}>Left-handed kit</Toggle>
          <Toggle on={cfg.tracks} onClick={() => patch({ tracks: !cfg.tracks })}>Backing tracks</Toggle>
          <Toggle on={snap} onClick={() => setSnap(!snap)}>Snap to 10 cm</Toggle>
        </div>
      </Section>

      <Section title="Line-up" right={<button style={btn(C.deckHi)} onClick={addMember}><Plus size={13} /> Add</button>}>
        <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
          <span style={tiny}>Everyone on</span>
          <Chip small onClick={() => setCfg((c) => ({ ...c, members: c.members.map((m) => ({ ...m, monitor: "wedge" })) }))}>Wedges</Chip>
          <Chip small onClick={() => setCfg((c) => ({ ...c, members: c.members.map((m) => ({ ...m, monitor: "iem" })) }))}>IEMs</Chip>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {cfg.members.map((m) => (
            <div key={m.id} style={{ border: `1px solid ${C.deckEdge}`, borderRadius: 8, overflow: "hidden", background: C.deckHi }}>
              <div style={{ height: 4, background: ROLES[m.role].tint }} />
              <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...inp, flex: 1, fontWeight: 600 }} value={m.name} onChange={(e) => patchMember(m.id, { name: e.target.value })} />
                  <button style={btn("#7A2B22")} onClick={() => removeMember(m.id)} aria-label={`Remove ${m.name}`}><Trash2 size={17} /></button>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <select style={{ ...inp, flex: 1 }} value={m.role} onChange={(e) => patchMember(m.id, { role: e.target.value })}>
                    {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <select style={{ ...inp, flex: 1 }} value={m.monitor} onChange={(e) => patchMember(m.id, { monitor: e.target.value })}>
                    <option value="wedge">Wedge</option>
                    <option value="iem">In-ears</option>
                    <option value="none">No monitor</option>
                  </select>
                </div>
                {ROLES[m.role].backline === "instrument" && (
                  <select style={inp} value={m.source} onChange={(e) => patchMember(m.id, { source: e.target.value })}>
                    {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                )}
                {m.role === "drums" && (
                  <KitPicker member={m} onChange={(ch) => patchMember(m.id, { kitCh: ch })} />
                )}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <Check2 on={m.sings} onClick={() => patchMember(m.id, { sings: !m.sings, lead: m.sings ? false : m.lead })}>Sings</Check2>
                  {m.sings && (
                    // Independent, not exclusive -- real bands do have
                    // co-leads, and StagePlot now centres every member
                    // flagged lead (spread across the front centre-line
                    // if there's more than one) rather than forcing a
                    // single winner.
                    <Check2 on={m.lead} onClick={() => patchMember(m.id, { lead: !m.lead })}>Lead</Check2>
                  )}
                  <Check2 on={m.guest} onClick={() => patchMember(m.id, { guest: !m.guest })}>Guest / dep</Check2>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Add to the plot">
        {gearGroups.map((grp) => (
          <div key={grp} style={{ marginBottom: 8 }}>
            <div style={{ ...tiny, marginBottom: 4 }}>{grp}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {Object.entries(GEAR).filter(([, v]) => v.group === grp).map(([k, v]) => (
                <Chip key={k} small onClick={() => addGear(k)}>+ {v.label}</Chip>
              ))}
            </div>
          </div>
        ))}
        {cfg.gear.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.deckEdge}` }}>
            {cfg.gear.map((g) => (
              <span key={g.id} style={{ ...chipBase, background: C.deckHi, display: "flex", gap: 6, alignItems: "center" }}>
                {(GEAR[g.type] || GEAR.custom).label}
                <button aria-label="Remove" style={{ ...btn("transparent"), padding: 0 }} onClick={() => removeGear(g.id)}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="Power" right={<button style={btn(C.deckHi)} onClick={addPowerDrop}><Plus size={13} /> Drop</button>}>
        <Toggle on={cfg.power.on} onClick={() => patch({ power: { ...cfg.power, on: !cfg.power.on } })}>Show 13A drops</Toggle>
        <p style={{ ...tiny, marginTop: 8, lineHeight: 1.5 }}>
          Seeded one per rig, per wedge, per speaker, per lighting fixture, per person and per stage corner — {drops} in total.
          Drag them where the sockets really are; tap one and hit the bin to drop it.
        </p>
        {cfg.power.hidden.length > 0 && (
          <button style={{ ...btn(C.deckHi), marginTop: 6 }} onClick={restorePower}>
            <RotateCcw size={12} /> Restore {cfg.power.hidden.length} removed
          </button>
        )}
      </Section>

      <Section title="Notes for the engineer">
        <textarea style={{ ...inp, minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
          value={cfg.notes} onChange={(e) => patch({ notes: e.target.value })} />
      </Section>

      <Section title="Band size">
        <p style={{ ...tiny, marginBottom: 8, lineHeight: 1.5 }}>
          Swap in a fresh generic line-up to start from, or reshape this one —
          replaces who's on stage, keeps the venue/notes/gear as they are.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {Object.keys(BAND_PRESETS).map((size) => (
            <Chip key={size} small onClick={() => applyPreset(Number(size))}>{PRESET_LABELS[size]}</Chip>
          ))}
        </div>
      </Section>

      <Section title="Hand off">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button style={btn(C.wedge)} onClick={openSaveSheet}>
            <ImageDown size={13} color="#2A1A02" /><span style={{ color: "#2A1A02" }}>Export &amp; import</span>
          </button>
          <button style={btn(C.deckHi)} onClick={() => window.print()}><Printer size={13} /> Print</button>
          <button style={btn(C.deckHi)} onClick={() => copyText(inputListText(), "Input list copied")}><Copy size={13} /> Input list</button>
        </div>
      </Section>
    </div>
  );

  const vbW = (view.x1 - view.x0) * S + PAD * 2;
  const vbH = (view.y1 - view.y0) * S + PAD * 2;

  /* ── sheet ── */
  const sheet = (
    <div className="sp-sheet" style={{ background: C.paper, border: `1px solid ${C.hair}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${C.hair}` }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 700, lineHeight: 1, textTransform: "uppercase", color: C.ink }}>
              {cfg.band || "Untitled band"}
            </div>
            <div style={{ fontSize: 13, color: C.ink70, marginTop: 4 }}>
              {cfg.strap}{cfg.venue ? ` · ${cfg.venue}` : ""}{cfg.date ? ` · ${cfg.date}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Stat k={`${cfg.members.length}`} v="on stage" />
            <Stat k={`${inputs.length}`} v="inputs" />
            <Stat k={`${wedges}`} v="wedge mixes" />
            <Stat k={`${iems}`} v="IEM mixes" />
            {cfg.power.on && <Stat k={`${drops}`} v="13A drops" />}
          </div>
        </div>
      </div>

      <div style={{ padding: 12 }}>
        <div style={{ touchAction: "none", overscrollBehavior: "contain" }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${vbW} ${vbH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height: "auto", display: "block", touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
            onPointerDown={() => setSelected(null)}
          >
            <defs>
              <pattern id="gaff" width={26} height={26} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={26} height={26} fill={C.tape} />
                <rect width={13} height={26} fill={C.ink} />
              </pattern>
              <pattern id="grid" width={S / 2} height={S / 2} patternUnits="userSpaceOnUse">
                <path d={`M ${S / 2} 0 L 0 0 0 ${S / 2}`} fill="none" stroke="#EDF0F3" strokeWidth={1} />
              </pattern>
            </defs>

            <rect width={vbW} height={vbH} fill={C.floor} />

            <g transform={`translate(${PAD - view.x0 * S},${PAD - view.y0 * S})`}>
              <rect width={W * S} height={D * S} fill={C.paper} />
              <rect width={W * S} height={D * S} fill="url(#grid)" />
              <rect width={W * S} height={D * S} fill="none" stroke={C.ink} strokeWidth={6} />
              <rect x={0} y={-1} width={W * S} height={7} fill={C.ink} />
              <rect x={0} y={D * S - 14} width={W * S} height={14} fill="url(#gaff)" opacity={0.9} />

              <text x={W * S / 2} y={-20} textAnchor="middle" className="sp-dim" fill={C.ink40}>{W.toFixed(1)} m WIDE</text>
              <text x={-20} y={D * S / 2} textAnchor="middle" className="sp-dim" fill={C.ink40}
                transform={`rotate(-90,${-20},${D * S / 2})`}>{D.toFixed(1)} m DEEP</text>
              <text x={10} y={26} className="sp-dim" fill={C.ink40}>UPSTAGE</text>
              <text x={W * S - 10} y={26} textAnchor="end" className="sp-dim" fill={C.ink40}>STAGE LEFT →</text>
              <text x={10} y={D * S - 26} className="sp-dim" fill={C.ink40}>← STAGE RIGHT</text>

              {orderedItems.map((item) => {
                const isSel = selected === item.key;
                // Enlarged, invisible hit target -- an item's true metric
                // footprint (a mic is ~40px) is under the ~44px touch
                // target guideline. fill="transparent" (not "none") is
                // what makes an SVG shape register pointer events at all.
                const hw = Math.max(item.w * S, 48) / 2;
                const hh = Math.max(item.h * S, 48) / 2;
                return (
                  <g key={item.key}
                    transform={`translate(${item.x * S},${item.y * S})`}
                    onPointerDown={onDown(item)}
                    onPointerMove={onMove(item)}
                    onPointerUp={onUp(item)}
                    onPointerCancel={onUp(item)}
                    style={{ cursor: dragKey === item.key ? "grabbing" : "grab", touchAction: "none" }}
                  >
                    {!item.passive && !readOnly && (
                      <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="transparent" />
                    )}
                    {item.clash && (
                      <rect className="sp-clash"
                        x={-(item.w * S) / 2 - 7} y={-(item.h * S) / 2 - 7}
                        width={item.w * S + 14} height={item.h * S + 14}
                        rx={6} fill="none" stroke={C.wedge} strokeWidth={2} strokeDasharray="3 3" />
                    )}
                    {isSel && (
                      <rect className="sp-sel"
                        x={-(item.w * S) / 2 - 14} y={-(item.h * S) / 2 - 14}
                        width={item.w * S + 28} height={item.h * S + 28}
                        rx={8} fill="none" stroke={C.iem} strokeWidth={2} strokeDasharray="5 4" />
                    )}
                    <Piece item={item} cfg={cfg} selected={isSel} />
                  </g>
                );
              })}
            </g>

            <text x={vbW / 2} y={vbH - 14} textAnchor="middle"
              style={{ font: "600 15px var(--font-display)", letterSpacing: "0.22em" }} fill={C.ink}>
              A U D I E N C E
            </text>
          </svg>
        </div>

        {/* Fixed-height, always rendered -- an empty state when nothing's
            selected -- so tapping an item never reflows what's under your
            thumb (it used to live in the header, shifting the Save/Reset
            buttons every time it appeared). */}
        <div className="sp-noprint" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap",
          minHeight: 38, padding: "8px 4px", borderTop: `1px solid ${C.hair}`, marginTop: 8,
        }}>
          {selItem ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontWeight: 600, fontSize: 13 }}>{selItem.label || selItem.kind}</strong>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: C.ink70 }}>
                  {positionCode(selItem.x, selItem.y, W, D)} · {selItem.x.toFixed(1)},{selItem.y.toFixed(1)}
                </span>
                {selItem.clash && <span style={{ fontSize: 11, color: "#9A6410", fontWeight: 600 }}>⚠ overlapping</span>}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={toggleZoom} aria-label={zoomed ? "Zoom out" : "Zoom in"}>
                  {zoomed ? <ZoomOut size={15} /> : <ZoomIn size={15} />}
                </button>
                {!readOnly && selItem.kind !== "power" && (
                  <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={() => bringToFront(selItem.key)}>
                    <BringToFront size={12} /> Front
                  </button>
                )}
                {!readOnly && selItem.moved && (
                  <button style={{ ...btn("transparent"), color: C.ink70, padding: 6 }} onClick={() => resetOne(selItem.key)} aria-label="Reset position"><RotateCcw size={16} /></button>
                )}
                {!readOnly && (selItem.kind === "power" || selItem.removable) && (
                  <button style={{ ...btn("transparent"), color: "#B03A2E", padding: 6 }} aria-label="Delete"
                    onClick={() => { selItem.kind === "power" ? hidePower(selItem.key) : removeGear(selItem.gearId); setSelected(null); }}>
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <span style={{ fontSize: 12.5, color: C.ink40 }}>Tap an item to see its position</span>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "10px 4px 2px", borderTop: `1px solid ${C.hair}`, marginTop: 8 }}>
          <Key swatch={C.amp} dashed>Amp / cab</Key>
          <Key swatch={C.ink}>DI</Key>
          <Key swatch={C.mic} round>Vocal mic</Key>
          <Key swatch={C.ink70} round>Instrument mic (perc / horn)</Key>
          <Key swatch={C.wedge}>Wedge</Key>
          <Key swatch={C.iem}>IEM</Key>
          <Key swatch={C.pa}>PA / desk</Key>
          <Key swatch={C.light}>Lighting</Key>
          {cfg.power.on && <Key swatch={C.power} round>13A</Key>}
        </div>
      </div>

      <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.hair}`, display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
        {cfg.members.map((m) => {
          const mic = items.find((i) => i.key === `${m.id}.mic`);
          const rig = items.find((i) => i.key === `${m.id}.back` || i.key === `${m.id}.kit`);
          const at = mic || rig;
          return (
            <span key={m.id} style={{ fontSize: 12, color: C.ink70 }}>
              <strong style={{ color: C.ink, fontWeight: 600 }}>{m.name}</strong>
              {m.guest ? " (guest)" : ""} — {ROLES[m.role].label.toLowerCase()}
              {m.sings ? (m.lead ? ", lead vocal" : ", vocal") : ""}
              {m.monitor === "iem" ? ", IEM" : m.monitor === "wedge" ? ", wedge" : ""}
              {at ? ` · ${positionCode(at.x, at.y, W, D)}` : ""}
            </span>
          );
        })}
      </div>

      {cfg.notes && (
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.hair}`, fontSize: 13, color: C.ink70 }}>
          <strong style={{ color: C.ink }}>Notes</strong> — {cfg.notes}
        </div>
      )}
    </div>
  );

  const inputTable = (
    <div className="sp-sheet" style={{ background: C.paper, border: `1px solid ${C.hair}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.hair}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, textTransform: "uppercase", color: C.ink }}>Input list</div>
          <div style={{ fontSize: 12.5, color: C.ink70 }}>
            {inputs.length} channels · {wedges} wedge mix{wedges === 1 ? "" : "es"} · {iems} IEM mix{iems === 1 ? "" : "es"}
          </div>
        </div>
        <button className="sp-noprint" style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }}
          onClick={() => copyText(inputListText(), "Input list copied")}><Copy size={13} /> Copy</button>
      </div>
      {inputs.map((r, i) => (
        <div key={r.ch} style={{
          display: "grid", gridTemplateColumns: "42px 1fr auto", gap: 10, alignItems: "center",
          padding: "8px 18px", background: r.warn ? "#FFF8EC" : i % 2 ? "#FAFBFC" : "#fff",
          borderBottom: `1px solid ${C.hair}`,
          boxShadow: r.warn ? `inset 3px 0 0 ${C.wedge}` : "none",
        }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: C.ink40 }}>{String(r.ch).padStart(2, "0")}</span>
          <span style={{ fontSize: 13.5, color: C.ink }}>{r.name}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: r.warn ? "#9A6410" : C.ink70, fontWeight: r.warn ? 600 : 400 }}>{r.source}</span>
        </div>
      ))}
      {inputs.length === 0 && <div style={{ padding: 24, textAlign: "center", color: C.ink70, fontSize: 13 }}>Add someone to the line-up and their channels appear here.</div>}
    </div>
  );

  return (
    <div style={{ background: C.page, minHeight: "100vh", color: C.ink }}>
      <style>{`
        .sp-root{font-family:var(--font-body)}
        .sp-lbl{font:600 14px var(--font-display)}
        .sp-sub{font:400 11px var(--font-body)}
        .sp-tag{font:600 9px var(--font-mono)}
        .sp-mono{font:600 11px var(--font-mono);letter-spacing:.06em}
        .sp-dim{font:500 11px var(--font-mono);letter-spacing:.08em}
        .sp-root *:focus-visible{outline:2px solid ${C.iem};outline-offset:2px}
        .sp-root button{transition:filter .15s ease}
        .sp-root button:hover{filter:brightness(1.18)}
        @media (prefers-reduced-motion:reduce){.sp-root *{transition:none!important}}
        @media print{.sp-noprint{display:none!important}.sp-root{background:#fff!important}
          .sp-sheet{border:none!important;break-inside:avoid}.sp-grid{display:block!important}}
      `}</style>

      <div className="sp-root" style={fullscreen ? {
        position: "fixed", inset: 0, zIndex: 75, background: C.page,
        overflowY: "auto", padding: narrow ? 12 : 20, margin: 0, maxWidth: "none",
      } : { maxWidth: 1440, margin: "0 auto", padding: narrow ? 12 : 20 }}>
        <header className="sp-noprint" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: C.deck, display: "grid", placeItems: "center" }}>
              <Crosshair size={18} color={C.wedge} />
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 700, textTransform: "uppercase", lineHeight: 1 }}>Stage plot</div>
              <div style={{ fontSize: 12, color: C.ink70 }}>Built from the line-up, adjusted by hand</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {onSave && !readOnly && (
              <button style={{ ...btn(C.wedge) }} onClick={saveToGig} disabled={saving}>
                <Save size={13} color="#2A1A02" />
                <span style={{ color: "#2A1A02" }}>{saving ? "Saving…" : saveLabel || "Save to gig"}</span>
              </button>
            )}
            {!readOnly && (
              <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={() => { patch({ overrides: {} }); setSelected(null); }}>
                <RotateCcw size={13} /> Reset positions
              </button>
            )}
            <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={() => setFullscreen((f) => !f)}>
              {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          </div>
        </header>

        {fullscreen && portrait && (
          <p className="sp-noprint" style={{
            fontSize: 12.5, color: "#9A6410", background: "#FFF8EC", border: `1px solid ${C.wedge}`,
            borderRadius: 8, padding: "8px 12px", marginBottom: 12,
          }}>
            Rotate your phone for the best view.
          </p>
        )}

        {narrow && !readOnly && (
          <div className="sp-noprint" style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${C.hair}`, borderRadius: 10, padding: 4, marginBottom: 12 }}>
            {[["plot", "Stage plot"], ["setup", "Set up"], ["inputs", "Input list"]].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                flex: 1, padding: "9px 6px", borderRadius: 7, border: "none", cursor: "pointer",
                background: tab === k ? C.deck : "transparent", color: tab === k ? "#fff" : C.ink70,
                fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              }}>{label}</button>
            ))}
          </div>
        )}

        <div className="sp-grid" style={{ display: "grid", gridTemplateColumns: readOnly ? "1fr" : narrow ? "1fr" : "370px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
          {!readOnly && (!narrow || tab === "setup") && (
            <div className="sp-noprint" style={{
              background: C.deck, color: C.deckText, borderRadius: 12, padding: 14,
              maxHeight: narrow ? "none" : "calc(100vh - 120px)", overflowY: narrow ? "visible" : "auto",
              position: narrow ? "static" : "sticky", top: 16,
            }}>{panel}</div>
          )}
          {(readOnly || !narrow || tab !== "setup") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {(readOnly || !narrow || tab === "plot") && sheet}
              {(readOnly || !narrow || tab === "inputs") && inputTable}
            </div>
          )}
        </div>

        {!readOnly && (
          <p className="sp-noprint" style={{ fontSize: 12, color: C.ink70, marginTop: 14, lineHeight: 1.6 }}>
            Drag anything, on or off the stage — PA, subs and the FOH desk live on the floor around it.
            Tap an item to see its stage position, reset it, or delete it. Stage left and right are named
            from the band's point of view, as engineers expect.
          </p>
        )}
      </div>

      {sheetOpen && (
        <div className="sp-noprint" onClick={() => setSheetOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(15,20,25,.55)", zIndex: 60,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 14, width: "100%", maxWidth: 600,
            height: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 18px 10px", flexShrink: 0 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, textTransform: "uppercase" }}>
                Export &amp; import
              </div>
              <button style={{ ...btn("#F1F3F5"), color: C.ink }} onClick={() => setSheetOpen(false)} aria-label="Close"><X size={14} /></button>
            </div>

            <div style={{ display: "flex", gap: 4, margin: "0 18px 12px", background: "#F1F3F5", borderRadius: 9, padding: 4, flexShrink: 0 }}>
              {[["export", "Export"], ["load", "Load a plot"]].map(([k, label]) => (
                <button key={k} onClick={() => setSheetTab(k)} style={{
                  flex: 1, padding: "8px 6px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: sheetTab === k ? "#fff" : "transparent", color: sheetTab === k ? C.ink : C.ink70,
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  boxShadow: sheetTab === k ? "0 1px 3px rgba(15,20,25,.14)" : "none",
                }}>{label}</button>
              ))}
            </div>

            {sheetTab === "export" ? (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 18px 18px" }}>
                <div style={{ border: `1px solid ${C.hair}`, borderRadius: 10, padding: 10, marginBottom: 8, background: C.floor }}>
                  {png
                    ? <img src={png} alt={`${cfg.band} stage plot`} style={{ width: "100%", display: "block", borderRadius: 6, background: "#fff" }} />
                    : <div style={{ padding: 30, textAlign: "center", color: C.ink70, fontSize: 13 }}>Rendering…</div>}
                </div>
                <p style={{ fontSize: 12.5, color: C.ink70, margin: "0 0 12px", lineHeight: 1.5 }}>
                  On a phone, press and hold the image, then <strong>Save to Photos</strong> — that's the
                  surest way out of here. The buttons work in a normal browser tab.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                  <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={downloadPNG}><ImageDown size={13} /> PNG</button>
                  <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={downloadSVG}><Download size={13} /> SVG</button>
                  <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={() => copyText(serialize(), "SVG code copied")}><Copy size={13} /> Copy SVG</button>
                </div>

                <div style={{ borderTop: `1px solid ${C.hair}`, paddingTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".12em", textTransform: "uppercase", color: C.ink70, marginBottom: 4, fontFamily: "var(--font-mono)" }}>
                    Config
                  </div>
                  <p style={{ fontSize: 12.5, color: C.ink70, margin: "0 0 8px", lineHeight: 1.5 }}>
                    A file transfers cleanly — copied text can get clipped on the way.
                    {" "}This config is {compactConfig().length} characters.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <button style={{ ...btn(C.ink), color: "#fff" }} onClick={saveConfigFile}><Download size={13} /> Save .json file</button>
                    <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }}
                      onClick={() => copyText(compactConfig(), "Config copied")}><Copy size={13} /> Copy config</button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 18px 18px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, flexShrink: 0 }}>
                  <button style={{ ...btn(C.ink), color: "#fff" }} onClick={() => fileRef.current && fileRef.current.click()}>
                    <FolderOpen size={13} /> Open .json file
                  </button>
                  <button style={{ ...btn("#fff"), color: C.ink, border: `1px solid ${C.hair}` }} onClick={pasteConfig}>
                    <ClipboardPaste size={13} /> Paste from clipboard
                  </button>
                  <input ref={fileRef} type="file" accept="application/json,.json,text/plain"
                    onChange={onConfigFile} style={{ display: "none" }} />
                </div>
                <p style={{ fontSize: 12.5, color: C.ink70, margin: "0 0 8px", lineHeight: 1.5, flexShrink: 0 }}>
                  Opening a file is the reliable route. Pasting below works too — if it arrives
                  short, the loader will tell you exactly where it stopped.
                </p>
                <textarea ref={importRef} defaultValue="" spellCheck={false}
                  autoCapitalize="off" autoCorrect="off" autoComplete="off" wrap="off"
                  onInput={(e) => setImportLen(e.target.value.length)}
                  placeholder="…or paste a config JSON here"
                  style={{
                    flex: 1, minHeight: 160, width: "100%", boxSizing: "border-box",
                    fontSize: 11, lineHeight: 1.45, fontFamily: "var(--font-mono)",
                    padding: 10, borderRadius: 8, border: `1px solid ${C.hair}`,
                    background: "#fff", color: C.ink, resize: "none",
                  }} />
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap", flexShrink: 0 }}>
                  <button style={{ ...btn(C.ink), color: "#fff" }}
                    onClick={() => loadFromText(importRef.current && importRef.current.value)}>
                    <FolderOpen size={13} /> Load this plot
                  </button>
                  <button style={{ ...btn("#fff"), color: C.ink70, border: `1px solid ${C.hair}` }}
                    onClick={() => { if (importRef.current) importRef.current.value = ""; setImportLen(0); }}>
                    <X size={12} /> Clear
                  </button>
                  <span style={{ fontSize: 11.5, color: C.ink40, fontFamily: "var(--font-mono)" }}>
                    {importLen ? `${importLen} characters` : ""}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="sp-noprint" style={{
          position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)",
          background: C.deck, color: "#fff", padding: "10px 16px", borderRadius: 999,
          fontSize: 13, display: "flex", gap: 8, alignItems: "center", zIndex: 70,
          boxShadow: "0 8px 24px rgba(15,20,25,.28)",
        }}><Check size={14} color={C.wedge} /> {toast}</div>
      )}
    </div>
  );
}

/* ── panel primitives ───────────────────────────────────────────── */

const inp = {
  width: "100%", padding: "7px 9px", borderRadius: 6, border: `1px solid ${C.deckEdge}`,
  background: "#171E25", color: C.deckText, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
};
const tiny = { fontSize: 11.5, color: "#9BA7B4" };
const chipBase = {
  padding: "5px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500,
  border: `1px solid ${C.deckEdge}`, color: C.deckText, cursor: "pointer", fontFamily: "inherit",
};
const btn = (bg) => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 11px", borderRadius: 7,
  border: "none", background: bg, color: bg === "#fff" ? C.ink : C.deckText,
  fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
});

function Section({ title, right, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "#8FA0B0", fontFamily: "var(--font-mono)" }}>{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Field({ label, grow, children }) {
  return (
    <label style={{ display: "block", marginBottom: 8, flex: grow ? 1 : "none", minWidth: 0 }}>
      <span style={{ ...tiny, display: "block", marginBottom: 3 }}>{label}</span>
      {children}
    </label>
  );
}

function Chip({ on, small, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      ...chipBase, padding: small ? "4px 9px" : "5px 10px",
      background: on ? C.wedge : C.deckHi, color: on ? "#2A1A02" : C.deckText,
      borderColor: on ? C.wedge : C.deckEdge, fontWeight: on ? 600 : 500,
    }}>{children}</button>
  );
}

function Toggle({ on, onClick, children }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", padding: 0, color: C.deckText, fontSize: 12.5, fontFamily: "inherit" }}>
      <span style={{ width: 30, height: 17, borderRadius: 999, background: on ? C.wedge : "#3C4855", position: "relative", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: on ? 15 : 2, width: 13, height: 13, borderRadius: "50%", background: "#fff", transition: "left .15s ease" }} />
      </span>
      {children}
    </button>
  );
}

function Check2({ on, onClick, children }) {
  return (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, color: on ? C.deckText : "#8FA0B0", fontSize: 12.5, fontFamily: "inherit" }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, display: "grid", placeItems: "center", background: on ? C.wedge : "transparent", border: `1px solid ${on ? C.wedge : C.deckEdge}` }}>
        {on && <Check size={11} color="#2A1A02" strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}

function KitPicker({ member, onChange }) {
  const sel = kitChannels(member);
  const toggle = (id) => onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <div>
      <div style={{ display: "flex", gap: 5, marginBottom: 7, alignItems: "center", flexWrap: "wrap" }}>
        <span style={tiny}>Kit mics</span>
        {Object.entries(KIT_PRESETS).map(([k, v]) => (
          <Chip key={k} small onClick={() => onChange(v.ch)}>{v.label}</Chip>
        ))}
        <span style={{ ...tiny, marginLeft: "auto" }}>{sel.length} ch</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 8px" }}>
        {KIT_CHANNELS.map((c) => (
          <Check2 key={c.id} on={sel.includes(c.id)} onClick={() => toggle(c.id)}>{c.label}</Check2>
        ))}
      </div>
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div style={{ border: `1px solid ${C.hair}`, borderRadius: 8, padding: "5px 10px", display: "flex", gap: 6, alignItems: "baseline", background: "#FAFBFC" }}>
      <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{k}</span>
      <span style={{ fontSize: 11, color: C.ink70, whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

function Key({ swatch, dashed, round, children }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.ink70 }}>
      <span style={{ width: 16, height: round ? 16 : 11, borderRadius: round ? "50%" : 3, border: `2px ${dashed ? "dashed" : "solid"} ${swatch}`, background: round ? swatch : "#fff", flexShrink: 0 }} />
      {children}
    </span>
  );
}
