// node test.js
const assert = require("assert");
const { runRecorded } = require("./media/recorder.js");

// --- arrays: names, line numbers, reads and writes -------------------------
const bubble = `
const arr = visualize([3, 1, 2]);
for (let i = 0; i < arr.length; i++)
  for (let j = 0; j < arr.length - i - 1; j++)
    if (arr[j] > arr[j + 1]) {
      const t = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = t;
    }
`;
const sort = runRecorded(bubble);
assert.ifError(sort.error);
assert.strictEqual(sort.frames[0].op.type, "create");
assert.strictEqual(
  sort.frames[0].vars[0].name,
  "arr",
  "name is read off the source line",
);
assert.strictEqual(sort.frames[0].line, 2, "visualize() is on line 2");
assert.strictEqual(sort.frames[0].vars[0].kind, "array");
assert.deepStrictEqual(
  sort.frames[1].vars[0].cols[0],
  { k: "0", v: "3" },
  "array col = value + index",
);
assert.ok(
  sort.frames.some((f) => f.line === 5),
  "comparisons report their own line",
);
assert.deepStrictEqual(
  sort.frames.at(-1).vars[0].cols.map((c) => c.v),
  ["1", "2", "3"],
);

// --- a Map being created empty, then filling up ----------------------------
const counting = `
const nums = visualize([7, 7]);
const counts = visualize(new Map());
for (let i = 0; i < nums.length; i++) counts.set(nums[i], (counts.get(nums[i]) ?? 0) + 1);
`;
const count = runRecorded(counting);
assert.ifError(count.error);
const created = count.frames.find(
  (f) => f.op.type === "create" && f.op.name === "counts",
);
assert.deepStrictEqual(created.vars[1].cols, [], "Map starts visibly empty");
assert.strictEqual(
  count.frames.at(-1).vars.length,
  2,
  "both variables stay on screen",
);
assert.deepStrictEqual(
  count.frames.at(-1).vars[1].cols,
  [{ k: "7", v: "2" }],
  "map col = key + value",
);

// --- plain code, no visualize() anywhere: declarations get wrapped for you ---
const plain = runRecorded(`
const list = [4, 1];
const seen = new Map();
const t = list[0];
seen.set(t, true);
`);
assert.ifError(plain.error);
assert.deepStrictEqual(
  plain.frames.at(-1).vars.map((v) => v.name),
  ["list", "seen", "t"],
  "structures wrapped, plain variables reported",
);
assert.strictEqual(
  plain.frames[0].line,
  2,
  "auto-wrap must not shift line numbers",
);
assert.deepStrictEqual(plain.frames.at(-1).vars[1].cols, [
  { k: "4", v: "true" },
]);

// a comment mentioning visualize() must not switch auto-wrap off
// ...and a trailing comment on the declaration itself must not block the wrap
const commented = runRecorded(`
// e.g. visualize([1])
const z = [9]; // the input
const w = new Map(); // empty for now
z[0];
`);
assert.deepStrictEqual(
  commented.frames.at(-1).vars.map((v) => v.name),
  ["z", "w"],
);

// one explicit call turns auto-wrap off, so you keep control
const explicit = runRecorded(
  "const a = [1]; const b = visualize([2]); a[0]; b[0];",
);
assert.deepStrictEqual(
  explicit.frames.at(-1).vars.map((v) => v.name),
  ["b"],
);

// --- plain variables: declarations, assignments, loop bindings -------------
const sum = runRecorded(`
let arr = [1, 2, 3];
function getSum(arr) {
  let total = 0
  for (const item of arr) {
    total += item
  }
  return total
}
getSum(arr);
arr[0];
`);
assert.ifError(sum.error);
assert.strictEqual(
  sum.code.split("\n").length,
  12,
  "rewriting must never add or remove a line",
);
assert.ok(
  !sum.frames.some((f) =>
    f.vars.some((v) => v.name === "arr" && v.kind === "scalar"),
  ),
  "a wrapped structure is never also shown as a scalar",
);
const inside = sum.frames[sum.frames.length - 2]; // still inside getSum
assert.deepStrictEqual(
  inside.vars.map((v) => `${v.name}:${v.kind}@${v.depth}`),
  ["arr:array@0", "total:scalar@1", "item:scalar@1", "→:scalar@1"],
  "locals live at the call's depth, ending with what the call returns",
);
assert.deepStrictEqual(
  inside.vars[1].cols,
  [{ k: null, v: "6" }],
  "total reaches 6",
);
assert.deepStrictEqual(
  sum.frames.at(-1).vars.map((v) => v.name),
  ["arr"],
  "locals are cleared once the call is behind us",
);
const ret = sum.frames.find((f) => f.op.type === "return");
assert.deepStrictEqual(
  ret.vars.map((v) => v.name),
  ["arr", "total", "item", "→"],
  "the return step still shows what the call ended with",
);
assert.deepStrictEqual(sum.frames.at(-1).stack, ["(top level)"]);
assert.ok(
  sum.frames.some((f) => f.op.name === "item" && f.line === 5),
  "the loop variable is reported on the loop header line",
);
const totals = sum.frames
  .filter((f) => f.op.name === "total")
  .map((f) => f.vars[1].cols[0].v);
