// The playlist is a derived view of the same data: the games flagged in field 7.
const LIST = document.body.dataset.list || "canon";
const DATA = LIST === "playlist" ? window.GAMES.filter(g => g[6]) : window.GAMES;
const CONSOLE_ORDER = ["Arcade","Atari 2600","MSX","NES","Master System","PC Engine","Game Boy","Genesis","Game Gear","SNES","Sega CD","DOS","PS1","Saturn","N64","Dreamcast","GBA","GameCube","PS2","Xbox","DS","PSP","Wii","Xbox 360","PS3","3DS","Vita","Wii U","PS4","Switch 2","PS5","PC (Steam)","PC (Other)"];

const STORAGE_KEY = "games-list-progress-v1";
const PREFS_KEY = "games-list-prefs-v1";
const THEME_KEY = "games-list-theme-v1";

const PLAYING = 1, DONE = 2;
const keyOf = g => g[0] + "|" + g[1];

// key -> PLAYING | DONE. Absent means untouched.
let progress = new Map();
// key -> 1..10, your own score in half stars (7 is 3.5 stars), the Backloggd scale.
// Absent means you haven't rated it, and the community score stands.
let ratings = new Map();
// keys of the games you own, on any platform
let owned = new Set();
// keys of the games you're thinking of buying; the cart totals their prices
let cart = new Set();
let minRating = 0, maxTime = 0, platform = "", query = "", view = "year", hideDone = false;
let ownFilter = "";   // "" any, "y" owned only, "n" not owned
// price filter: maxPrice is a ceiling on the best price now (0 = any), atLowOnly keeps
// games whose price is at its lowest ever. Either one hides games with no price.
let maxPrice = 0, atLowOnly = false;
let saveTimer = null;
let sections = []; // {indices, countEl, secEl}

const list = document.getElementById("list");
const $ = id => document.getElementById(id);

function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
// titles carry apostrophes ("Yoshi's Island"), so anything interpolated into an
// attribute has to escape quotes too or the markup breaks
function escAttr(s){ return esc(s).replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

// "∞" means endless: it has no hours to count down and no upper bound to filter on
const hoursOf = g => g[5] === "∞" ? null : (parseFloat(g[5]) || 0);
const num = n => n.toLocaleString("en-US");
// Every rating is in stars, 0.5 to 5. There are two, kept apart everywhere: the
// community score, IGDB's user average (data/scores.js, 0-100) where it has one and
// the list's own 1-5 where it doesn't, and yours, null until you rate the game.
const SCORES = window.SCORES || {};
const communityOf = g => { const s = SCORES[keyOf(g)]; return s ? s.s / 20 : g[2]; };
const mineOf = g => { const h = ratings.get(keyOf(g)); return h ? h / 2 : null; };
// "4" for whole stars, "4.5" for halves, "4.3" for an average
const fmtStars = x => (Math.round(x * 10) / 10).toFixed(Number.isInteger(Math.round(x * 10) / 10) ? 0 : 1);

/* ---------- storage ---------- */

function serialize(){
  return JSON.stringify({ v: 3, s: Object.fromEntries(progress), r: Object.fromEntries(ratings), o: [...owned], c: [...cart] });
}
// Accepts the v1 format (a flat array of done keys), v2 (states only) and v3 (states,
// and optionally ratings, owned games and the cart), so progress saved by any earlier
// version still loads, as does an export file. Returns {state, ratings, owned, cart}, or
// null if this isn't progress at all.
function parseProgress(raw){
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  let m;
  const r = new Map(), o = new Set(), c = new Set();
  if (Array.isArray(data)) m = new Map(data.map(k => [k, DONE]));
  else {
    const s = data && (data.s || data.state);
    if (!s || typeof s !== "object") return null;
    m = new Map();
    for (const [k, v] of Object.entries(s)) {
      const n = +v;
      if (n === PLAYING || n === DONE) m.set(k, n);
    }
    for (const [k, v] of Object.entries(data.r || {})) {
      const n = +v;
      if (n >= 1 && n <= 10 && Number.isInteger(n)) r.set(k, n);
    }
    if (Array.isArray(data.o)) for (const k of data.o) if (typeof k === "string") o.add(k);
    if (Array.isArray(data.c)) for (const k of data.c) if (typeof k === "string") c.add(k);
  }
  // a game renamed or re-dated since this was saved keeps its state under the new key
  for (const [from, to] of Object.entries(window.RENAMED || {})) {
    for (const map of [m, r]) {
      if (!map.has(from)) continue;
      if (!map.has(to)) map.set(to, map.get(from));
      map.delete(from);
    }
    for (const set of [o, c]) if (set.has(from)) { set.delete(from); set.add(to); }
  }
  return { state: m, ratings: r, owned: o, cart: c };
}

function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
// A change made just before leaving would otherwise wait out the debounce and be lost.
function flushSave(){
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  save();
}
addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
async function save(){
  saveTimer = null;
  const payload = serialize();
  try {
    if (window.storage) await window.storage.set(STORAGE_KEY, payload);
    else localStorage.setItem(STORAGE_KEY, payload);
  } catch(e){ console.error("Save failed", e); }
}
async function load(){
  let rewrite = false;
  try {
    let raw = null;
    if (window.storage) {
      const res = await window.storage.get(STORAGE_KEY);
      raw = res && res.value;
    } else {
      raw = localStorage.getItem(STORAGE_KEY);
    }
    if (raw) {
      const parsed = parseProgress(raw);
      if (parsed) { progress = parsed.state; ratings = parsed.ratings; owned = parsed.owned; cart = parsed.cart; rewrite = serialize() !== raw; }
    }
  } catch(e){ /* first run, or storage blocked */ }
  // your scores only arrive now, and the rating filter and sort both depend on them
  if (view === "mine") render(); else { applyState(); applyFilter(); }
  paintCartBtn();
  // rewrite v1 data in the current format, so the playing state has somewhere to live,
  // and renamed games under their new keys
  if (rewrite) save();
}
// both lists share one store, so keep an open tab of the other page in sync
window.addEventListener("storage", e => {
  if (e.key !== STORAGE_KEY || e.newValue == null) return;
  try {
    const m = parseProgress(e.newValue);
    if (m) { progress = m.state; ratings = m.ratings; owned = m.owned; cart = m.cart; applyState(); applyFilter(); paintCartBtn(); }
  } catch(err){}
});

/* ---------- filter state in the URL, so a view can be shared ---------- */

function readPrefs(){
  const p = new URLSearchParams(location.search);
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch(e){}
  // an explicit URL wins over what this browser last used
  const pick = (k, fallback) => p.has(k) ? p.get(k) : (stored[k] !== undefined ? stored[k] : fallback);
  query = String(pick("q", "")).toLowerCase();
  minRating = +pick("r", 0) || 0;
  // a link or saved view from the old 3+/4+/5 chips falls back to no rating filter
  if (![0, 4, 4.25, 4.5].includes(minRating)) minRating = 0;
  maxTime = +pick("t", 0) || 0;
  platform = String(pick("p", ""));
  view = ["year","console","rating","mine","price"].includes(pick("v", "year")) ? pick("v", "year") : "year";
  hideDone = String(pick("h", "")) === "1";
  ownFilter = ["y","n"].includes(pick("o", "")) ? pick("o", "") : "";
  maxPrice = [5, 10, 20].includes(+pick("pr", 0)) ? +pick("pr", 0) : 0;
  atLowOnly = String(pick("lo", "")) === "1";
}
function writePrefs(){
  const p = new URLSearchParams();
  if (query) p.set("q", query);
  if (minRating) p.set("r", minRating);
  if (maxTime) p.set("t", maxTime);
  if (platform) p.set("p", platform);
  if (view !== "year") p.set("v", view);
  if (hideDone) p.set("h", "1");
  if (ownFilter) p.set("o", ownFilter);
  if (maxPrice) p.set("pr", maxPrice);
  if (atLowOnly) p.set("lo", "1");
  const qs = p.toString();
  history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ q: query, r: minRating, t: maxTime, p: platform, v: view, h: hideDone ? "1" : "", o: ownFilter, pr: maxPrice, lo: atLowOnly ? "1" : "" }));
  } catch(e){}
}

