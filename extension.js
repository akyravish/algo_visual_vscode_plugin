const vscode = require("vscode");

let panel;
let sourceUri; // the file the panel is currently animating

const running = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: "rgba(88, 166, 108, 0.20)",
  borderWidth: "0 0 0 3px",
  borderStyle: "solid",
  borderColor: "rgba(88, 166, 108, 0.9)",
  after: {
    color: "rgba(140, 190, 160, 0.85)",
    fontStyle: "italic",
    margin: "0 0 0 2em",
  },
});

// where the run blew up, if it did
const failed = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: "rgba(224, 112, 90, 0.16)",
  borderWidth: "0 0 0 3px",
  borderStyle: "solid",
  borderColor: "rgba(224, 112, 90, 0.9)",
  after: { color: "rgba(230, 150, 130, 0.95)", fontStyle: "italic", margin: "0 0 0 2em" },
});

const sourceEditor = () =>
  vscode.window.visibleTextEditors.find(
    (e) => String(e.document.uri) === String(sourceUri),
  );

function highlight(line, note) {
  const editor = sourceEditor();
  if (!editor) return;
  if (!(line > 0 && line <= editor.document.lineCount))
    return editor.setDecorations(running, []);
  editor.setDecorations(running, [
    {
      range: new vscode.Range(line - 1, 0, line - 1, 0),
      renderOptions: note ? { after: { contentText: note } } : undefined,
    },
  ]);
}

function showError(err) {
  const editor = sourceEditor();
  if (!editor) return;
  const known = err && err.line > 0 && err.line <= editor.document.lineCount;
  editor.setDecorations(
    failed,
    known
      ? [
          {
            range: new vscode.Range(err.line - 1, 0, err.line - 1, 0),
            renderOptions: { after: { contentText: err.message } },
          },
        ]
      : [],
  );
  if (err && !known) vscode.window.showErrorMessage(`Algo Visual: ${err.message}`);
}

function activate(context) {
  const send = (doc) => {
    sourceUri = doc.uri;
    panel.webview.postMessage({ code: doc.getText() });
  };

  context.subscriptions.push(
    running,
    failed,

    vscode.commands.registerCommand("algoVisual.show", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Algo Visual: open a .js file first.");
        return;
      }
      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          "algoVisual",
          "Algo Visual",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            localResourceRoots: [
              vscode.Uri.joinPath(context.extensionUri, "media"),
            ],
          },
        );
        panel.webview.html = html(panel.webview, context.extensionUri);
        panel.webview.onDidReceiveMessage((m) => {
          if ("error" in m) showError(m.error);
          else highlight(m.line, m.note);
        });
        panel.onDidDispose(() => {
          highlight(0);
          showError(null);
          panel = undefined;
        });
      }
      panel.reveal(vscode.ViewColumn.Beside, true);
      send(editor.document);
    }),

    // re-run on every save, so the panel tracks the file you're editing
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (panel && doc.languageId === "javascript") send(doc);
    }),

    // click a line in the file → jump the timeline to the first step that ran it
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!panel || e.kind !== vscode.TextEditorSelectionChangeKind.Mouse)
        return;
      if (String(e.textEditor.document.uri) !== String(sourceUri)) return;
      panel.webview.postMessage({ jump: e.selections[0].active.line + 1 });
    }),
  );
}

