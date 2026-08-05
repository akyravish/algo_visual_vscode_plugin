// Turns normal, unmodified code into teaching frames.
//
// rewrite.js edits your source so it announces itself (see the notes there);
// this file receives those announcements and turns them into frames:
//
//   1. Structures (array / object / Map / Set) are handed to your code as a
//      Proxy, so every read and write trips a trap. Nested structures are
//      wrapped on the way out, so grid[i][j] and node.next.next animate too.
//   2. Plain values can't be proxied, so `__v('x', x)` reports them instead.
//   3. `__in` / `__out` make variables live and die with their call, so
//      recursion shows up as a stack, and `__ret` catches what comes back.
//
// The source line of each frame comes out of new Error().stack at the moment it
// happens — no interpreter, no stepping. Runs in the webview and in node.

// ponytail: hard cap so an infinite loop in user code can't hang the panel
const MAX_FRAMES = 20000;
const MAX_NODES = 60; // graph walk guard
const RETURNED = "→"; // the chip a function's return value lands in

// Deepest stack frame that came from the user's code, e.g. "<anonymous>:7:12".
const lineIn = (stack) => {
  for (const f of (stack || "").split("\n")) {
    const m = f.match(/<anonymous>:(\d+):\d+\)?\s*$/);
    if (m) return Number(m[1]);
  }
  return 0;
};
const rawLine = () => lineIn(new Error().stack);

const isObj = (v) => v !== null && typeof v === "object";

// Printable form of a value sitting inside a tracked structure.
const fmt = (v, d = 0) => {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (Array.isArray(v))
    return d > 1 ? "[…]" : "[" + v.map((x) => fmt(x, d + 1)).join(",") + "]";
  if (v instanceof Map) return `Map(${v.size})`;
  if (v instanceof Set) return `Set(${v.size})`;
  if (typeof v === "object") return d > 1 ? "{…}" : JSON.stringify(v);
  return String(v);
};

// An object holding references to other objects is drawn as nodes and arrows
// (linked list, tree, graph) instead of key/value boxes.
const graph = (root) => {
  const nodes = [];
  const ids = new Map();
  const edges = [];
  const visit = (o, path) => {
    if (ids.has(o)) return ids.get(o);
    if (nodes.length >= MAX_NODES) return -1;
    const id = nodes.length;
    ids.set(o, id);
    const fields = [];
    nodes.push({ id, path, fields });
    const links = [];
    for (const [k, v] of Object.entries(o)) {
      if (isObj(v) && !(v instanceof Map) && !(v instanceof Set))
        links.push([k, v]);
      else fields.push({ k, v: fmt(v) });
    }
    for (const [k, v] of links) {
      const to = visit(v, `${path}${k}.`);
      if (to >= 0) edges.push({ from: id, to, label: k });
    }
    return id;
  };
  visit(root, "");
  return { kind: "graph", nodes, edges };
};

const pointsAtObjects = (o) =>
  Object.values(o).some((v) => isObj(v) && !Array.isArray(v));

// One tracked variable → what the renderer draws.
// array → value over index.  grid → rows of those.  map/object → key over value.
// graph → nodes and arrows.  scalar → one box.
const snap = (t) => {
  const raw = t.raw;
  if (t.scalar) {
    // strings are values, not collections — quoted, and kept chip-sized
    let shown = fmt(raw);
    if (typeof raw === "string")
      shown = `"${raw.length > 24 ? raw.slice(0, 24) + "…" : raw}"`;
    return { kind: "scalar", cols: [{ k: null, v: shown }] };
  }
  const at = t.at === undefined ? null : t.at; // the cell we are working on
  if (Array.isArray(raw)) {
    if (raw.length && raw.every((r) => Array.isArray(r)))
      return {
        at,
        kind: "grid",
        rows: raw.map((row, i) => ({
          i,
          cols: row.map((v, j) => ({ k: `${i}.${j}`, v: fmt(v) })),
        })),
      };
    return {
      at,
      kind: "array",
      cols: raw.map((v, i) => ({ k: String(i), v: fmt(v) })),
    };
  }
  if (raw instanceof Map)
    return {
      at,
      kind: "map",
      cols: [...raw].map(([k, v]) => ({ k: fmt(k), v: fmt(v) })),
    };
  if (raw instanceof Set)
    return {
      at,
      kind: "set",
      cols: [...raw].map((v) => ({ k: fmt(v), v: fmt(v) })),
    };
  if (pointsAtObjects(raw)) return { at, ...graph(raw) };
  return {
    at,
    kind: "object",
    cols: Object.entries(raw).map(([k, v]) => ({ k, v: fmt(v) })),
  };
};