/* ---------- render ---------- */

function makeRow(i, showYearInMethod){
  const g = DATA[i];
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.i = i;
  // the row opens the game's panel; the checkbox is the one-tap "played"
  row.setAttribute("role","button");
  row.setAttribute("aria-haspopup","dialog");
  row.setAttribute("tabindex","0");
  let method = showYearInMethod ? (g[0] + " · " + g[3]) : g[3];
  // sorted by price, the price leads the line, since it is what the list is ordered by
  if (view === "price" && nowPrice(g) != null) method = money(nowPrice(g)) + " · " + method;
  row.innerHTML =
    "<button class='box' type='button' role='checkbox' aria-checked='false' " +
      "aria-label='Played " + escAttr(g[1]) + "'>&#10003;</button>" +
    "<div class='titles'><span class='title'>" + esc(g[1]) + "</span>" +
    "<div class='method'><span class='own' hidden>OWNED</span><span class='own low' hidden>LOWEST</span>" + esc(method) + "</div></div>" +
    "<button class='mark' type='button' aria-pressed='false' title='Currently playing' " +
      "aria-label='Mark " + escAttr(g[1]) + " as currently playing'>&#9654;</button>" +
    "<div class='time'>" + esc(g[5]) + "</div>" +
    "<div class='rating' role='img'></div>" +
    "<button class='mine' type='button' aria-haspopup='dialog'></button>";

  row.addEventListener("click", e => {
    if (e.target.closest("button")) return;   // the buttons have their own meaning
    openDetail(i);
  });
  row.addEventListener("keydown", e => {
    if (e.target !== row) return;   // Enter on a button inside is that button's
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); openDetail(i); }
  });
  row.querySelector(".box").addEventListener("click", e => {
    e.stopPropagation();
    setStatus(i, row, DONE);
  });
  row.querySelector(".mine").addEventListener("click", e => {
    e.stopPropagation();
    openRater(i, row, e.currentTarget);
  });
  row.querySelector(".mark").addEventListener("click", e => {
    e.stopPropagation();
    setStatus(i, row, PLAYING);
  });
  return row;
}

function makeSection(label, indices, showYearInMethod, yearLabels){
  const sec = document.createElement("section");
  sec.className = "decade";
  const head = document.createElement("div");
  head.className = "dhead";
  const countEl = document.createElement("span");
  countEl.className = "dcount";
  head.innerHTML = "<h2>" + esc(label) + "</h2>";
  head.appendChild(countEl);
  sec.appendChild(head);

  let lastYear = null;
  for (const i of indices) {
    if (yearLabels && DATA[i][0] !== lastYear) {
      lastYear = DATA[i][0];
      const yl = document.createElement("div");
      yl.className = "yearlabel";
      yl.textContent = lastYear;
      sec.appendChild(yl);
    }
    sec.appendChild(makeRow(i, showYearInMethod));
  }
  list.appendChild(sec);
  sections.push({indices, countEl, secEl: sec});
}

