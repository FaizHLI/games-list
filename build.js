#!/usr/bin/env node
// Regenerates index.html, playlist.html and the service worker's file list.
//
// Why this exists: GitHub Pages serves everything with Cache-Control: max-age=600.
// With plain asset URLs a deploy can hand a browser the new HTML while it reuses the
// old app.js from cache - new markup driven by old code, which looks broken rather
// than merely stale. Stamping each asset with a hash of its contents means new HTML
// always requests the JS and CSS that match it.
//
// Run after editing anything in assets/ or data/:  node build.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const rel = p => path.join(ROOT, p);
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(rel(p))).digest("hex").slice(0, 8);

const ASSETS = ["assets/fonts.css", "assets/app.css", "data/games.js", "assets/app.js"];
const V = Object.fromEntries(ASSETS.map(a => [a, a + "?v=" + hash(a)]));

// The service worker has to cache the same versioned URLs the pages ask for, or every
// request misses the cache and offline stops working.
const FONTS = fs.readdirSync(rel("assets/fonts")).filter(f => f.endsWith(".woff2")).sort()
  .map(f => "assets/fonts/" + f);
const SHELL = ["./", "./index.html", "./playlist.html", "./manifest.webmanifest",
  ...ASSETS.map(a => "./" + V[a]), "./assets/icon-192.png", "./assets/icon-512.png",
  ...FONTS.map(f => "./" + f)];

// One cache name derived from every shell file, so any change retires the old cache.
const CACHE = "games-list-" + crypto.createHash("sha256")
  .update(ASSETS.concat(FONTS).map(a => hash(a)).join("")).digest("hex").slice(0, 10);

const TAIL = "Progress is shared with the other list, saves automatically, and can be exported.";
const CANON_NOTE = "Tap a row to mark a game played; the small ▶ marks the one you are playing now. " +
  "Line under each title is the recommended way to play: NSO where available, emulator or ports when the " +
  "game is not on NSO or mods are a meaningful upgrade, remakes only when they are a significant upgrade. " +
  "Scope is home console and PC — mobile and annual sports releases are deliberately out. " + TAIL;
const PLAY_NOTE = "Tap a row to mark a game played; the small ▶ marks the one you are playing now. " +
  "The playlist is a view of the canon: everything that still holds up today. Console view groups Switch 2 " +
  "buys separately (60fps and not meaningfully inferior to PC). NSO where available, emulator or ports when " +
  "the game is not on NSO or mods are a meaningful upgrade. " + TAIL;

function page({ file, title, docTitle, desc, note }) {
  const here = f => file === f;
  const tab = (href, label, on) => `<a class="tab" href="${href}"${on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${docTitle}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#E8EAED" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15171A" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="assets/icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="assets/icon-192.png">
<link rel="preload" href="assets/fonts/public-sans-var-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/press-start-2p-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${V["assets/fonts.css"]}">
<link rel="stylesheet" href="${V["assets/app.css"]}">
<script>/* set an explicit theme before first paint so the choice never flashes */
try{var t=localStorage.getItem("games-list-theme-v1");if(t&&t!=="auto")document.documentElement.setAttribute("data-theme",t);}catch(e){}</script>
</head>
<body data-list="${here("index.html") ? "canon" : "playlist"}">
<div class="wrap">
  <header>
    <h1 class="sr-only">${title}</h1>
    <div class="hrow">
      <nav class="tabs" aria-label="Lists">
        ${tab("./", "CANON", here("index.html"))}
        ${tab("./playlist.html", "PLAYLIST", here("playlist.html"))}
      </nav>
      <div class="count"><b id="nDone">0</b>/<span id="nTotal">0</span></div>
    </div>
    <div class="barwrap"><div class="bar"><div class="fill" id="mainFill"></div><div class="playfill" id="playFill"></div></div></div>
    <p class="stats" id="stats"></p>
    <div class="controls">
      <input type="search" id="search" placeholder="Search titles" aria-label="Search titles">
      <button class="chip" type="button" data-min="0" aria-pressed="true">All</button>
      <button class="chip" type="button" data-min="3" aria-pressed="false">3+</button>
      <button class="chip" type="button" data-min="4" aria-pressed="false">4+</button>
      <button class="chip" type="button" data-min="5" aria-pressed="false">5</button>
      <button class="chip" type="button" id="shuffle" title="Pick a random game from whatever is shown">Pick one</button>
      <button class="chip" type="button" id="toggleFilters" aria-expanded="false" aria-controls="panel" title="Length, platform, sort and hide-played filters">More</button>
    </div>
    <div class="panel" id="panel" hidden>
      <div class="frow">
        <span class="flabel">LENGTH</span>
        <button class="chip" type="button" data-time="0" aria-pressed="true">Any</button>
        <button class="chip" type="button" data-time="5" aria-pressed="false">5h or less</button>
        <button class="chip" type="button" data-time="10" aria-pressed="false">10h or less</button>
        <button class="chip" type="button" data-time="20" aria-pressed="false">20h or less</button>
      </div>
      <div class="frow">
        <span class="flabel">PLATFORM</span>
        <select id="platform" aria-label="Filter by platform"><option value="">All platforms</option></select>
      </div>
      <div class="frow">
        <span class="flabel">SORT</span>
        <button class="chip" type="button" data-view="year" aria-pressed="true">Year</button>
        <button class="chip" type="button" data-view="console" aria-pressed="false">Console</button>
        <button class="chip" type="button" data-view="rating" aria-pressed="false">Rating</button>
      </div>
      <div class="frow">
        <span class="flabel">SHOW</span>
        <button class="chip" type="button" id="hideDone" aria-pressed="false">Hide played</button>
      </div>
    </div>
  </header>

  <main id="list"></main>
  <p class="empty" id="empty">No games match.</p>

  <footer>
    <button class="chip" type="button" id="copyRemaining">Copy remaining</button>
    <button class="chip" type="button" id="copyDone">Copy played</button>
    <button class="chip" type="button" id="exportBtn">Export</button>
    <button class="chip" type="button" id="importBtn">Import</button>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
    <button class="chip" type="button" id="themeBtn">Theme: AUTO</button>
    <p class="note">${note}</p>
  </footer>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script src="${V["data/games.js"]}"></script>
<script src="${V["assets/app.js"]}"></script>
</body>
</html>
`;
}

fs.writeFileSync(rel("index.html"), page({
  file: "index.html", title: "The Canon", docTitle: "The Canon — Checklist",
  desc: "Games worth playing, with the recommended way to play each one.", note: CANON_NOTE }), "utf8");
fs.writeFileSync(rel("playlist.html"), page({
  file: "playlist.html", title: "The Playlist", docTitle: "The Playlist — Worth Playing Today",
  desc: "The games from the canon that still hold up today.", note: PLAY_NOTE }), "utf8");

let sw = fs.readFileSync(rel("sw.js"), "utf8");
sw = sw.replace(/const CACHE = "[^"]*";/, `const CACHE = "${CACHE}";`)
       .replace(/const SHELL = \[[\s\S]*?\n\];/,
         "const SHELL = [\n" + SHELL.map(s => `  "${s}",`).join("\n") + "\n];");
fs.writeFileSync(rel("sw.js"), sw, "utf8");

console.log("built pages with versioned assets:");
for (const a of ASSETS) console.log("  " + V[a]);
console.log("  cache: " + CACHE + " (" + SHELL.length + " shell files)");