assert.deepStrictEqual(
  totals,
  ["0", "1", "3", "6"],
  "every change to total is a step, no repeats",
);

// counters in a classic for-loop are picked up from the header too
const counter = runRecorded(
  "const a = [7];\nfor (let i = 0; i < a.length; i++) {\n  a[i];\n}",
);
assert.ok(
  counter.frames.some((f) => f.op.name === "i"),
  "loop counter tracked",
);

// --- several declarators on one line, and the "we are here" marker ---------
const multi = runRecorded(
  "let nums = [1, 2, 3], k = 2\nfor (const n of nums) {\n  k += n\n}",
);
assert.ifError(multi.error);
const mv = multi.frames.at(-1).vars;
assert.deepStrictEqual(
  mv.map((v) => `${v.name}:${v.kind}`),
  ["nums:array", "k:scalar", "n:scalar"],
  "every declarator on the line gets tracked, not just the first",
);
assert.strictEqual(mv[0].at, "2", "the array remembers which item we are on");
assert.strictEqual(
  mv[1].cols[0].v,
  "8",
  "k really is a let binding, not a lost global",
);

// --- nested structures: grids and node graphs ------------------------------
const grid = runRecorded("const g = [[1, 2], [3, 4]];\ng[1][0] = 9;");
assert.ifError(grid.error);
const rows = grid.frames.at(-1).vars[0];
assert.strictEqual(rows.kind, "grid");
assert.deepStrictEqual(
  rows.rows.map((r) => r.cols.map((c) => c.v)),
  [
    ["1", "2"],
    ["9", "4"],
  ],
  "a write through the inner array lands in the grid",
);
assert.strictEqual(
  grid.frames.at(-1).op.key,
  "1.0",
  "nested writes report a compound key",
);

const list = runRecorded(
  "const head = { value: 1, next: null };\nhead.next = { value: 2, next: null };",
);
assert.ifError(list.error);
const g = list.frames.at(-1).vars[0];
assert.strictEqual(g.kind, "graph");
assert.strictEqual(g.nodes.length, 2, "the appended node is discovered");
assert.deepStrictEqual(g.edges, [{ from: 0, to: 1, label: "next" }]);
assert.deepStrictEqual(
  g.nodes[1].path,
  "next.",
  "nodes carry the path used to highlight them",
);

// a cycle must not hang the walk
const cyclic = runRecorded('const a = { name: "a", link: null };\na.link = a;');
assert.ifError(cyclic.error);
assert.strictEqual(cyclic.frames.at(-1).vars[0].nodes.length, 1);

// --- recursion shows one set of variables per call -------------------------
const fib = runRecorded(
  "function fib(n) {\n  if (n < 2) return n\n  return fib(n-1) + fib(n-2)\n}\nfib(3);",
);
assert.ifError(fib.error);
// the frame holding the most variables is the deepest live call
const deepest = fib.frames.reduce((a, f) =>
  f.vars.length > a.vars.length ? f : a,
);
assert.ok(
  deepest.stack.length >= 4,
  `recursion nests, got ${deepest.stack.join(">")}`,
);
assert.deepStrictEqual(
  deepest.vars.map((v) => `${v.name}@${v.depth}`),
  ["n@1", "n@2", "n@3", "→@3"],
  "each call keeps its own n, plus what it hands back",
);
assert.strictEqual(fib.frames.at(-1).op.type, "return");
assert.deepStrictEqual(
  fib.frames.at(-1).vars.map((v) => `${v.name}@${v.depth}`),
  ["n@1", "→@1"],
  "the last step shows the outermost call and its answer, not an empty screen",
);

// what each call returns is captured on the way out
assert.deepStrictEqual(
  fib.frames.filter((f) => f.op.type === "returns").map((f) => f.op.value),
  ["1", "0", "1", "1", "2"],
  "every return value, innermost first, ending with fib(3) = 2"
);
const objectReturn = runRecorded(
  "function build() {\n  const out = [1, 2];\n  return out\n}\nbuild();"
);
assert.strictEqual(
  objectReturn.frames.find((f) => f.op.type === "returns").op.value,
  "out",
  "returning a structure names it rather than dumping it"
);

// layout no longer matters — the parser sees structure, not indentation
const odd = runRecorded("function f(a) {\nif (a) {\n}\nreturn a\n}\nf(7);");
assert.ifError(odd.error);
assert.ok(!odd.degraded, "unusual indentation is no longer a problem");
assert.strictEqual(odd.frames.find((f) => f.op.type === "returns").op.value, "7");