function render(){
  list.innerHTML = "";
  sections = [];
  if (view === "year") {
    const groups = {};
    DATA.forEach((g,i) => {
      const d = Math.floor(g[0]/10)*10;
      (groups[d] = groups[d] || []).push(i);
    });
    for (const d of Object.keys(groups).sort((a,b)=>a-b)) {
      makeSection(d + "s", groups[d], false, true);
    }
  } else if (view === "rating") {
    // Quarter-star bands, best first, and best first within each band. Community
    // averages bunch between about 3.75 and 4.5, so half stars would put most of the
    // list in one band. The ends are open: 4.5 and up, and below 3.5, each hold few.
    const band = x => x >= 4.5 ? 4.5 : x >= 3.5 ? Math.floor(x * 4) / 4 : 0;
    const groups = {};
    DATA.forEach((g,i) => { const b = band(communityOf(g)); (groups[b] = groups[b] || []).push(i); });
    for (const b of Object.keys(groups).map(Number).sort((a,b) => b - a)) {
      groups[b].sort((x,y) => communityOf(DATA[y]) - communityOf(DATA[x]));
      makeSection(b ? "IGDB " + b + "+" : "IGDB below 3.5", groups[b], true, false);
    }
  } else if (view === "price") {
    // cheapest first; what has no price goes last, in IGDB order
    const BANDS = [[0, "Free"], [5, "Under $5"], [10, "$5 to $10"], [20, "$10 to $20"], [40, "$20 to $40"], [Infinity, "$40 and up"]];
    const groups = BANDS.map(() => []), none = [];
    DATA.forEach((g,i) => {
      const n = nowPrice(g);
      if (n == null) none.push(i);
      else groups[BANDS.findIndex(([max], b) => b === 0 ? n === 0 : n < max)].push(i);
    });
    groups.forEach((idx, b) => {
      if (!idx.length) return;
      idx.sort((x,y) => nowPrice(DATA[x]) - nowPrice(DATA[y]));
      makeSection(BANDS[b][1], idx, true, false);
    });
    none.sort((x,y) => communityOf(DATA[y]) - communityOf(DATA[x]));
    if (none.length) makeSection("No price", none, true, false);
  } else if (view === "mine") {
    // one section per half star you've given, then everything you haven't rated, in
    // IGDB order so the unrated tail is still worth scrolling
    const groups = {}, unrated = [];
    DATA.forEach((g,i) => {
      const m = mineOf(g);
      if (m === null) unrated.push(i); else (groups[m] = groups[m] || []).push(i);
    });
    for (const m of Object.keys(groups).map(Number).sort((a,b) => b - a)) {
      makeSection("You: " + fmtStars(m), groups[m], true, false);
    }
    unrated.sort((x,y) => communityOf(DATA[y]) - communityOf(DATA[x]));
    if (unrated.length) makeSection("Not rated yet", unrated, true, false);
  } else {
    const groups = {};
    DATA.forEach((g,i) => { (groups[g[4]] = groups[g[4]] || []).push(i); });
    for (const c of CONSOLE_ORDER) {
      if (groups[c]) makeSection(c, groups[c], true, false);
    }
  }
  applyState();
  applyFilter();
}

/* ---------- marking ---------- */

// Clicking the row toggles done; the small play button toggles playing. Either
// one clears whatever the game was before, so the two states stay exclusive.
function setStatus(i, row, want){
  const k = keyOf(DATA[i]);
  if (progress.get(k) === want) progress.delete(k); else progress.set(k, want);
  if (row) paintRow(row, DATA[i]);
  refresh();
  if (hideDone) applyFilter();
  scheduleSave();
  if (detailI === i) paintDetail();
}

function paintRow(row, g){
  const s = progress.get(keyOf(g)) || 0;
  row.classList.toggle("done", s === DONE);
  row.classList.toggle("playing", s === PLAYING);
  row.querySelector(".box").setAttribute("aria-checked", s === DONE ? "true" : "false");
  row.querySelector(".mark").setAttribute("aria-pressed", s === PLAYING ? "true" : "false");
  row.querySelector(".own").hidden = !owned.has(keyOf(g));
  row.querySelector(".low").hidden = !atLowest(g);

  // two badges: the community's score, then yours (a faint + until you rate it)
  const c = row.querySelector(".rating"), x = communityOf(g);
  c.textContent = fmtStars(x);
  c.className = "rating " + tierOf(x);
  c.title = communityLabel(g);
  c.setAttribute("aria-label", communityLabel(g));
  const b = row.querySelector(".mine"), mine = mineOf(g);
  b.textContent = mine === null ? "+" : fmtStars(mine);
  b.classList.toggle("set", mine !== null);
  const label = mine === null ? "Rate " + g[1] : "Your rating " + fmtStars(mine) + ". Change it";
  b.title = label;
  b.setAttribute("aria-label", label);
}

// the old 1-5 colour scale, so a glance down the column still reads as before
const tierOf = x => "r" + (x >= 4.5 ? 5 : x >= 4 ? 4 : x >= 3 ? 3 : x >= 2 ? 2 : 1);
function communityLabel(g){
  const s = SCORES[keyOf(g)];
  return s ? "IGDB " + fmtStars(s.s / 20) + " from " + num(s.n) + " ratings"
           : "List score " + g[2] + " (no IGDB score)";
}

/* ---------- your rating ---------- */

// One popover, moved to whichever badge opened it. Half stars, like Backloggd.
const rater = document.createElement("div");
rater.className = "rater";
rater.setAttribute("role", "dialog");
rater.hidden = true;
rater.innerHTML =
  "<div class='rhead'><span class='rtitle'></span><button type='button' class='rclear'>Clear</button></div>" +
  "<div class='rstars'>" +
  [1,2,3,4,5,6,7,8,9,10].map(h =>
    "<button type='button' data-h='" + h + "' aria-label='" + h / 2 + " stars'>" +
    (h % 2 ? (h > 1 ? (h - 1) / 2 : "") + "½" : h / 2) + "</button>").join("") +
  "</div><div class='rsrc'></div>";
