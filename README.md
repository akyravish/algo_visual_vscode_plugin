# algo_visual_vscode_plugin

Watch your JavaScript run. Open a `.js` file, and a panel animates every array,
Map, object and variable in it, step by step, while the executing line lights up
in your editor.

Built for working through data-structures and algorithms problems.

## Install

Build a `.vsix` package and install it into VS Code:

```sh
npx @vscode/vsce package
code --install-extension algo-visual-0.1.0.vsix
```

Reload the VS Code window afterwards (`Developer: Reload Window`). The extension
then works in every window — open a `.js` file and click the pulse icon in the
editor title bar, or run **Algo Visual: Show** from the command palette.

After changing the extension's source, repeat both commands to update the
installed copy — it is a snapshot, not a live link to this folder.

To uninstall:

```sh
code --uninstall-extension local.algo-visual
```

## Developing it

Open this folder in VS Code and press `F5`. That launches an Extension
Development Host window running the extension straight from source — edits show
up on the next reload (`Ctrl+R`) with no packaging step. There is one example
per shape to try it on:

| File               | What it draws                                           |
| ------------------ | ------------------------------------------------------- |
| `example.js`       | strings and a growing array                             |
| `example-sort.js`  | bubble sort over one array                              |
| `example-tree.js`  | a binary search tree, as nodes and arrows               |
| `example-graph.js` | BFS over an adjacency `Map`, with queue and visited set |
| `example-hash.js`  | two sum: O(n²) loops, then the same answer via a `Map`  |
| `example-heap.js`  | a min-heap sifting up and down inside a flat array      |

## Using it

Write normal JavaScript. There is nothing to add:

```js
const nums = [5, 3, 8, 1];

for (let i = 0; i < nums.length; i++) {
  for (let j = 0; j < nums.length - i - 1; j++) {
    if (nums[j] > nums[j + 1]) {
      const t = nums[j];
      nums[j] = nums[j + 1];
      nums[j + 1] = t;
    }
  }
}
```

Every declared array, object, `Map` and `Set` is tracked automatically, along
with plain values, strings, loop counters and function parameters. Save the
file to re-run; playback holds its place across saves.

Watching only one thing? Wrap it yourself — one explicit call switches the
automatic tracking off entirely:

```js
const nums = visualize([5, 3, 8, 1]);
```

## What you see

|                             |                                                                |
| --------------------------- | -------------------------------------------------------------- |
| Arrays                      | boxes with indices; blue = being read, orange = just written   |
| Nested arrays               | a grid, or a strip of slots when each row holds one item       |
| Maps, Sets, objects         | key tile sitting on its value tile                             |
| Objects pointing at objects | nodes and arrows — linked lists, trees, graphs                 |
| Plain values and strings    | chips, grouped in one strip per call                           |
| Calls                       | an indented slab per frame, so recursion nests visibly         |
| Returns                     | a `→` chip holding what the call handed back                   |
| Conditions                  | `arr[j] > arr[j + 1] → true`, in the panel and beside the line |
| Errors                      | the failing line marked red in the editor, with the message    |
| Work done                   | a running tally of reads, writes, comparisons and calls        |

Playback has three granularities — the mode button cycles **By access** (one
memory operation per step), **By line**, and **Over calls** (a whole function
call is one step). `⟲` restarts. Click any line in your editor to jump the
timeline to the first step that ran it. Arrow keys step, space plays.

## How it works

No debugger, no interpreter, no stepping.

1. **`media/rewrite.js`** parses your file with acorn and edits it so it narrates
   itself — declarations are offered to `visualize()`, assignments report their
   new value, functions announce entry and exit, conditions report their verdict.
   Every edit is an insertion with no newline in it, so line numbers still match
   the file you wrote.
2. **`media/recorder.js`** runs that code with structures wrapped in a `Proxy`.
   Every read and write trips a trap and becomes a frame holding a snapshot of
   every tracked variable. The source line comes out of `new Error().stack`.
3. **`media/main.js`** plays the frames back. Since the whole run is recorded
   before anything is drawn, scrubbing, stepping backwards and speed are free.

## Limits

- Synchronous JavaScript only — no `async`/`await`, no generators.
- Every frame snapshots every tracked structure, so this is built for
  teaching-sized data, not for sorting ten thousand items.
- Recording stops at 20,000 steps, which is also what saves you from an
  endless loop.
- The panel runs your code with `new Function`, which needs `'unsafe-eval'` in
  its content-security policy. Fine for a file you opened yourself; it is the
  thing to fix before ever publishing this to the Marketplace.

## Tests

```
node test.js
```

Covers the recorder end to end: tracking, scoping, recursion, nested structures,
graph walking, return values, error locations and the rewriting rules.

## Third party

`media/vendor/acorn.js` is [acorn](https://github.com/acornjs/acorn) 8.18.0, MIT
licensed — see `media/vendor/acorn-LICENSE`. Nothing else is required to run this.
