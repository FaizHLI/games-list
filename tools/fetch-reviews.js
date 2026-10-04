#!/usr/bin/env node
// Fetches critic and player review data into data/reviews.js:
//
//   mc  the Metacritic critic score (Metascore, 0-100). Metacritic has no API, so it
//       comes from Steam's store data for games sold on Steam as themselves (current),
//       and otherwise from RAWG (whose Metascores stop around 2023)
//   st  Steam user reviews [positive, total, Steam's summary] for games sold on Steam
//
// Needs RAWG_API_KEY in .env.local (rawg.io/apidocs) for Metascores; Steam reviews need
// no key. Without the RAWG key it refreshes Steam reviews and keeps the Metascores it has.
//
//   node tools/fetch-reviews.js && node build.js
//
// RAWG matching tries the game's IGDB slug first (the two databases mostly agree),
// then a name search, accepting a result whose name matches and whose year is within
// one. Wrong or missing matches go in tools/rawg-overrides.json as "year|title":
// "<rawg-slug>", or null for none; tools/reviews-report.txt lists what didn't match.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rel = p => path.join(ROOT, p);

try { process.loadEnvFile(rel(".env.local")); } catch (e) { /* fall back to the real environment */ }
const RAWG = process.env.RAWG_API_KEY;

global.window = {};
for (const f of ["data/games.js", "data/scores.js", "data/prices.js"]) require(rel(f));
const GAMES = window.GAMES, SCORES = window.SCORES, PRICES = window.PRICES;
let OLD = {};
if (fs.existsSync(rel("data/reviews.js"))) { require(rel("data/reviews.js")); OLD = window.REVIEWS || {}; }
const OVERRIDES = fs.existsSync(rel("tools/rawg-overrides.json"))
  ? JSON.parse(fs.readFileSync(rel("tools/rawg-overrides.json"), "utf8")) : {};

const keyOf = g => g[0] + "|" + g[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/^the /, "").trim();
const sameName = (a, b) => { a = norm(a); b = norm(b); return a === b || a.startsWith(b + " ") || b.startsWith(a + " "); };
const yearOf = d => d ? +d.slice(0, 4) : null;

async function json(url){
  for (let attempt = 0; ; attempt++) {
    // Steam occasionally never answers; without a timeout the whole run hangs on it
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(15000) }); }
    catch (e) { if (attempt < 3) { await sleep(2000); continue; } throw e; }
    // rate limits and RAWG's occasional 502s pass; retry them a few times
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await sleep(2000 * (attempt + 1)); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(url.replace(/key=[^&]+/, "key=…") + " failed: " + r.status);
    return r.json();
  }
}

// Steam's own review summary for an app
async function steamReviews(app){
  const j = await json("https://store.steampowered.com/appreviews/" + app +
    "?json=1&language=all&purchase_type=all&num_per_page=0&filter=summary");
  const q = j && j.query_summary;
  return q && q.total_reviews ? [q.total_positive, q.total_reviews, q.review_score_desc] : null;
}

async function rawg(p){
  const r = await json("https://api.rawg.io/api/" + p + (p.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(RAWG));
  // a renamed game answers its old slug with {redirect: true, slug: <new>}
  if (r && r.redirect && r.slug && p.startsWith("games/")) return rawg("games/" + encodeURIComponent(r.slug));
  return r;
}
// a RAWG game that is this one: same name, and released within a year of it
const fits = (g, r) => !!(r && r.name) && sameName(r.name, g[1]) && (!r.released || Math.abs(yearOf(r.released) - g[0]) <= 1);

async function metascore(g){
  const k = keyOf(g);
  if (k in OVERRIDES) {
    if (OVERRIDES[k] == null) return { none: true, pin: null };
    const r = await rawg("games/" + encodeURIComponent(OVERRIDES[k]));
    return r ? { mc: r.metacritic, slug: r.slug, pin: OVERRIDES[k] } : { bad: true, pin: OVERRIDES[k] };
  }
  const igdbSlug = SCORES[k] && SCORES[k].id;
  if (igdbSlug) {
    const r = await rawg("games/" + encodeURIComponent(igdbSlug));
    await sleep(150);
    if (fits(g, r)) return { mc: r.metacritic, slug: r.slug };
  }
  const s = await rawg("games?search=" + encodeURIComponent(g[1].replace(/\s*\([^)]*\)/g, "")) + "&page_size=10");
  const hit = ((s && s.results) || []).find(r => fits(g, r));
  return hit ? { mc: hit.metacritic, slug: hit.slug } : { miss: ((s && s.results) || []).slice(0, 4).map(r => r.name + " [" + r.slug + ", " + yearOf(r.released) + "]") };
}

