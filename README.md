# algo_visual_vscode_plugin

Watch your JavaScript run. Open a `.js` file, and a panel animates every array,
Map, object and variable in it, step by step, while the executing line lights up
in your editor.

Built for working through data-structures and algorithms problems.

## Running it

Open this folder in VS Code and press `F5`. In the window that opens, open
`example.js` (or `example-sort.js`, `example-tree.js`) and run
**Algo Visual: Show** from the command palette. Save the file to re-run.

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
with plain values, loop counters and function parameters.

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
| Strings                     | characters with indices                                        |
| Plain values                | chips, grouped in one strip per call                           |
| Calls                       | an indented slab per frame, so recursion nests visibly         |
| Returns                     | a `→` chip holding what the call handed back                   |
| Conditions                  | `arr[j] > arr[j + 1] → true`, in the panel and beside the line |
| Work done                   | a running tally of reads, writes, comparisons and calls        |

Playback runs one memory access at a time, or one whole line — the **By access /
By line** button switches. Click any line in your editor to jump the timeline to
the first step that ran it. Arrow keys step, space plays.

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
