// Rewrites your code so it can narrate itself, using acorn's syntax tree.
//
// Every edit is an insertion at an exact offset and never contains a newline, so
// the rewritten file has the same line numbers as the one you wrote. Four jobs:
//
//   visualize(x)  wraps declared structures so the recorder can proxy them
//   __v('x', x)   reports a plain value after it is declared or assigned
//   __in / __out  mark a call's start and end, so variables live and die with it
//   __ret(x)      captures what a function hands back
//
// Runs in the webview (acorn on the global) and in node (acorn required).

const acornLib =
  typeof acorn !== "undefined" ? acorn : require("./vendor/acorn.js");

const PARSE = {
  ecmaVersion: 2022,
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
};

// Walk every node, depth first, handing each one its parent.
function walk(node, visit, parent) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walk(c, visit, node);
    else walk(child, visit, node);
  }
}

// Identifiers a binding introduces: `x`, `[a, b]`, `{ a, b }`, `...rest`.
const bound = (node, out = []) => {
  if (!node) return out;
  if (node.type === "Identifier") out.push(node.name);
  else if (node.type === "ArrayPattern")
    node.elements.forEach((e) => bound(e, out));
  else if (node.type === "ObjectPattern")
    node.properties.forEach((p) => bound(p.value || p.argument, out));
  else if (node.type === "AssignmentPattern") bound(node.left, out);
  else if (node.type === "RestElement") bound(node.argument, out);
  else if (node.type === "VariableDeclaration")
    node.declarations.forEach((d) => bound(d.id, out));
  return out;
};

const report = (names) =>
  names.map((n) => ` __v(${JSON.stringify(n)}, ${n});`).join("");

const isVisualizeCall = (n) =>
  n &&
  n.type === "CallExpression" &&
  n.callee.type === "Identifier" &&
  n.callee.name === "visualize";

// The name a function should be announced under. Class methods get their class,
// so a frame reads `ListNode.push()` or `new ListNode()` rather than `(anonymous)`.
const keyName = (k) => (k.type === "Identifier" ? k.name : String(k.value));

function fnName(node, parents) {
  if (node.id && node.id.name) return node.id.name;
  const p = parents.get(node);
  if (!p) return "(anonymous)";
  if (p.type === "MethodDefinition" || p.type === "PropertyDefinition") {
    const cls = parents.get(parents.get(p)); // ClassBody → the class itself
    const owner = (cls && cls.id && cls.id.name) || "";
    if (p.kind === "constructor") return owner ? `new ${owner}` : "constructor";
    const name = keyName(p.key);
    return owner ? `${owner}.${name}` : name;
  }
  if (p.type === "VariableDeclarator" && p.id.type === "Identifier") return p.id.name;
  if (p.type === "Property") return keyName(p.key);
  if (p.type === "AssignmentExpression" && p.left.type === "MemberExpression")
    return keyName(p.left.property);
  return "(anonymous)";
}

function rewrite(src) {
  const ast = acornLib.parse(src, PARSE);
  const edits = []; // { at, text } — insertion points, applied right to left
  const add = (at, text) => edits.push({ at, text });

  // First pass: remember every node's parent, and notice explicit visualize() calls.
  // Auto-wrapping is off as soon as you call it yourself.
  const parents = new WeakMap();
  let explicit = false;
  walk(ast, (n, p) => {
    if (p) parents.set(n, p);
    if (isVisualizeCall(n)) explicit = true;
  });

  // The source of a condition, so the panel can show what was tested.
  const snippet = (n) => src.slice(n.start, n.end).replace(/\s+/g, " ").slice(0, 60);

  walk(ast, (node, parent) => {
    // --- functions: announce the call, unwind on the way out
    const isFn =
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";
    if (isFn && node.body.type === "BlockStatement") {
      const params = node.params
        .map((p) => (p.type === "AssignmentPattern" ? p.left : p)) // str = 'default'
        .filter((p) => p.type === "Identifier")
        .map((p) => p.name);
      const args = params.map((p) => `${p}: ${p}`).join(", ");
      add(
        node.body.start + 1,
        ` __in(${JSON.stringify(fnName(node, parents))}, {${args}}); try {`,
      );
      add(node.body.end - 1, ` } finally { __out(); } `);
      return;
    }

    // --- what a function hands back
    if (node.type === "ReturnStatement" && node.argument) {
      add(node.argument.start, "__ret(");
      add(node.argument.end, ")");
      return;
    }

    // --- conditions: report what was tested and how it came out.
    // A `for` header is bookkeeping, not a decision, so it stays quiet.
    const test =
      node.type === "IfStatement" ||
      node.type === "WhileStatement" ||
      node.type === "DoWhileStatement" ||
      node.type === "ConditionalExpression"
        ? node.test
        : null;
    if (test) {
      add(test.start, "__if(");
      add(test.end, `, ${JSON.stringify(snippet(test))})`);
    }

    // --- loop bindings, reported once per iteration
    const loop =
      node.type === "ForOfStatement" || node.type === "ForInStatement"
        ? node.left
        : node.type === "ForStatement"
          ? node.init
          : null;
    if (loop && node.body.type === "BlockStatement") {
      const names = loop.type === "VariableDeclaration" ? bound(loop) : [];
      if (names.length) add(node.body.start + 1, report(names));
      return;
    }

    // --- declarations: offer structures to visualize(), report plain values
    if (node.type === "VariableDeclaration") {
      // a declaration in a for-header is the loop's business, not ours
      if (parent && /^For/.test(parent.type) && parent.body !== node) return;
      const names = [];
      for (const d of node.declarations) {
        if (!d.init) continue;
        if (d.id.type !== "Identifier") {
          names.push(...bound(d.id)); // `const [x, y] = …`: report each binding
          continue;
        }
        names.push(d.id.name);
        if (isVisualizeCall(d.init) && d.init.arguments.length === 1) {
          add(d.init.arguments[0].end, `, ${JSON.stringify(d.id.name)}`); // name it for free
        } else if (!explicit && !isFnNode(d.init)) {
          add(d.init.start, `visualize(`);
          add(d.init.end, `, ${JSON.stringify(d.id.name)})`);
        }
      }
      if (names.length)
        add(node.end, `${src[node.end - 1] === ";" ? "" : ";"}${report(names)}`);
      return;
    }

    // --- plain assignments: x = …, x += …, x++, and [a, b] = [b, a].
    // bound() skips member expressions like arr[i], which the Proxy already sees.
    if (node.type === "ExpressionStatement") {
      const e = node.expression;
      const target =
        (e.type === "AssignmentExpression" && e.left) ||
        (e.type === "UpdateExpression" && e.argument);
      const names = target ? bound(target) : [];
      if (names.length) add(node.end, `;${report(names)}`);
    }
  });

  // right to left, so earlier offsets stay valid
  edits.sort((a, b) => b.at - a.at || b.text.length - a.text.length);
  let out = src;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return out;
}

const isFnNode = (n) =>
  n.type === "FunctionExpression" ||
  n.type === "ArrowFunctionExpression" ||
  n.type === "ClassExpression";

if (typeof module !== "undefined") module.exports = { rewrite };