document.body.appendChild(rater);
let raterFor = null;   // {i, row, btn}

function openRater(i, row, btn){
  if (raterFor && raterFor.btn === btn) { closeRater(); return; }
  raterFor = { i, row, btn };
  const g = DATA[i], h = ratings.get(keyOf(g)) || 0;
  rater.querySelector(".rtitle").textContent = g[1];
  rater.setAttribute("aria-label", "Your rating for " + g[1]);
  rater.querySelectorAll(".rstars button").forEach(b => {
    const v = +b.dataset.h;
    b.setAttribute("aria-pressed", v === h ? "true" : "false");
    b.classList.toggle("lit", v <= h);
  });
  rater.querySelector(".rclear").hidden = !h;
  rater.querySelector(".rsrc").textContent = communityLabel(g);
  rater.hidden = false;
  // under the badge, kept on screen; above it if there's no room below
  const r = btn.getBoundingClientRect(), w = rater.offsetWidth, ht = rater.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  const below = r.bottom + 6 + ht < innerHeight;
  rater.style.left = left + scrollX + "px";
  rater.style.top = (below ? r.bottom + 6 : r.top - ht - 6) + scrollY + "px";
  (rater.querySelector(".rstars [aria-pressed='true']") || rater.querySelector(".rstars button")).focus();
}
function closeRater(refocus){
  if (!raterFor) return;
  rater.hidden = true;
  if (refocus) raterFor.btn.focus();
  raterFor = null;
}
// h in half stars, 0 to clear. Used by the popover and the game panel alike.
function rateGame(i, h){
  const k = keyOf(DATA[i]);
  if (h) ratings.set(k, h); else ratings.delete(k);
  const row = rowOf(i);
  if (row) paintRow(row, DATA[i]);
  refresh();
  scheduleSave();
  if (detailI === i) paintDetail();
  showToast(h ? "Rated " + DATA[i][1] + " " + fmtStars(h / 2) : "Cleared your rating");
}
function setRating(h){
  const { i } = raterFor;
  closeRater(true);
  rateGame(i, h);
}
const rowOf = i => list.querySelector(".row[data-i='" + i + "']");
rater.addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  setRating(b.classList.contains("rclear") ? 0 : +b.dataset.h);
});
// hovering previews the score, the way a star widget does
rater.querySelector(".rstars").addEventListener("pointerover", e => {
  const b = e.target.closest("button");
  if (!b) return;
  rater.querySelectorAll(".rstars button").forEach(x => x.classList.toggle("lit", +x.dataset.h <= +b.dataset.h));
});
rater.querySelector(".rstars").addEventListener("pointerleave", () => {
  const h = raterFor ? ratings.get(keyOf(DATA[raterFor.i])) || 0 : 0;
  rater.querySelectorAll(".rstars button").forEach(x => x.classList.toggle("lit", +x.dataset.h <= h));
});
rater.addEventListener("keydown", e => {
  if (e.key === "Escape") { e.preventDefault(); closeRater(true); return; }
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const bs = [...rater.querySelectorAll(".rstars button")];
  const at = bs.indexOf(document.activeElement);
  if (at < 0) return;
  e.preventDefault();
  bs[Math.max(0, Math.min(bs.length - 1, at + (e.key === "ArrowRight" ? 1 : -1)))].focus();
});
document.addEventListener("pointerdown", e => {
  if (raterFor && !rater.contains(e.target) && e.target !== raterFor.btn) closeRater();
});
window.addEventListener("resize", () => closeRater());

/* ---------- prices ---------- */

// A snapshot from gg.deals (data/prices.js, made by tools/fetch-prices.js) for games
// with a Steam release: {app, url, r, k, hr, hk} = Steam app id, gg.deals page, best
// retail and keyshop price now, and the lowest each has ever been. The API key can't
// ship in a public page, so these are as of PRICES_AS_OF, not live.
const PRICES = window.PRICES || {};
const AS_OF = window.PRICES_AS_OF || null;
const CURRENCY = window.PRICES_CURRENCY || "USD";
const priceOf = g => PRICES[keyOf(g)] || null;
const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY });
// 0 is real: free-to-play now, or a giveaway at its lowest
const money = n => n == null ? "—" : n === 0 ? "Free" : moneyFmt.format(n);
const lowest = (...xs) => { const v = xs.filter(x => x != null); return v.length ? Math.min(...v) : null; };
// best price now, retail or keyshop - the number the cart totals and the filter uses
const nowPrice = g => { const p = priceOf(g); return p ? lowest(p.r, p.k) : null; };
// At its lowest ever: retail or keyshop is down to the cheapest it has been. A lowest of
// 0 was a giveaway, which a paid price can never match, so those don't count.
function atLowest(g){
  const p = priceOf(g);
  if (!p) return false;
  const at = (now, low) => now != null && low != null && low > 0 && now <= low + 0.005;
  return at(p.r, p.hr) || at(p.k, p.hk);
}
const asOfText = () => AS_OF
  ? "Prices as of " + new Date(AS_OF + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
  : "";

const plainTitle = g => g[1].replace(/\s*\([^)]*\)/g, "");
// NSO titles come with the subscription, so there is nothing to buy
const onSwitch = g => !/^NSO\b/.test(g[3]) && (g[4] === "Switch 2" || /\bSwitch\b/.test(g[3]));
const onPC = g => g[4].startsWith("PC") || /\bPC\b/.test(g[3]);
function storeLinks(g){
  const p = priceOf(g), q = encodeURIComponent(plainTitle(g)), links = [];
  if (p) links.push(["gg.deals", p.url]);
  else if (onPC(g)) links.push(["Search gg.deals", "https://gg.deals/games/?title=" + q]);
  if (p && p.app) links.push(["Steam", "https://store.steampowered.com/app/" + p.app + "/"]);
  if (onSwitch(g)) links.push(["Deku Deals", "https://www.dekudeals.com/search?q=" + q]);
  return links;
}
const linkHtml = ([label, href]) =>
  "<a href='" + escAttr(href) + "' target='_blank' rel='noopener'>" + esc(label) + " &#8599;</a>";
