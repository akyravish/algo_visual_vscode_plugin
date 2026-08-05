/* global runRecorded, acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const stage = document.getElementById("stage");
const status = document.getElementById("status");
const scrub = document.getElementById("scrub");
const speed = document.getElementById("speed");
const playBtn = document.getElementById("play");
const modeBtn = document.getElementById("mode");

let frames = [];
let cur = 0;
let timer = null;
let sentLine = -1;
let byLine = false;
let tally = [];

const el = (cls, text) => {
  const d = document.createElement("div");
  d.className = cls;
  if (text !== undefined && text !== null) d.textContent = text;
  return d;
};

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text; // textContent, so values can't inject markup
  return e;
};

// every drawable cell of a variable, keyed the same way op.key is
const cells = (v) => {
  const m = new Map();
  for (const c of v.cols || []) m.set(c.k, c.v);
  for (const r of v.rows || []) for (const c of r.cols) m.set(c.k, c.v);
  return m;
};

// "3.0" is how a nested cell is keyed; "[3][0]" is how a person reads it
const showKey = (k) => (k === null ? "" : `[${k.split(".").join("][")}]`);

// `ops` is every access the current line makes, not just the latest one, so both
// sides of `arr[j] > arr[j + 1]` light up together and a comparison looks like one.
const touch = (ops, name, key) => {
  const hit = ops.find((o) => o.name === name && o.key === key);
  return hit && hit.type;
};

const cellClasses = (c, before, ops, name) => {
  const was = before && before.has(c.k);
  const hit = touch(ops, name, c.k);
  const changed = was && before.get(c.k) !== c.v;
  return (
    "col" +
    (was ? "" : " enter") +
    (changed ? " pulse" : "") +
    (hit ? " " + hit : "")
  );
};

// One cell: a tile, plus its index (arrays) or its value (maps/objects).
function column(c, kind, before, ops, name, at) {
  const paired = kind === "map" || kind === "object";
  const cls = cellClasses(c, before, ops, name) + (c.k === at ? " here" : "");
  const col = el(cls + (paired ? " pair" : ""));
  col.appendChild(el("tile" + (paired ? " key" : ""), paired ? c.k : c.v));
  if (paired) col.appendChild(el("tile", c.v));
  else if (kind === "array" || kind === "string")
    col.appendChild(el("idx", c.k));
  return col;
}

// A plain value: a name and a number, small enough to sit shoulder to shoulder
// with its neighbours instead of claiming a whole row.
function chip(v, prevVar, ops) {
  const now = v.cols[0].v;
  const changed = prevVar && prevVar.cols[0].v !== now;
  const c = el(
    "chip" +
      (prevVar ? "" : " enter") +
      (changed ? " pulse" : "") +
      (touch(ops, v.name, null) ? " hit" : ""),
  );
  c.appendChild(el("label", v.name));
  c.appendChild(el("val", now));
  return c;
}

// Nodes and arrows: linked lists, trees, graphs.
// ponytail: rows are laid out by BFS depth and packed left to right. No tidy-tree
// algorithm — wide trees drift out of line. Good enough to read; fix if it bugs you.
function nodeGraph(v, before, ops) {
  const NW = 88;
  const NH = 46;
  const GX = 34;
  const GY = 54;
  const depth = new Array(v.nodes.length).fill(0);
  const out = new Map();
  for (const e of v.edges) out.set(e.from, (out.get(e.from) || 0) + 1);

  const seen = new Set([0]);
  for (const q = [0]; q.length;) {
    const id = q.shift();
    for (const e of v.edges)
      if (e.from === id && !seen.has(e.to)) {
        seen.add(e.to);
        depth[e.to] = depth[id] + 1;
        q.push(e.to);
      }
  }

  const chain = [...out.values()].every((c) => c <= 1);
  const used = new Map();
  const pos = v.nodes.map((_, i) => {
    const d = depth[i];
    const n = used.get(d) || 0;
    used.set(d, n + 1);
    return chain
      ? { x: d * (NW + GX), y: 0 }
      : { x: n * (NW + GX), y: d * (NH + GY) };
  });

  const w = Math.max(...pos.map((p) => p.x)) + NW + 2;
  const h = Math.max(...pos.map((p) => p.y)) + NH + 2;
  const root = svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  const marker = svg("marker", {
    id: "arrow",
    markerWidth: 7,
    markerHeight: 7,
    refX: 6,
    refY: 3,
    orient: "auto",
  });
  marker.appendChild(svg("path", { d: "M0,0 L6,3 L0,6 z", class: "head" }));
  const defs = svg("defs");
  defs.appendChild(marker);
  root.appendChild(defs);

  for (const e of v.edges) {
    const a = pos[e.from];
    const b = pos[e.to];
    const horizontal = a.y === b.y;
    const line = svg("line", {
      class: "edge",
      "marker-end": "url(#arrow)",
      x1: horizontal ? a.x + NW : a.x + NW / 2,
      y1: horizontal ? a.y + NH / 2 : a.y + NH,
      x2: horizontal ? b.x - 4 : b.x + NW / 2,
      y2: horizontal ? b.y + NH / 2 : b.y - 4,
    });
    root.appendChild(line);
    if (!chain)
      root.appendChild(
        svg(
          "text",
          {
            class: "elabel",
            x: (a.x + b.x) / 2 + NW / 2,
            y: (a.y + b.y) / 2 + NH,
          },
          e.label,
        ),
      );
  }

  // the nodes this line touched: longest path that prefixes each key
  let hit = -1;
  for (const o of ops)
    if (o.name === v.name && o.key !== null)
      for (const n of v.nodes)
        if (
          o.key.startsWith(n.path) &&
          (hit < 0 || n.path.length > v.nodes[hit].path.length)
        )
          hit = n.id;

  const known = new Set((before || []).map((n) => n.path));
  for (const n of v.nodes) {
    const p = pos[n.id];
    const g = svg("g", {
      class:
        "node" +
        (n.id === hit ? " hit" : "") +
        (known.has(n.path) ? "" : " enter"),
    });
    g.appendChild(
      svg("rect", { x: p.x, y: p.y, width: NW, height: NH, rx: 6 }),
    );
    const one = n.fields.length === 1;
    n.fields.slice(0, 3).forEach((f, i) => {
      g.appendChild(
        svg(
          "text",
          {
            x: p.x + NW / 2,
            y: p.y + (one ? NH / 2 + 6 : 17 + i * 14),
            class: one ? "big" : "",
          },
          one ? f.v : `${f.k}: ${f.v}`,
        ),
      );
    });
    root.appendChild(g);
  }
  return root;
}

function block(v, prevVar, ops) {
  const box = el("block" + (prevVar ? "" : " enter"));
  box.appendChild(el("label", v.name));

  if (v.kind === "graph") {
    box.appendChild(nodeGraph(v, prevVar && prevVar.nodes, ops));
    return box;
  }

  const before = prevVar && cells(prevVar);
  if (v.kind === "grid") {
    // buckets (at most one item per row) read as a strip; matrices stay stacked
    if (v.rows.every((r) => r.cols.length <= 1)) {
      const row = el("row");
      for (const r of v.rows) {
        const col = r.cols.length
          ? column(r.cols[0], v.kind, before, ops, v.name, v.at)
          : el("col");
        if (!r.cols.length) col.appendChild(el("void"));
        col.appendChild(el("idx", r.i));
        row.appendChild(col);
      }
      box.appendChild(row);
      return box;
    }
    for (const r of v.rows) {
      const row = el("row grid");
      row.appendChild(el("rowlabel", r.i));
      if (!r.cols.length) row.appendChild(el("void"));
      for (const c of r.cols)
        row.appendChild(column(c, v.kind, before, ops, v.name, v.at));
      box.appendChild(row);
    }
    return box;
  }

  const row = el("row");
  if (!v.cols.length) row.appendChild(el("void"));
  for (const c of v.cols)
    row.appendChild(column(c, v.kind, before, ops, v.name, v.at));
  box.appendChild(row);
  return box;
}

// A running count of the work done so far. Every access is already recorded, so
// this is just a prefix sum — it turns "this is O(n²)" into something you watch.
function countUp() {
  const acc = { read: 0, write: 0, test: 0, call: 0 };
  tally = frames.map((f) => {
    if (f.op.type in acc) acc[f.op.type]++;
    return { ...acc };
  });
}

const WORK = { read: "read", write: "write", test: "comparison", call: "call" };

const workDone = (i) => {
  const t = tally[i];
  if (!t) return "";
  return Object.entries(t)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${WORK[k]}${n === 1 ? "" : "s"}`)
    .join(" · ");
};

// Frames that belong to the same run of the same source line, in the same call.
const sameLine = (a, b) =>
  frames[a] &&
  frames[b] &&
  frames[a].line === frames[b].line &&
  frames[a].stack.length === frames[b].stack.length;

// Every access the current line makes, looking both ways from where we are.
function lineOps(at) {
  const ops = [];
  for (let i = at; sameLine(i, at); i--) ops.push(frames[i].op);
  for (let i = at + 1; sameLine(i, at); i++) ops.push(frames[i].op);
  return ops;
}

// One press = one whole line, instead of one memory access.
function lineStep(from, d) {
  let i = from;
  while (sameLine(i + d, i)) i += d;
  i += d;
  if (i < 0 || i >= frames.length) return from;
  while (sameLine(i + 1, i)) i++; // land on the line's finished state
  return i;
}

// Each call gets its own slab, nested inside its caller: the stack, drawn as
// containment. Inside a slab, plain values sit together in one strip at the top —
// they are the cursors — and the structures they point into wrap below.
function render() {
  scrub.value = String(cur);
  const f = frames[cur];
  if (!f) return;
  const prev = frames[cur - 1];
  const ops = lineOps(cur);
  const slabs = [];
  let strip = null;
  let structs = null;
  let group = null;

  for (const v of f.vars) {
    const key = `${v.depth}|${v.fn}`;
    if (key !== group) {
      group = key;
      const slab = el("slab" + (v.depth ? " nested" : ""));
      if (v.depth) slab.appendChild(el("fname", `${v.fn}()`));
      slab.appendChild((strip = el("strip")));
      slab.appendChild((structs = el("structs")));
      slabs.push(slab);
    }
    const was =
      prev && prev.vars.find((p) => p.name === v.name && p.depth === v.depth);
    if (v.kind === "scalar") strip.appendChild(chip(v, was, ops));
    else structs.appendChild(block(v, was, ops));
  }

  slabs.forEach((sl, i) => {
    if (i < slabs.length - 1) sl.className += " dim"; // only the live frame is lit
  });
  stage.replaceChildren(...slabs);

  const inside = f.stack.length > 1 && !["call", "return"].includes(f.op.type);
  status.replaceChildren(
    el("step", `${cur + 1}/${frames.length}`),
    el(
      "said",
      `line ${f.line} · ${phrase(f)}${inside ? ` · in ${f.stack[f.stack.length - 1]}()` : ""}`,
    ),
    el("tally", workDone(cur)),
  );

  if (f.line !== sentLine) {
    sentLine = f.line;
    vscode.postMessage({ line: f.line, note: phrase(f) });
  }
}

// What this step did, in one phrase. Used both in the panel and as the hint
// shown beside the line in your editor, so they always read the same.
function phrase(f) {
  if (f.op.type === "call") return `→ into ${f.op.name}()`;
  if (f.op.type === "returns") return `${f.op.name}() → ${f.op.value}`;
  if (f.op.type === "test") return `${f.op.name} → ${f.op.value}`;
  if (f.op.type === "return") return `← out of ${f.op.name}()`;
  const v = f.vars.find((x) => x.name === f.op.name);
  if (!v) return `${f.op.type} ${f.op.name}`;
  if (v.kind === "scalar") return `${v.name} = ${v.cols[0].v}`;
  const at = showKey(f.op.key);
  const value = cells(v).get(f.op.key);
  return value === undefined
    ? `${f.op.type} ${v.name}${at}`
    : `${f.op.type} ${v.name}${at} = ${value}`;
}

// a plain message in the status bar, optionally kept alongside the step readout
function say(text, keep) {
  const note = el("said", text);
  if (keep) status.appendChild(note);
  else status.replaceChildren(note);
}

function stop() {
  clearInterval(timer);
  timer = null;
  playBtn.textContent = "▶ Play";
}

function play() {
  if (timer) return stop();
  if (cur >= frames.length - 1) cur = 0;
  playBtn.textContent = "⏸ Pause";
  timer = setInterval(
    () => {
      const next = byLine ? lineStep(cur, 1) : cur + 1;
      if (next >= frames.length || next === cur) return stop();
      cur = next;
      render();
    },
    1000 / Number(speed.value),
  );
}

function step(d) {
  stop();
  cur = byLine
    ? lineStep(cur, d)
    : Math.min(frames.length - 1, Math.max(0, cur + d));
  render();
}

// click a line in the editor → jump to the first step that ran it
function jumpTo(line) {
  const i = frames.findIndex((f) => f.line === line);
  if (i < 0) return;
  stop();
  cur = i;
  render();
}

// After a save the frames are rebuilt, so hold your place: the step on the same
// source line nearest to where you were, rather than dropping you back at the start.
function nearest(was, line) {
  let best = -1;
  let closest = Infinity;
  frames.forEach((f, i) => {
    const d = Math.abs(i - was);
    if (f.line === line && d < closest) {
      closest = d;
      best = i;
    }
  });
  return best >= 0 ? best : Math.min(was, frames.length - 1);
}

function load(code) {
  stop();
  const wasAt = frames[cur];
  sentLine = -1;
  const result = runRecorded(code);
  const failure = result.error
    ? { line: result.error.line, message: result.error.message }
    : null;
  vscode.postMessage({ error: failure });

  frames = result.frames;
  if (!frames.length) {
    cur = 0;
    stage.replaceChildren();
    vscode.postMessage({ line: 0 });
    say(
      failure
        ? `Line ${failure.line}: ${failure.message}`
        : "Nothing to show yet. Declare an array, object, Map or Set to watch it run.",
    );
    return;
  }
  cur = wasAt ? nearest(cur, wasAt.line) : 0;
  scrub.max = String(Math.max(0, frames.length - 1));
  countUp();
  render();
  if (failure) say(`Line ${failure.line}: ${failure.message}`, true);
  if (result.capped) say("Stopped early — is there an endless loop?", true);
  if (result.degraded)
    say("Couldn't rewrite this file safely, so plain values aren't tracked.", true);
}

playBtn.onclick = play;
modeBtn.onclick = () => {
  byLine = !byLine;
  modeBtn.textContent = byLine ? "By line" : "By access";
  stop();
  render();
};
document.getElementById("prev").onclick = () => step(-1);
document.getElementById("next").onclick = () => step(1);
scrub.oninput = () => {
  stop();
  cur = Number(scrub.value);
  render();
};
speed.oninput = () => timer && (stop(), play());
window.addEventListener("keydown", (e) => {
  const keys = {
    ArrowRight: () => step(1),
    ArrowLeft: () => step(-1),
    " ": play,
  };
  if (!keys[e.key]) return;
  e.preventDefault();
  keys[e.key]();
});
window.addEventListener("message", (e) => {
  if (e.data.jump !== undefined) jumpTo(e.data.jump);
  else load(e.data.code);
});