// a multi-line declaration, which the old regex could never see
const multiline = runRecorded("const rows = [\n  1,\n  2,\n];\nrows[0];");
assert.ifError(multiline.error);
assert.deepStrictEqual(
  multiline.frames.at(-1).vars.map((v) => `${v.name}:${v.kind}`),
  ["rows:array"],
  "declarations spanning several lines are tracked now"
);

// only code that genuinely will not parse degrades
const broken = runRecorded("const a = [1, 2;");
assert.ok(broken.degraded && broken.error, "unparseable code degrades and reports");

// --- class methods are named after their class ---------------------------
const klass = runRecorded(`
class ListNode {
  constructor(v) { this.val = v; this.next = null; }
  tail() { return this }
}
const head = new ListNode(1);
head.tail();
`);
assert.ifError(klass.error);
assert.deepStrictEqual(
  [...new Set(klass.frames.map((f) => f.stack[f.stack.length - 1]))],
  ["new ListNode", "(top level)", "ListNode.tail"],
  "constructors and methods carry their class name"
);

// --- conditions report what was tested and how it came out ----------------
const cond = runRecorded(`
const a = [3, 1];
for (let i = 0; i < 2; i++) {
  if (a[i] > 2) { a[i] = 0; }
}
`);
assert.ifError(cond.error);
assert.deepStrictEqual(
  cond.frames.filter((f) => f.op.type === "test").map((f) => `${f.op.name} → ${f.op.value}`),
  ["a[i] > 2 → true", "a[i] > 2 → false"],
  "only real decisions are steps — the for-header is not one"
);

// --- a short string is characters with indices ----------------------------
const word = runRecorded('const word = "abc";\nword.length;');
const ws = word.frames.at(-1).vars[0];
assert.strictEqual(ws.kind, "string");
assert.deepStrictEqual(ws.cols, [
  { k: "0", v: "a" },
  { k: "1", v: "b" },
  { k: "2", v: "c" },
]);
assert.strictEqual(
  runRecorded('const c = "x";').frames.at(-1).vars[0].kind,
  "scalar",
  "a single character stays a plain value"
);

// --- the work counter matches the textbook -------------------------------
const nine = runRecorded(
  "const a = [5, 3, 8, 1, 9, 2, 7, 4, 6];\n" +
    "for (let i = 0; i < a.length; i++) {\n" +
    "  for (let j = 0; j < a.length - i - 1; j++) {\n" +
    "    if (a[j] > a[j + 1]) {\n" +
    "      const t = a[j]; a[j] = a[j + 1]; a[j + 1] = t;\n" +
    "    }\n  }\n}"
);
assert.strictEqual(
  nine.frames.filter((f) => f.op.type === "test").length,
  36,
  "bubble sort on 9 items compares n(n-1)/2 times"
);

// --- destructuring: the idiomatic swap must not go stale --------------------
const swap = runRecorded("let a = 1, b = 2;\n[a, b] = [b, a];");
assert.ifError(swap.error);
assert.deepStrictEqual(
  swap.frames.at(-1).vars.map((v) => `${v.name}=${v.cols[0].v}`),
  ["a=2", "b=1"],
  "[a, b] = [b, a] reports both sides"
);
assert.deepStrictEqual(
  runRecorded("const [x, y] = [1, 2];").frames.map((f) => f.op.name),
  ["x", "y"],
  "destructured declarations bind two variables, so they are two steps"
);
// member targets stay the Proxy's job — no phantom scalars for arr[0]
const arrSwap = runRecorded("const arr = [3, 1];\n[arr[0], arr[1]] = [arr[1], arr[0]];");
assert.strictEqual(arrSwap.frames.at(-1).vars.length, 1);
assert.deepStrictEqual(
  arrSwap.frames.at(-1).vars[0].cols.map((c) => c.v),
  ["1", "3"]
);

// --- an error says where it happened --------------------------------------
assert.strictEqual(runRecorded("const a = [1];\n\nnope();").error.line, 3);
assert.strictEqual(
  runRecorded("function f(){ return g() }\nf();").error.line,
  1,
  "the line is where it threw, not where it was called"
);
const unparseable = runRecorded("const a = [1];\nconst b = [2;");
assert.ok(unparseable.degraded);
assert.strictEqual(unparseable.error.line, 2, "acorn knows where it gave up");

// --- guards ----------------------------------------------------------------
assert.ok(
  runRecorded("const a = visualize([1, 2]); while (true) a[0] = a[1];").capped,
);
const boom = runRecorded("const a = visualize([1, 2]); a[0] = a[1]; nope();");
assert.ok(
  boom.error && boom.frames.length === 3,
  "partial frames survive an error",
);
// plain values pass straight through visualize(); __v() is what tracks them
assert.ifError(runRecorded("visualize(5);").error);
assert.deepStrictEqual(
  runRecorded("const n = 5;\nconst m = n + 1;").frames.map((f) => f.op.name),
  ["n", "m"],
);

console.log(
  `ok — ${sort.frames.length} sort frames, ${count.frames.length} map frames`,
);
