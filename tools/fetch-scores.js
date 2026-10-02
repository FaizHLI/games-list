#!/usr/bin/env node
// Pulls each game's community rating from IGDB into data/scores.js.
//
// IGDB is the database Backloggd is built on. Its `rating` is the average of its own
// users' scores, 0-100; the site shows it as stars (score / 20), Backloggd's scale.
// Backloggd's own averages aren't available: it has no API and blocks scripted access.
//
// Needs a Twitch developer app (dev.twitch.tv/console/apps, any name, OAuth redirect
// http://localhost, category "Application Integration"). Put its credentials in
// .env.local, which is gitignored:
//
//   TWITCH_CLIENT_ID=...
//   TWITCH_CLIENT_SECRET=...
//
// or, if you already have an app access token, TWITCH_ACCESS_TOKEN in place of the
// secret (tokens expire after about 60 days; the secret mints a fresh one each run).
//
// Then:  node tools/fetch-scores.js && node build.js
//
// Matching is by name and year. Anything it can't match confidently is listed in
// tools/fetch-report.txt; pin those by hand in tools/igdb-overrides.json as
// "year|title": <IGDB game id>, or null to leave a game on the list's own score.
// After editing overrides, `node tools/fetch-scores.js --pinned` refetches just
// those and keeps every other score from the last full run.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rel = p => path.join(ROOT, p);

// fewer ratings than this and the average is one person's opinion
const MIN_COUNT = 5;

try { process.loadEnvFile(rel(".env.local")); } catch (e) { /* fall back to the real environment */ }
const { TWITCH_CLIENT_ID: ID, TWITCH_CLIENT_SECRET: SECRET, TWITCH_ACCESS_TOKEN: TOKEN } = process.env;
if (!ID || !(SECRET || TOKEN)) {
  console.error("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (or TWITCH_ACCESS_TOKEN) in .env.local - see the top of this file.");
  process.exit(1);
}

global.window = {};
require(rel("data/games.js"));
const GAMES = window.GAMES;
const OVERRIDES = fs.existsSync(rel("tools/igdb-overrides.json"))
  ? JSON.parse(fs.readFileSync(rel("tools/igdb-overrides.json"), "utf8")) : {};

const keyOf = g => g[0] + "|" + g[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// "Pokémon: Let's Go, Pikachu!" and "Pokemon Lets Go Pikachu" are the same name
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, " and ").replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ")
  .replace(/^the /, "").trim();
const yearOf = c => c.first_release_date ? new Date(c.first_release_date * 1000).getUTCFullYear() : null;
// Apicalypse strings are double-quoted; titles never contain a backslash
const quote = s => '"' + s.replace(/"/g, '\\"') + '"';
const FIELDS = "fields name,rating,rating_count,first_release_date,slug;";

async function token(){
  if (TOKEN) return TOKEN;
  const r = await fetch("https://id.twitch.tv/oauth2/token?client_id=" + encodeURIComponent(ID) +
    "&client_secret=" + encodeURIComponent(SECRET) + "&grant_type=client_credentials", { method: "POST" });
  if (!r.ok) throw new Error("Twitch token request failed: " + r.status + " " + await r.text());
  return (await r.json()).access_token;
}

// IGDB allows 4 requests a second
async function igdb(tok, endpoint, body){
  for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://api.igdb.com/v4/" + endpoint, {
      method: "POST",
      headers: { "Client-ID": ID, "Authorization": "Bearer " + tok, "Accept": "application/json" },
      body,
    });
    if (r.status === 429 && attempt < 5) { await sleep(1000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error("IGDB " + endpoint + " failed: " + r.status + " " + await r.text());
    await sleep(300);
    return r.json();
  }
}

