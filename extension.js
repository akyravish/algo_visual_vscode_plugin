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
  /* Labels are chrome: tiny, tracked, quiet. Values are the content: mono, loud,
     tabular. Tiles carry no border at rest — a border or glow means the code
     touched this cell, and nothing else is allowed to glow. */
  :root {
    --tile: color-mix(in srgb, var(--vscode-foreground) 9%, transparent);
    --tile-edge: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    --slab: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    --rule: color-mix(in srgb, var(--vscode-foreground) 22%, transparent);
    --ink: var(--vscode-foreground);
    --read: #58a6e8;
    --write: #e8785e;
    --key: #d29a4a;
    --ok: #58ba7d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px 20px 0;
    font-family: var(--vscode-font-family);
    color: var(--ink);
  }

  .label, .fname, .idx, .rowlabel, #status, #controls label {
    font-size: 9.5px; font-weight: 650;
    letter-spacing: .11em; text-transform: uppercase;
  }
  .tile, .val, .step {
    font-family: var(--vscode-editor-font-family);
    font-variant-numeric: tabular-nums;
  }

  /* ---- the stack, drawn as containment ---- */
  #stage { display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px; }
  .slab { display: flex; flex-direction: column; gap: 14px; }
  .slab.nested {
    padding: 12px 14px 14px 16px;
    border-left: 2px solid var(--ok);
    background: var(--slab);
    border-radius: 4px 10px 10px 4px;
  }
  .slab.dim { opacity: .38; filter: saturate(.6); transition: opacity .25s, filter .25s; }
  .fname { color: var(--ok); letter-spacing: .14em; }
  .fname::before { content: "▸ "; opacity: .7; }

  .structs {
    display: flex; flex-wrap: wrap; align-items: flex-start; align-content: flex-start;
    gap: 18px 30px;
  }
  .structs:empty, .strip:empty { display: none; }
  .block.enter, .chip.enter { animation: rise .3s cubic-bezier(.2, .9, .3, 1.3); }
  .label { opacity: .5; margin-bottom: 7px; }

  /* ---- cells ---- */
  .row { display: flex; gap: 5px; flex-wrap: wrap; align-items: flex-start; }
  .col { display: flex; flex-direction: column; }
  .tile {
    min-width: 46px; padding: 12px 10px; text-align: center;
    font-size: 16.5px; line-height: 1;
    background: linear-gradient(var(--tile-edge), var(--tile));
    border: 1px solid transparent; border-radius: 7px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .18);
  }
  .idx { text-align: center; opacity: .38; padding-top: 5px; letter-spacing: .06em; }

  /* map and object: the key sits on its value, one object in two halves */
  .pair .tile:first-child {
    background: linear-gradient(color-mix(in srgb, var(--key) 92%, white), var(--key));
    color: #201a10; font-weight: 650; font-size: 14px;
    border-radius: 7px 7px 0 0; padding: 9px 10px;
  }
  .pair .tile:last-child { border-radius: 0 0 7px 7px; margin-top: 1px; }

  .rowlabel { min-width: 18px; padding: 15px 7px 0 0; text-align: right; opacity: .38; }
  .void {
    min-width: 46px; height: 41px;
    border: 1.5px dashed var(--rule); border-radius: 7px; opacity: .45;
    box-shadow: none; background: none;
  }
  .row.grid { margin-bottom: 2px; }
  .row.grid .tile { padding: 8px 10px; font-size: 14px; }
  .row.grid .void { height: 32px; }
  .row.grid .rowlabel { padding-top: 11px; }

  /* ---- a border only ever means: the code is here ---- */
  .col.here .tile:not(.key) { box-shadow: inset 0 -3px 0 var(--read), 0 1px 2px rgba(0,0,0,.18); }
  .col.read .tile:not(.key) {
    border-color: var(--read);
    background: color-mix(in srgb, var(--read) 24%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--read) 18%, transparent);
  }
  .col.write .tile:not(.key) {
    border-color: var(--write);
    background: color-mix(in srgb, var(--write) 26%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--write) 20%, transparent);
  }
  .col.enter { animation: rise .3s cubic-bezier(.2, .9, .3, 1.3); }
  .col.pulse .tile { animation: flash .5s ease-out; }

  /* ---- plain values: one strip of pills ---- */
  .strip { display: flex; gap: 8px; flex-wrap: wrap; }
  .chip {
    display: flex; align-items: baseline; gap: 9px;
    padding: 8px 13px; border-radius: 999px;
    background: linear-gradient(var(--tile-edge), var(--tile));
    border: 1px solid transparent;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .15);
  }
  .chip .label { margin: 0; opacity: .5; }
  .chip .val { font-size: 15px; }
  .chip.hit {
    border-color: var(--read);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--read) 16%, transparent);
  }
  .chip.pulse { animation: flash .5s ease-out; }

  @keyframes rise  { from { transform: translateY(5px) scale(.9); opacity: 0 } }
  @keyframes flash { from { background: color-mix(in srgb, var(--write) 55%, transparent) } }

  /* ---- nodes and arrows ---- */
  svg { overflow: visible; }
  .node rect {
    fill: var(--tile); stroke: var(--tile-edge);
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .2));
  }
  .node text {
    fill: var(--ink); font-size: 11px; text-anchor: middle;
    font-family: var(--vscode-editor-font-family);
  }
  .node text.big { font-size: 17px; }
  .node.hit rect {
    fill: color-mix(in srgb, var(--write) 24%, transparent);
    stroke: var(--write); stroke-width: 1.5;
  }
  .node.enter { animation: rise .32s ease-out; transform-box: fill-box; transform-origin: center; }
  .edge { stroke: var(--ink); stroke-opacity: .4; }
  .head { fill: var(--ink); fill-opacity: .4; }
  .elabel { fill: var(--ink); fill-opacity: .45; font-size: 10px; text-anchor: middle; }

  /* ---- transport, pinned while the diagram scrolls ---- */
  #bar {
    position: sticky; bottom: 0; margin: 0 -20px; padding: 12px 20px 14px;
    background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
    backdrop-filter: blur(6px);
    border-top: 1px solid var(--rule);
  }
  #scrub { display: block; width: 100%; margin: 0 0 10px; accent-color: var(--read); }
  #speed { accent-color: var(--read); width: 96px; }
  input[type="range"] { height: 14px; cursor: pointer; }
  #controls { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  button {
    font: inherit; font-size: 12px; cursor: pointer;
    border: 1px solid var(--rule); border-radius: 6px;
    padding: 5px 12px;
    background: var(--tile); color: var(--ink);
    transition: background .12s, border-color .12s;
  }
  button:hover { background: color-mix(in srgb, var(--vscode-foreground) 16%, transparent); }
  #play {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border-color: transparent; min-width: 76px;
  }
  #play:hover { background: var(--vscode-button-hoverBackground); }
  #mode { font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--read); outline-offset: 2px; }
  #controls label { opacity: .45; margin-left: auto; }
  #status { display: flex; align-items: baseline; gap: 12px; margin-top: 9px; flex-wrap: wrap; }
  .step { font-size: 11px; opacity: .55; }
  .said {
    text-transform: none; letter-spacing: .02em; font-weight: 400; font-size: 11.5px;
    opacity: .75;
  }
  .tally { margin-left: auto; opacity: .6; font-size: 9.5px; }

  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
  <div id="stage"></div>
  <div id="bar">
    <input id="scrub" type="range" min="0" max="0" value="0" aria-label="Step">
    <div id="controls">
      <button id="play">▶ Play</button>
      <button id="restart" title="Back to the start">⟲</button>
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
