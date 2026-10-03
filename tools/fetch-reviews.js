#!/usr/bin/env node
// Fetches critic and player review data into data/reviews.js:
//
//   mc  the Metacritic critic score (Metascore, 0-100), via RAWG, which carries it -
//       Metacritic has no API of its own
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
    if (r.status === 429 && attempt < 4) { await sleep(2000 * (attempt + 1)); continue; }
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

const rawg = p => json("https://api.rawg.io/api/" + p + (p.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(RAWG));
// a RAWG game that is this one: same name, and released within a year of it
const fits = (g, r) => r && sameName(r.name, g[1]) && (!r.released || Math.abs(yearOf(r.released) - g[0]) <= 1);

async function metascore(g){
  const k = keyOf(g);
  if (k in OVERRIDES) {
    if (OVERRIDES[k] == null) return { none: true };
    const r = await rawg("games/" + encodeURIComponent(OVERRIDES[k]));
    return r ? { mc: r.metacritic, slug: r.slug } : { bad: true };
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

  // Steam reviews, once per app: a collection's games share one
  const apps = [...new Set(Object.values(PRICES).map(p => p.app))];
  const byApp = {};
  for (let i = 0; i < apps.length; i++) {
    try { byApp[apps[i]] = await steamReviews(apps[i]); } catch (e) { byApp[apps[i]] = null; }
    await sleep(250);
    if ((i + 1) % 50 === 0 || i + 1 === apps.length) process.stdout.write("\rSteam reviews " + (i + 1) + "/" + apps.length);
  }
  process.stdout.write("\n");

  let mcCount = 0;
  for (let i = 0; i < GAMES.length; i++) {
    const g = GAMES[i], k = keyOf(g), rec = {};
    const p = PRICES[k];
    if (p && byApp[p.app]) rec.st = byApp[p.app];
    if (RAWG) {
      const m = await metascore(g);
      await sleep(150);
      if (m.mc) { rec.mc = m.mc; mcCount++; }
      if (m.miss) report.push("UNMATCHED  " + k + "  candidates: " + m.miss.join("; "));
      else if (m.bad) report.push("BAD SLUG   " + k + "  -> " + OVERRIDES[k]);
      else if (!m.mc && !m.none) report.push("NO SCORE   " + k + "  (rawg " + m.slug + ")");
    } else if (OLD[k] && OLD[k].mc) { rec.mc = OLD[k].mc; mcCount++; }
    if (Object.keys(rec).length) out[k] = rec;
    if (RAWG && ((i + 1) % 50 === 0 || i + 1 === GAMES.length)) process.stdout.write("\rMetascores " + (i + 1) + "/" + GAMES.length);
  }
  process.stdout.write("\n");

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