// The best candidate, or null if none is convincing. A same-name game from the
// right year (give or take one, for regional releases) is a match; a same-name game
// from far off is usually the remake or the original of the one we mean.
function pick(g, cands){
  const want = norm(g[1]);
  let best = null, bestScore = 0;
  for (const c of cands) {
    const y = yearOf(c), name = norm(c.name);
    let score = 0;
    if (name === want) score += 4;
    else if (name.startsWith(want + " ") || want.startsWith(name + " ")) score += 2;
    else continue;
    if (y === g[0]) score += 3;
    else if (y && Math.abs(y - g[0]) === 1) score += 2;
    else continue;
    if (c.rating_count) score += Math.min(1, c.rating_count / 100);   // the main entry, not a re-release stub
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

(async () => {
  const tok = await token();
  const PINNED_ONLY = process.argv.includes("--pinned");
  let out = {};
  const report = [];
  if (PINNED_ONLY) {
    require(rel("data/scores.js"));
    out = { ...window.SCORES };
    for (const k of Object.keys(OVERRIDES)) delete out[k];
  }
  let matched = 0, noScore = 0;

  // pinned games are fetched by id, everything else by search
  const pinned = GAMES.filter(g => keyOf(g) in OVERRIDES);
  const search = PINNED_ONLY ? [] : GAMES.filter(g => !(keyOf(g) in OVERRIDES));

  const ids = pinned.map(g => OVERRIDES[keyOf(g)]).filter(id => id != null);
  const byId = {};
  for (let i = 0; i < ids.length; i += 500) {
    const res = await igdb(tok, "games", FIELDS + " where id = (" + ids.slice(i, i + 500).join(",") + "); limit 500;");
    for (const c of res) byId[c.id] = c;
  }
  const take = (g, c) => {
    if (c && c.rating_count >= MIN_COUNT) {
      out[keyOf(g)] = { s: Math.round(c.rating), n: c.rating_count, id: c.slug };
      matched++;
    } else {
      noScore++;
      report.push("NO SCORE   " + keyOf(g) + (c ? "  -> " + c.name + " (" + (c.rating_count || 0) + " ratings)" : ""));
    }
  };
  for (const g of pinned) {
    const id = OVERRIDES[keyOf(g)];
    if (id == null) continue;   // pinned to the list's own score on purpose
    if (!byId[id]) report.push("BAD ID     " + keyOf(g) + "  -> " + id);
    else take(g, byId[id]);
  }

  // one request per game: multiquery accepts `search` but silently returns nothing
  for (let i = 0; i < search.length; i++) {
    const g = search[i];
    const res = await igdb(tok, "games", FIELDS + " search " + quote(g[1].replace(/\s*\([^)]*\)/g, "")) + "; limit 25;");
    const c = pick(g, res);
    if (c) take(g, c);
    else report.push("UNMATCHED  " + keyOf(g) + "  candidates: " +
      res.slice(0, 5).map(c => c.name + " [" + c.id + ", " + yearOf(c) + "]").join("; "));
    if ((i + 1) % 25 === 0 || i + 1 === search.length)
      process.stdout.write("\r" + (i + 1) + "/" + search.length + " searched");
  }
  process.stdout.write("\n");

  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(rel("data/scores.js"),
    "// IGDB community ratings, 0-100, keyed year|title. Generated by tools/fetch-scores.js on " +
    new Date().toISOString().slice(0, 10) + " - don't edit by hand.\n" +
    "// {s: average, n: number of ratings, id: IGDB slug}\n" +
    "window.SCORES = " + JSON.stringify(sorted, null, 0).replace(/\},"/g, '},\n"') + ";\n", "utf8");
  if (!PINNED_ONLY) fs.writeFileSync(path.join(__dirname, "fetch-report.txt"), report.sort().join("\n") + "\n", "utf8");
  else if (report.length) console.log(report.join("\n"));
  if (PINNED_ONLY) matched = Object.keys(out).length;

  const unmatched = report.filter(l => l.startsWith("UNMATCHED")).length;
  console.log(matched + " scored, " + noScore + " matched without enough ratings, " + unmatched + " unmatched.");
  console.log("Details in tools/fetch-report.txt. Run node build.js next.");
})().catch(e => { console.error(e.message || e); process.exit(1); });