const starButtons = () => [1,2,3,4,5,6,7,8,9,10].map(h =>
  "<button type='button' data-h='" + h + "' aria-label='" + h / 2 + " stars'>" +
  (h % 2 ? (h > 1 ? (h - 1) / 2 : "") + "½" : h / 2) + "</button>").join("");

/* ---------- game panel ---------- */

const detail = document.createElement("dialog");
detail.className = "sheet";
detail.setAttribute("aria-labelledby", "dTitle");
detail.innerHTML =
  "<div class='stop'><div class='stitles'><h2 id='dTitle'></h2><p class='smeta'></p></div>" +
  "<button type='button' class='sclose' aria-label='Close'>&times;</button></div>" +
  "<p class='smethod'></p>" +
  "<div class='sacts'>" +
  "<button type='button' class='chip' data-act='done'>Played</button>" +
  "<button type='button' class='chip' data-act='playing'>Playing</button>" +
  "<button type='button' class='chip' data-act='owned'>Owned</button>" +
  "<button type='button' class='chip' data-act='cart'>In cart</button></div>" +
  "<div class='ssec'><div class='shead'><span class='flabel'>YOUR RATING</span>" +
  "<button type='button' class='rclear' data-act='clear'>Clear</button></div>" +
  "<div class='rstars'>" + starButtons() + "</div></div>" +
  "<div class='ssec'><span class='flabel'>COMMUNITY</span><p class='sscore'></p><p class='slinks sscorelinks'></p></div>" +
  "<div class='ssec'><span class='flabel'>PRICE</span><div class='sprice'></div><p class='slinks sstores'></p></div>";
document.body.appendChild(detail);
let detailI = null;

function openDetail(i){
  closeRater();
  detailI = i;
  paintDetail();
  if (!detail.open) detail.showModal();
}
function paintDetail(){
  const g = DATA[detailI], k = keyOf(g), s = progress.get(k) || 0, h = ratings.get(k) || 0;
  const q = sel => detail.querySelector(sel);
  q("#dTitle").textContent = g[1];
  q(".smeta").textContent = [g[0], g[4], g[5] === "∞" ? "endless" : g[5]].join(" · ");
  q(".smethod").textContent = "Best way to play: " + g[3];
  const press = (act, on) => q("[data-act='" + act + "']").setAttribute("aria-pressed", on ? "true" : "false");
  press("done", s === DONE);
  press("playing", s === PLAYING);
  press("owned", owned.has(k));
  press("cart", cart.has(k));
  q("[data-act='clear']").hidden = !h;
  detail.querySelectorAll(".rstars button").forEach(b => {
    b.setAttribute("aria-pressed", +b.dataset.h === h ? "true" : "false");
    b.classList.toggle("lit", +b.dataset.h <= h);
  });

  const sc = SCORES[k];
  q(".sscore").textContent = communityLabel(g);
  q(".sscorelinks").innerHTML = sc && sc.id
    ? [["IGDB", "https://www.igdb.com/games/" + sc.id], ["Backloggd", "https://backloggd.com/games/" + sc.id + "/"]].map(linkHtml).join("")
    : "";

  const p = priceOf(g);
  const why = onSwitch(g) ? "No price snapshot for Switch games. Deku Deals has live eShop prices."
    : onPC(g) ? "gg.deals has no Steam price for this game."
    : /^NSO\b/.test(g[3]) ? "Included with Nintendo Switch Online."
    : "No store price: this one is played through emulation.";
  q(".sprice").innerHTML = p
    ? (p.t ? "<p class='snote sold'>Sold as <b>" + esc(p.t) + "</b></p>" : "") +
      "<dl class='prices'>" +
      "<dt>Retail now</dt><dd>" + money(p.r) + "</dd>" +
      "<dt>Keyshops now</dt><dd>" + money(p.k) + "</dd>" +
      "<dt>Lowest ever</dt><dd>" + money(lowest(p.hr, p.hk)) + "</dd></dl>" +
      (atLowest(g) ? "<p class='snote deal'>At its lowest price ever right now.</p>" : "") +
      "<p class='snote'>" + esc(asOfText()) + " · gg.deals, US prices</p>"
    : "<p class='snote'>" + why + "</p>";
  q(".sstores").innerHTML = storeLinks(g).map(linkHtml).join("");
}
detail.addEventListener("click", e => {
  if (e.target === detail) { detail.close(); return; }   // a click on the backdrop
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("sclose")) { detail.close(); return; }
  const i = detailI;
  if (b.dataset.h) { rateGame(i, +b.dataset.h); return; }
  switch (b.dataset.act) {
    case "done": setStatus(i, rowOf(i), DONE); break;
    case "playing": setStatus(i, rowOf(i), PLAYING); break;
    case "clear": rateGame(i, 0); break;
    case "owned": toggleIn(owned, i); break;
    case "cart": toggleIn(cart, i); break;
  }
});
detail.addEventListener("close", () => {
  const row = detailI !== null && rowOf(detailI);
  detailI = null;
  if (row) row.focus();
});