// Rewriting your source (so it can narrate itself) lives in rewrite.js.
const rewriter =
  typeof rewrite !== "undefined" ? { rewrite } : require("./rewrite.js");

// --- recorder --------------------------------------------------------------

function runRecorded(src) {
  // If your file doesn't parse, we still run it — just without the narration.
  let degraded = false;
  let parseLine = 0;
  let code;
  try {
    code = rewriter.rewrite(src);
  } catch (e) {
    degraded = true; // acorn knows exactly where it gave up
    parseLine = (e && e.loc && e.loc.line) || 0;
    code = src;
  }
  const frames = [];
  const tracked = []; // { name, raw, scalar?, depth, fn }
  const stack = [{ fn: "(top level)" }];
  const children = new WeakMap(); // raw object → its proxy, so identity holds
  const raws = new WeakMap(); // proxy → raw, to keep proxies out of stored data
  const unwrap = (v) => raws.get(v) || v;
  let capped = false;
  let offset = 0;

  const depth = () => stack.length - 1;
  const lineOf = () => Math.max(0, rawLine() - offset);

  const push = (op, line) => {
    if (frames.length >= MAX_FRAMES) {
      capped = true;
      throw new Error("__ALGOVIZ_CAP__");
    }
    // ponytail: snapshots every tracked variable every frame. Fine for teaching-sized
    // data; switch to per-frame deltas if you ever animate thousands of elements.
    frames.push({
      line: line === undefined ? lineOf() : line,
      op,
      stack: stack.map((s) => s.fn),
      vars: tracked.map((t) => ({
        name: t.name,
        depth: t.depth,
        fn: t.fn,
        ...snap(t),
      })),
    });
  };

  const isIndex = (k) => typeof k === "string" && /^\d+$/.test(k);

  const wrap = (raw, entry, prefix) => {
    const seen = children.get(raw);
    if (seen) return seen;
    const name = entry.name;
    const rec = (type, key) => {
      const at = key === undefined ? null : prefix + fmt(key);
      if (at !== null) entry.at = at; // keep the marker put during whole-collection reads
      push({ name, type, key: at });
    };

    // Maps and Sets do their work through methods, so intercept the methods.
    let proxy;
    if (raw instanceof Map || raw instanceof Set) {
      const writes = new Set(["set", "add", "delete", "clear"]);
      const reads = new Set(["get", "has"]);
      proxy = new Proxy(raw, {
        get(t, k) {
          const v = Reflect.get(t, k);
          if (typeof v !== "function") return v; // .size and friends: not a step
          return (...args) => {
            const out = v.apply(t, args.map(unwrap));
            if (writes.has(k)) rec("write", args[0]);
            else if (reads.has(k)) rec("read", args[0]);
            else rec("read"); // iteration, forEach, keys()…
            return out === t ? proxy : out;
          };
        },
      });
    } else {
      proxy = new Proxy(raw, {
        get(t, k, r) {
          const el = Array.isArray(t) ? isIndex(k) : typeof k === "string";
          if (el) rec("read", k);
          const v = Reflect.get(t, k, r);
          // wrap nested structures so grid[i][j] and node.next.next animate too
          return el && isObj(v) ? wrap(v, entry, `${prefix}${k}.`) : v;
        },
        set(t, k, v) {
          const el = Array.isArray(t) ? isIndex(k) : typeof k === "string";
          const ok = Reflect.set(t, k, unwrap(v)); // raw target, raw value
          if (el) rec("write", k);
          return ok;
        },
        deleteProperty(t, k) {
          const ok = Reflect.deleteProperty(t, k);
          rec("write", k);
          return ok;
        },
      });
    }
    children.set(raw, proxy);
    raws.set(proxy, raw);
    return proxy;
  };

  const visualize = (rawOrProxy, given) => {
    const value = unwrap(rawOrProxy);
    if (!isObj(value)) return rawOrProxy; // a plain value: __v() handles those
    const already = tracked.find((t) => t.raw === value);
    if (already) return wrap(value, already, ""); // an alias, not a new thing
    const line = lineOf();
    const name = given || `value${tracked.length + 1}`;
    const entry = {
      name,
      raw: value,
      at: null,
      depth: depth(),
      fn: stack[depth()].fn,
    };
    tracked.push(entry);
    push({ name, type: "create", key: null }, line);
    return wrap(value, entry, "");
  };

  // What the instrumented `__v('sum', sum)` calls land in.
  const observe = (name, value) => {
    if (isObj(value) || typeof value === "function") return value; // structures use visualize()
    const d = depth();
    const seen = tracked.find(
      (t) => t.name === name && t.scalar && t.depth === d,
    );
    if (seen && Object.is(seen.raw, value)) return value; // nothing changed, no step
    if (seen) seen.raw = value;
    else
      tracked.push({
        name,
        raw: value,
        scalar: true,
        depth: d,
        fn: stack[d].fn,
      });
    push({ name, type: seen ? "write" : "create", key: null });
    return value;
  };

  const enter = (fn, params) => {
    stack.push({ fn });
    push({ name: fn, type: "call", key: null });
    for (const [k, v] of Object.entries(params)) observe(k, v);
  };

  // every condition, and how it came out
  const tested = (value, text) => {
    push({ name: text, type: "test", key: null, value: value ? "true" : "false" });
    return value;
  };

  // what a function hands back, captured on its way out
  const ret = (returned) => {
    const value = unwrap(returned);
    const d = depth();
    const fn = stack[d].fn;
    const known = isObj(value) && tracked.find((t) => t.raw === value);
    if (!isObj(value)) {
      const seen = tracked.find((t) => t.name === RETURNED && t.depth === d);
      if (seen) seen.raw = value;
      else tracked.push({ name: RETURNED, raw: value, scalar: true, depth: d, fn });
    }
    push({ name: fn, type: "returns", key: null, value: known ? known.name : fmt(value) });
    return returned;
  };

  const exit = () => {
    const gone = depth();
    const fn = stack[gone].fn;
    push({ name: fn, type: "return", key: null }); // last look at the call's variables
    stack.pop();
    for (let i = tracked.length - 1; i >= 0; i--)
      if (tracked[i].depth >= gone) tracked.splice(i, 1);
  };

  // new Function() prepends its own header lines to the body. Measure how many
  // instead of assuming, so this survives any engine. Same arity as the real call.
  const SIG = ["visualize", "__v", "__in", "__out", "__ret", "__if"];
  let probed = 0;
  new Function(...SIG, "visualize.x;")(
    new Proxy({}, { get: () => ((probed = rawLine()), 0) }),
    ...SIG.slice(1).map(() => null),
  );
  offset = probed - 1;

  // If the rewrite ever produces invalid JS, fall back to structures-only.
  let error = null;
  try {
    new Function(...SIG, code)(visualize, observe, enter, exit, ret, tested);
  } catch (e) {
    if (!(e && e.message === "__ALGOVIZ_CAP__")) {
      // capped is not an error; anything else gets the line it blew up on
      error = e;
      if (e) e.line = Math.max(0, lineIn(e.stack) - offset) || parseLine;
    }
  }
  return { frames, capped, error, degraded, code };
}

if (typeof module !== "undefined") module.exports = { runRecorded, MAX_FRAMES };