function html(webview, extensionUri) {
  const uri = (f) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", f));
  // 'unsafe-eval' is what lets the panel run your code via new Function().
  // ponytail: acceptable because it only ever runs a file you opened yourself.
  // This is the one thing to fix before publishing to the Marketplace.
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-eval';`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  /* Labels are chrome: tiny, tracked, quiet. Values are the content: mono and loud.
     Tiles carry no border by default — a border means the code touched this cell. */
  :root {
    --tile: rgba(127, 127, 127, .16);
    --slab: rgba(127, 127, 127, .07);
    --rule: rgba(127, 127, 127, .28);
    --read: #4a9eda;
    --write: #e0705a;
    --key: #c08a3e;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 18px 18px 0;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
  }

  .label, .fname, .idx, .rowlabel, .void, #status {
    font-size: 10px; font-weight: 600;
    letter-spacing: .09em; text-transform: uppercase;
  }
  .tile, .val {
    font-family: var(--vscode-editor-font-family);
    font-variant-numeric: tabular-nums;
    font-size: 16px; line-height: 1;
  }

  /* the stack, drawn as containment */
  #stage { display: flex; flex-direction: column; gap: 10px; padding-bottom: 18px; }
  .slab { display: flex; flex-direction: column; gap: 14px; }
  /* structures sit side by side and wrap, so a wide panel is a wide diagram */
  .structs {
    display: flex; flex-wrap: wrap; align-items: flex-start; align-content: flex-start;
    gap: 16px 28px;
  }
  .structs:empty, .strip:empty { display: none; }
  .slab.dim { opacity: .45; transition: opacity .2s; }
  .slab.nested {
    padding: 10px 0 12px 14px;
    border-left: 2px solid var(--rule);
    background: var(--slab);
    border-radius: 0 6px 6px 0;
  }
  .fname { opacity: .5; letter-spacing: .12em; }
  .block.enter, .chip.enter { animation: rise .28s ease-out; }
  .label { opacity: .55; margin-bottom: 6px; }

  .row { display: flex; gap: 5px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 3px; }
  .col { display: flex; flex-direction: column; }
  .tile {
    min-width: 44px; padding: 11px 9px; text-align: center;
    background: var(--tile); border: 1px solid transparent; border-radius: 5px;
  }
  .idx { text-align: center; opacity: .4; padding-top: 4px; letter-spacing: .05em; }

  /* map and object: key sits on its value, one object in two halves */
  .pair .tile:first-child {
    background: var(--key); color: #17140f; border-radius: 5px 5px 0 0;
  }
  .pair .tile:last-child { border-radius: 0 0 5px 5px; margin-top: 1px; }

  .rowlabel { min-width: 16px; padding: 14px 6px 0 0; text-align: right; opacity: .4; }
  /* an empty slot is a tile-shaped hole, so indices stay aligned across the row */
  .void {
    min-width: 44px; height: 38px;
    border: 1px dashed var(--rule); border-radius: 5px; opacity: .4;
  }
  .row.grid .void { height: 30px; }
  /* grid rows stack, so they get to be shorter than a standalone array */
  .row.grid { margin-bottom: 1px; }
  .row.grid .tile { padding: 7px 9px; font-size: 14px; }
  .row.grid .rowlabel { padding-top: 10px; }

  /* a border only ever means: the code is here */
  .col.here .tile { box-shadow: inset 0 -3px 0 var(--read); }
  .col.read  .tile:not(.key) { border-color: var(--read);  background: rgba(74, 158, 218, .22); }
  .col.write .tile:not(.key) { border-color: var(--write); background: rgba(224, 112, 90, .26); }
  .col.enter { animation: rise .28s ease-out; }
  .col.pulse .tile { animation: flash .45s ease-out; }

  /* plain values ride together, one row for all of them */
  .strip { display: flex; gap: 7px; flex-wrap: wrap; }
  .chip {
    display: flex; align-items: baseline; gap: 8px;
    padding: 7px 11px; border-radius: 5px;
    background: var(--tile); border: 1px solid transparent;
  }
  .chip .label { margin: 0; opacity: .5; }
  .chip.hit { border-color: var(--read); }
  .chip.pulse { animation: flash .45s ease-out; }

  @keyframes rise  { from { transform: translateY(4px) scale(.94); opacity: 0 } }
  @keyframes flash { from { background: rgba(224, 112, 90, .55) } }

  svg { overflow: visible; }
  .node rect { fill: var(--tile); stroke: none; }
  .node text {
    fill: var(--vscode-foreground); font-size: 11px; text-anchor: middle;
    font-family: var(--vscode-editor-font-family);
  }
  .node text.big { font-size: 17px; }
  .node.hit rect { fill: rgba(224, 112, 90, .26); stroke: var(--write); }
  .node.enter { animation: rise .3s ease-out; transform-box: fill-box; transform-origin: center; }
  .edge { stroke: var(--vscode-foreground); stroke-opacity: .45; }
  .head { fill: var(--vscode-foreground); fill-opacity: .45; }
  .elabel { fill: var(--vscode-foreground); fill-opacity: .45; font-size: 10px; text-anchor: middle; }

  /* controls stay put while the diagram scrolls */
  #bar {
    position: sticky; bottom: 0; margin: 0 -18px; padding: 10px 18px 12px;
    background: var(--vscode-editor-background); border-top: 1px solid var(--rule);
  }
  #controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  button {
    font: inherit; font-size: 12px; cursor: pointer; border: none; border-radius: 4px;
    padding: 5px 11px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--read); outline-offset: 2px; }
  #scrub { display: block; width: 100%; margin: 0 0 8px; }
  #speed { width: 96px; }
  #controls label { font-size: 10px; letter-spacing: .09em; text-transform: uppercase; opacity: .5; }
  #status { display: flex; gap: 10px; margin-top: 8px; opacity: .6; flex-wrap: wrap; }
  .step { opacity: .7; }
  .tally { margin-left: auto; opacity: .8; }
  .said { text-transform: none; letter-spacing: .02em; font-weight: 400; font-size: 11px; }

  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>
</head>
<body>
  <div id="stage"></div>
  <div id="bar">
    <input id="scrub" type="range" min="0" max="0" value="0" aria-label="Step">
    <div id="controls">
      <button id="play">▶ Play</button>
      <button id="prev" title="Previous step">◀</button>
      <button id="next" title="Next step">▶</button>
      <button id="mode" title="Step one memory access, or one whole line">By access</button>
      <label for="speed">Speed</label>
      <input id="speed" type="range" min="1" max="60" value="4">
    </div>
    <div id="status"><span class="said">Open a .js file and run Algo Visual: Show.</span></div>
  </div>
  <script src="${uri("vendor/acorn.js")}"></script>
  <script src="${uri("rewrite.js")}"></script>
  <script src="${uri("recorder.js")}"></script>
  <script src="${uri("main.js")}"></script>
</body>
</html>`;
}

module.exports = { activate, deactivate() {} };