function toggleIn(set, i){
  const k = keyOf(DATA[i]);
  if (set.has(k)) set.delete(k); else set.add(k);
  const row = rowOf(i);
  if (row) paintRow(row, DATA[i]);
  if (set === owned && ownFilter) applyFilter();
  scheduleSave();
  paintCartBtn();
  if (detailI === i) paintDetail();
  if (cartDlg.open) paintCart();
}

/* ---------- cart ---------- */

// Totals what the games in the cart cost to buy now, from the price snapshot. A game
// with no price is listed with its store links but left out of the totals, which say so.
const cartDlg = document.createElement("dialog");
cartDlg.className = "sheet";
cartDlg.setAttribute("aria-labelledby", "cTitle");
document.body.appendChild(cartDlg);

// the cart is shared with the other list, but each page totals only its own games
const cartGames = () => DATA.map((g, i) => [g, i]).filter(([g]) => cart.has(keyOf(g)));
// Halo and Halo 2 are both bought as the Master Chief Collection: one purchase covers
// every game sold as the same Steam app, so it is counted once, under the first of them
function firstOfApp(items){
  const first = new Map();
  for (const [g] of items) { const p = priceOf(g); if (p && !first.has(p.app)) first.set(p.app, g); }
  return first;
}
function cartTotals(items){
  let retail = 0, best = 0, ever = 0, priced = 0;
  const first = firstOfApp(items);
  for (const [g] of items) {
    const p = priceOf(g);
    if (!p || lowest(p.r, p.k) == null) continue;
    priced++;
    if (first.get(p.app) !== g) continue;
    retail += p.r ?? p.k;
    best += lowest(p.r, p.k);
    ever += lowest(p.hr, p.hk, p.r, p.k);
  }
  return { retail, best, ever, priced };
}
function paintCartBtn(){
  const btn = $("cartBtn"), items = cartGames(), t = cartTotals(items);
  btn.hidden = !items.length;
  btn.textContent = "Cart " + items.length + (t.priced ? " · " + money(t.best) : "");
}
function paintCart(){
  const items = cartGames(), t = cartTotals(items), missing = items.length - t.priced;
  const first = firstOfApp(items);
  const rows = items.map(([g, i]) => {
    const p = priceOf(g), now = p && lowest(p.r, p.k), dup = p && first.get(p.app) !== g;
    const price = dup
      ? "<span class='csub'>in " + esc(p.t || first.get(p.app)[1]) + ", counted above</span>"
      : now != null
      ? "<span class='cprice'>" + money(now) + "</span><span class='csub'>" +
        (p.k != null && p.r != null && p.k < p.r ? "keyshop · retail " + money(p.r) : "retail") + "</span>"
      : "<span class='csub'>" + (storeLinks(g).map(linkHtml).join(" ") || "no store price") + "</span>";
    return "<li><div class='ctitle'><button type='button' class='clink' data-open='" + i + "'>" + esc(g[1]) + "</button>" +
      "<span class='csub'>" + esc(p && p.t && !dup ? "as " + p.t : g[4]) + "</span></div><div class='cright'>" + price + "</div>" +
      "<button type='button' class='cremove' data-remove='" + i + "' aria-label='Remove " + escAttr(g[1]) + " from cart'>&times;</button></li>";
  }).join("");
  cartDlg.innerHTML =
    "<div class='stop'><div class='stitles'><h2 id='cTitle'>Cart</h2><p class='smeta'>" +
      items.length + (items.length === 1 ? " game" : " games") + "</p></div>" +
    "<button type='button' class='sclose' aria-label='Close'>&times;</button></div>" +
    (items.length
      ? "<ul class='clist'>" + rows + "</ul>" +
        (t.priced ? "<dl class='prices ctotal'>" +
        "<dt>Best price now</dt><dd>" + money(t.best) + "</dd>" +
        "<dt>All at retail</dt><dd>" + money(t.retail) + "</dd>" +
        "<dt>At their lowest ever</dt><dd>" + money(t.ever) + "</dd></dl>" : "") +
        "<p class='snote'>" + (missing ? missing + (missing === 1 ? " game has no price and isn't" : " games have no price and aren't") +
          " counted. " : "") + esc(asOfText()) +
          (AS_OF ? " · gg.deals, US prices. Keyshops are third-party key resellers." : "") + "</p>" +
        "<div class='sacts'><button type='button' class='chip' data-clear-cart>Empty cart</button></div>"
      : "<p class='snote'>Nothing here yet. Open a game and press <b>In cart</b>.</p>");
}
cartDlg.addEventListener("click", e => {
  if (e.target === cartDlg) { cartDlg.close(); return; }
  const b = e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("sclose")) cartDlg.close();
  else if (b.dataset.remove) toggleIn(cart, +b.dataset.remove);
  else if (b.dataset.open) { cartDlg.close(); openDetail(+b.dataset.open); }
  else if (b.hasAttribute("data-clear-cart")) {
    if (!confirm("Empty the cart?")) return;
    for (const [g] of cartGames()) cart.delete(keyOf(g));
    scheduleSave();
    paintCartBtn();
    paintCart();
    applyState();
  }
});
$("cartBtn").addEventListener("click", () => { paintCart(); cartDlg.showModal(); });

function applyState(){
  document.querySelectorAll(".row").forEach(row => paintRow(row, DATA[row.dataset.i]));
  refresh();
}