(async () => {
  const out = {}, report = [];

  // Steam reviews, once per app: a collection's games share one. They take a few
  // minutes, so a run kept for the day lets a rerun after a RAWG hiccup skip them.
  const apps = [...new Set(Object.values(PRICES).map(p => p.app))];
  const CACHE = path.join(__dirname, ".steam-reviews-cache.json"), today = new Date().toISOString().slice(0, 10);
  // kept up to two days, dated by when it was first fetched, so a run that spans
  // midnight UTC still resumes
  const fresh = d => !!d && Date.parse(today) - Date.parse(d) <= 2 * 864e5;
  let byApp = {}, steamDay = today;
  try { const c = JSON.parse(fs.readFileSync(CACHE, "utf8")); if (fresh(c.day)) { byApp = c.byApp; steamDay = c.day; } } catch (e) {}
  const todo = apps.filter(a => !(a in byApp));
  for (let i = 0; i < todo.length; i++) {
    try { byApp[todo[i]] = await steamReviews(todo[i]); } catch (e) { byApp[todo[i]] = null; }
    await sleep(250);
    if ((i + 1) % 50 === 0 || i + 1 === todo.length) process.stdout.write("\rSteam reviews " + (i + 1) + "/" + todo.length);
  }
  if (todo.length) process.stdout.write("\n");
  fs.writeFileSync(CACHE, JSON.stringify({ day: steamDay, byApp }));

  // Steam's Metascores, for apps that are the game itself - a collection's score isn't
  // its games'. Steam allows about 200 of these a 5 minutes, one app per request, so
  // they're paced and kept like the rest.
  const MCACHE = path.join(__dirname, ".steam-mc-cache.json");
  let mcByApp = {}, mcDay = today;
  try { const c = JSON.parse(fs.readFileSync(MCACHE, "utf8")); if (fresh(c.day)) { mcByApp = c.mcByApp; mcDay = c.day; } } catch (e) {}
  const saveMc = () => fs.writeFileSync(MCACHE, JSON.stringify({ day: mcDay, mcByApp }));
  const ownApps = [...new Set(Object.values(PRICES).filter(p => !p.t).map(p => p.app))].filter(a => !(a in mcByApp));
  for (let i = 0; i < ownApps.length; i++) {
    try {
      const j = await json("https://store.steampowered.com/api/appdetails?appids=" + ownApps[i] + "&filters=metacritic");
      const d = j && j[ownApps[i]];
      mcByApp[ownApps[i]] = d && d.success && d.data && d.data.metacritic ? d.data.metacritic.score : null;
    } catch (e) { /* left out, so the next run asks again */ }
    if (i % 20 === 0) saveMc();
    await sleep(1600);
    if ((i + 1) % 25 === 0 || i + 1 === ownApps.length) process.stdout.write("\rSteam Metascores " + (i + 1) + "/" + ownApps.length);
  }
  if (ownApps.length) process.stdout.write("\n");
  saveMc();

  // RAWG answers are kept for the day too, saved as they come, so a run that's cut off
  // carries on from where it stopped instead of starting over
  const RCACHE = path.join(__dirname, ".rawg-cache.json");
  let byGame = {}, rawgDay = today;
  try { const c = JSON.parse(fs.readFileSync(RCACHE, "utf8")); if (fresh(c.day)) { byGame = c.byGame; rawgDay = c.day; } } catch (e) {}
  const saveRawg = () => fs.writeFileSync(RCACHE, JSON.stringify({ day: rawgDay, byGame }));

  let mcCount = 0;
  for (let i = 0; i < GAMES.length; i++) {
    const g = GAMES[i], k = keyOf(g), rec = {};
    const p = PRICES[k];
    if (p && byApp[p.app]) rec.st = byApp[p.app];
    const steamMc = p && !p.t ? mcByApp[p.app] : null;
    if (steamMc) { rec.mc = steamMc; mcCount++; }
    if (RAWG) {
      let m = byGame[k];
      // a pin added since the cached answer was fetched has to be asked again
      if (!m || m.error || (k in OVERRIDES && m.pin !== OVERRIDES[k])) {
        try { m = await metascore(g); } catch (e) { m = { error: e.message || String(e) }; }
        byGame[k] = m;
        if (i % 20 === 0) saveRawg();
        await sleep(150);
      }
      if (m.mc && !rec.mc) { rec.mc = m.mc; mcCount++; }
      if (rec.mc) { /* scored, by Steam or RAWG */ }
      else if (m.error) report.push("ERROR      " + k + "  " + m.error);
      else if (m.miss) report.push("UNMATCHED  " + k + "  candidates: " + m.miss.join("; "));
      else if (m.bad) report.push("BAD SLUG   " + k + "  -> " + OVERRIDES[k]);
      else if (!m.mc && !m.none) report.push("NO SCORE   " + k + "  (rawg " + m.slug + ")");
    } else if (!rec.mc && OLD[k] && OLD[k].mc) { rec.mc = OLD[k].mc; mcCount++; }
    if (Object.keys(rec).length) out[k] = rec;
    if (RAWG && ((i + 1) % 50 === 0 || i + 1 === GAMES.length)) process.stdout.write("\rMetascores " + (i + 1) + "/" + GAMES.length);
  }
  process.stdout.write("\n");
  if (RAWG) saveRawg();

  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(rel("data/reviews.js"),
    "// Review data keyed year|title. Generated by tools/fetch-reviews.js - don't edit by hand.\n" +
    "// {mc: Metacritic critic score 0-100 (via RAWG), st: Steam reviews [positive, total, summary]}\n" +
    "window.REVIEWS = " + JSON.stringify(sorted).replace(/\},"/g, '},\n"') + ";\n", "utf8");
  if (RAWG) fs.writeFileSync(path.join(__dirname, "reviews-report.txt"), report.sort().join("\n") + "\n", "utf8");
  console.log(mcCount + " Metascores" + (RAWG ? "" : " (kept; no RAWG_API_KEY)") + ", " +
    Object.values(out).filter(r => r.st).length + " games with Steam reviews." +
    (RAWG ? " " + report.length + " without a Metascore; see tools/reviews-report.txt." : "") + " Run node build.js next.");
})().catch(e => { console.error(e.message || e); process.exit(1); });