// counts, progress bar and the stats line
function refresh(){
  let done = 0, playing = 0;
  for (const g of DATA) {
    const s = progress.get(keyOf(g));
    if (s === DONE) done++; else if (s === PLAYING) playing++;
  }
  $("nDone").textContent = done;
  const donePct = done / DATA.length * 100;
  $("mainFill").style.width = donePct + "%";
  const pf = $("playFill");
  pf.style.left = donePct + "%";
  pf.style.width = (playing / DATA.length * 100) + "%";

  for (const s of sections) {
    const dd = s.indices.filter(i => progress.get(keyOf(DATA[i])) === DONE).length;
    s.countEl.textContent = dd + "/" + s.indices.length;
  }

  // stats describe what is currently on screen, so filtering to one platform
  // answers "how long is what's left here"
  let shown = 0, sDone = 0, sPlaying = 0, sRated = 0, left = 0, endless = 0;
  for (const g of DATA) {
    if (!matches(g)) continue;
    shown++;
    if (ratings.has(keyOf(g))) sRated++;
    const s = progress.get(keyOf(g));
    if (s === DONE) { sDone++; continue; }
    if (s === PLAYING) sPlaying++;
    const h = hoursOf(g);
    if (h === null) endless++; else left += h;
  }
  const parts = ["<b>" + num(shown) + "</b> shown"];
  if (sDone) parts.push("<b>" + num(sDone) + "</b> done");
  if (sPlaying) parts.push("<b>" + num(sPlaying) + "</b> playing");
  if (sRated) parts.push("<b>" + num(sRated) + "</b> rated");
  parts.push("<b>" + num(Math.round(left)) + "h</b> left");
  if (endless) parts.push(num(endless) + " endless");
  const el = $("stats");
  el.innerHTML = parts.join(" · ");
  el.title = left ? "About " + (left / 10 / 52).toFixed(1) + " years at 10 hours a week" : "";
}

/* ---------- filtering ---------- */

function matches(g){
  if (communityOf(g) < minRating) return false;
  if (query && !g[1].toLowerCase().includes(query)) return false;
  if (platform && g[4] !== platform) return false;
  if (hideDone && progress.get(keyOf(g)) === DONE) return false;
  if (ownFilter && owned.has(keyOf(g)) !== (ownFilter === "y")) return false;
  if (maxPrice || atLowOnly) {
    const n = nowPrice(g);
    if (n == null) return false;
    if (maxPrice && n >= maxPrice) return false;
    if (atLowOnly && !atLowest(g)) return false;
  }
  if (maxTime) {
    const h = hoursOf(g);
    if (h === null || h > maxTime) return false;   // endless games have no run time to fit
  }
  return true;
}

function applyFilter(){
  let visible = 0;
  document.querySelectorAll(".row").forEach(row => {
    const show = matches(DATA[row.dataset.i]);
    row.style.display = show ? "" : "none";
    if (show) visible++;
  });
  document.querySelectorAll(".yearlabel").forEach(yl => {
    let el = yl.nextElementSibling, any = false;
    while (el && el.classList.contains("row")) {
      if (el.style.display !== "none") { any = true; break; }
      el = el.nextElementSibling;
    }
    yl.style.display = any ? "" : "none";
  });
  for (const s of sections) {
    s.secEl.style.display = s.indices.some(i => matches(DATA[i])) ? "" : "none";
  }
  $("empty").style.display = visible ? "none" : "block";
  refresh();
  writePrefs();
}

/* ---------- controls ---------- */

function pressGroup(sel, active){
  document.querySelectorAll(sel).forEach(b => b.setAttribute("aria-pressed", b === active ? "true" : "false"));
}

$("search").addEventListener("input", e => {
  query = e.target.value.trim().toLowerCase();
  applyFilter();
});
document.querySelectorAll(".chip[data-min]").forEach(btn => {
  btn.addEventListener("click", () => {
    minRating = +btn.dataset.min;
    pressGroup(".chip[data-min]", btn);
    applyFilter();
  });
});
document.querySelectorAll(".chip[data-time]").forEach(btn => {
  btn.addEventListener("click", () => {
    maxTime = +btn.dataset.time;
    pressGroup(".chip[data-time]", btn);
    applyFilter();
  });
});
document.querySelectorAll(".chip[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (view === btn.dataset.view) return;
    view = btn.dataset.view;
    pressGroup(".chip[data-view]", btn);
    render();
    writePrefs();
  });
});
$("platform").addEventListener("change", e => { platform = e.target.value; applyFilter(); });
document.querySelectorAll(".chip[data-price]").forEach(btn => {
  btn.addEventListener("click", () => {
    maxPrice = +btn.dataset.price;
    pressGroup(".chip[data-price]", btn);
    applyFilter();
  });
});
$("atLow").addEventListener("click", e => {
  atLowOnly = !atLowOnly;
  e.currentTarget.setAttribute("aria-pressed", atLowOnly ? "true" : "false");
  applyFilter();
});
document.querySelectorAll(".chip[data-own]").forEach(btn => {
  btn.addEventListener("click", () => {
    // the two chips are exclusive, and pressing the active one turns it off
    ownFilter = ownFilter === btn.dataset.own ? "" : btn.dataset.own;
    document.querySelectorAll(".chip[data-own]").forEach(b =>
      b.setAttribute("aria-pressed", b.dataset.own === ownFilter ? "true" : "false"));
    applyFilter();
  });
});
$("hideDone").addEventListener("click", e => {
  hideDone = !hideDone;
  e.currentTarget.setAttribute("aria-pressed", hideDone ? "true" : "false");
  applyFilter();
});
$("toggleFilters").addEventListener("click", e => {
  const open = $("panel").hidden;
  $("panel").hidden = !open;
  e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
});

// pick something to play from whatever is on screen and not already finished
$("shuffle").addEventListener("click", () => {
  const rows = [...list.querySelectorAll(".row")]
    .filter(r => r.style.display !== "none" && !r.classList.contains("done"));
  if (!rows.length) { showToast("Nothing left to pick"); return; }
  const row = rows[Math.floor(Math.random() * rows.length)];
  document.querySelectorAll(".row.picked").forEach(r => r.classList.remove("picked"));
  void row.offsetWidth;   // restart the highlight if the same row comes up twice
  row.classList.add("picked");
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  showToast(DATA[row.dataset.i][1]);
});

/* ---------- copy, export, import ---------- */

function copyList(done){
  const lines = DATA
    .filter(g => (progress.get(keyOf(g)) === DONE) === done)
    .map(g => g[1] + " (" + g[0] + ")");
  const text = lines.join("\n");
  const finish = () => showToast(lines.length + " titles copied");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(finish).catch(() => fallbackCopy(text, finish));
  } else {
    fallbackCopy(text, finish);
  }
}
function fallbackCopy(text, cb){
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); cb(); } catch(e){ showToast("Copy failed"); }
  document.body.removeChild(ta);
}

// progress lives in this browser only, so give it a way out and back in
$("exportBtn").addEventListener("click", () => {
  const payload = { app: "games-list", v: 3, exported: new Date().toISOString(),
    s: Object.fromEntries(progress), r: Object.fromEntries(ratings), o: [...owned], c: [...cart] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "games-list-progress-" + new Date().toISOString().slice(0,10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Exported " + progress.size + " marked, " + ratings.size + " rated, " + owned.size + " owned");
});
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";              // so the same file can be picked again
  if (!file) return;
  let text = "", incoming;
  try { text = await file.text(); } catch(err){}
  // a library file (tools/fetch-steam-owned.js) only says what you own, so it adds to
  // your owned games and leaves everything else alone
  let lib = null;
  try { lib = JSON.parse(text); } catch(err){}
  if (lib && lib.kind === "owned" && Array.isArray(lib.o)) {
    const add = lib.o.filter(k => typeof k === "string" && !owned.has(k));
    if (!add.length) { showToast("You already own all " + lib.o.length + " of those"); return; }
    if (!confirm("Mark " + add.length + " more games as owned" + (lib.source ? " from your " + lib.source[0].toUpperCase() + lib.source.slice(1) + " library" : "") + "?")) return;
    for (const k of add) owned.add(k);
    save();
    applyState();
    if (ownFilter) applyFilter();
    showToast("Marked " + add.length + " games owned");
    return;
  }
  try { incoming = parseProgress(text); } catch(err){ incoming = null; }
  if (!incoming) { showToast("Could not read that file"); return; }
  // replacing, not merging: an unmarked game in the file should end up unmarked here
  const sum = (m, r, o) => m.size + " marked, " + r.size + " rated, " + o.size + " owned";
  if (!confirm("Replace this browser's progress (" + sum(progress, ratings, owned) + ") with the file's (" +
    sum(incoming.state, incoming.ratings, incoming.owned) + ")?")) return;
  progress = incoming.state;
  ratings = incoming.ratings;
  owned = incoming.owned;
  cart = incoming.cart;
  paintCartBtn();
  save();
  if (view === "mine") render(); else { applyState(); applyFilter(); }
  showToast("Imported " + sum(incoming.state, incoming.ratings, incoming.owned));
});

let toastTimer = null;
function showToast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}
$("copyRemaining").addEventListener("click", () => copyList(false));
$("copyDone").addEventListener("click", () => copyList(true));

/* ---------- theme ---------- */

const THEMES = ["auto","light","dark"];
function applyTheme(t){
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  $("themeBtn").textContent = "Theme: " + t.toUpperCase();
  try { localStorage.setItem(THEME_KEY, t); } catch(e){}
}
$("themeBtn").addEventListener("click", () => {
  let cur = "auto";
  try { cur = localStorage.getItem(THEME_KEY) || "auto"; } catch(e){}
  applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
});

/* ---------- init ---------- */

readPrefs();

// platform options come from the data, so a platform with nothing on this list
// never shows up as an empty choice
(function buildPlatforms(){
  const counts = {};
  DATA.forEach(g => { counts[g[4]] = (counts[g[4]] || 0) + 1; });
  const sel = $("platform");
  for (const c of CONSOLE_ORDER) {
    if (!counts[c]) continue;
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c + " (" + counts[c] + ")";
    sel.appendChild(o);
  }
  if (platform && !counts[platform]) platform = "";
  sel.value = platform;
})();

$("search").value = query;
pressGroup(".chip[data-min]", document.querySelector('.chip[data-min="' + minRating + '"]'));
pressGroup(".chip[data-time]", document.querySelector('.chip[data-time="' + maxTime + '"]'));
pressGroup(".chip[data-view]", document.querySelector('.chip[data-view="' + view + '"]'));
$("hideDone").setAttribute("aria-pressed", hideDone ? "true" : "false");
document.querySelectorAll(".chip[data-own]").forEach(b =>
  b.setAttribute("aria-pressed", b.dataset.own === ownFilter ? "true" : "false"));
pressGroup(".chip[data-price]", document.querySelector('.chip[data-price="' + maxPrice + '"]'));
$("atLow").setAttribute("aria-pressed", atLowOnly ? "true" : "false");
try { applyTheme(localStorage.getItem(THEME_KEY) || "auto"); } catch(e){ applyTheme("auto"); }

$("nTotal").textContent = DATA.length;
render();
load();

if ("serviceWorker" in navigator) {
  // updateViaCache:"none" keeps sw.js itself out of the HTTP cache, so a deploy is
  // picked up on the next visit rather than up to ten minutes later
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then(reg => reg.update())
      .catch(() => {});
  });
}
