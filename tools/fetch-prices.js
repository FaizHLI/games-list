#!/usr/bin/env node
// Snapshots gg.deals prices for every game with a Steam release into data/prices.js.
//
// The gg.deals key can't ship in a public page, so the site shows this snapshot and
// its date, with links out to the live pages. Rerun to refresh:
//
//   node tools/fetch-prices.js && node build.js
//
// Needs, in .env.local: GGDEALS_API_KEY (gg.deals account settings), and the Twitch
// credentials tools/fetch-scores.js uses, since Steam app ids come from IGDB.
//
// Steam ids are read from each game's IGDB entry (data/scores.js has its slug). A
// game played through a collection or port whose IGDB entry has no Steam release -
// Super Castlevania IV via the Anniversary Collection - can be pinned in
// tools/steam-overrides.json as "year|title": <Steam app id>, or null for none.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rel = p => path.join(ROOT, p);

try { process.loadEnvFile(rel(".env.local")); } catch (e) { /* fall back to the real environment */ }
const { TWITCH_CLIENT_ID: ID, TWITCH_CLIENT_SECRET: SECRET, TWITCH_ACCESS_TOKEN: TOKEN, GGDEALS_API_KEY: GG } = process.env;
if (!GG || !ID || !(SECRET || TOKEN)) {
  console.error("Needs GGDEALS_API_KEY and the Twitch credentials in .env.local - see the top of this file.");
  process.exit(1);
}

global.window = {};
require(rel("data/games.js"));
require(rel("data/scores.js"));
const GAMES = window.GAMES, SCORES = window.SCORES;
const OVERRIDES = fs.existsSync(rel("tools/steam-overrides.json"))
  ? JSON.parse(fs.readFileSync(rel("tools/steam-overrides.json"), "utf8")) : {};

const keyOf = g => g[0] + "|" + g[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STEAM = 1;   // IGDB's external game source id for Steam

async function token(){
  if (TOKEN) return TOKEN;
  const r = await fetch("https://id.twitch.tv/oauth2/token?client_id=" + encodeURIComponent(ID) +
    "&client_secret=" + encodeURIComponent(SECRET) + "&grant_type=client_credentials", { method: "POST" });
  if (!r.ok) throw new Error("Twitch token request failed: " + r.status);
  return (await r.json()).access_token;
}

// slug -> every Steam app id IGDB lists for the game, oldest first. A game often has
// several - the soundtrack, a demo, a later edition - and the first one IGDB lists
// isn't reliably the game, so prices() picks among them.
async function steamIds(slugs){
  const tok = await token(), out = {};
  for (let i = 0; i < slugs.length; i += 400) {
    const batch = slugs.slice(i, i + 400);
    const r = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: { "Client-ID": ID, "Authorization": "Bearer " + tok },
      body: "fields slug,external_games.uid,external_games.external_game_source,external_games.category; " +
        "where slug = (" + batch.map(s => JSON.stringify(s)).join(",") + "); limit 500;",
    });
    if (!r.ok) throw new Error("IGDB failed: " + r.status + " " + await r.text());
    for (const g of await r.json()) {
      // category is the older name for external_game_source; accept either
      const ids = (g.external_games || [])
        .filter(e => (e.external_game_source === STEAM || e.category === STEAM) && /^\d+$/.test(e.uid || ""))
        .map(e => +e.uid).sort((a, b) => a - b);
      if (ids.length) out[g.slug] = [...new Set(ids)];
    }
    await sleep(300);
  }
  return out;
}

// gg.deals takes up to 100 ids a request, and prices at most 1000 games an hour. One
// run asks about every candidate id (~950), so a second run within the hour fails
// with a 429 - wait it out.
async function prices(appIds){
  const out = {};
  for (let i = 0; i < appIds.length; i += 100) {
    const batch = appIds.slice(i, i + 100);
    const r = await fetch("https://api.gg.deals/v1/prices/by-steam-app-id/?region=us&ids=" + batch.join(",") +
      "&key=" + encodeURIComponent(GG));
    if (!r.ok) throw new Error("gg.deals failed: " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    if (!j.success) throw new Error("gg.deals error: " + JSON.stringify(j).slice(0, 200));
    Object.assign(out, j.data);
    await sleep(700);
  }
  return out;
}

const num = s => s == null || s === "" ? null : Math.round(parseFloat(s) * 100) / 100;
// "DOOM II" and "Doom II: Hell on Earth" are the same purchase; a collection isn't
const simple = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\([^)]*\)|[™®]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const sameGame = (a, b) => { a = simple(a); b = simple(b); return a.startsWith(b) || b.startsWith(a); };

(async () => {
  const slugs = [...new Set(GAMES.map(g => SCORES[keyOf(g)]).filter(Boolean).map(s => s.id))];
  const bySlug = await steamIds(slugs);

  const appsOf = {};   // key -> candidate Steam app ids
  for (const g of GAMES) {
    const k = keyOf(g);
    if (k in OVERRIDES) { if (OVERRIDES[k] != null) appsOf[k] = [OVERRIDES[k]]; continue; }
    const s = SCORES[k];
    if (s && bySlug[s.id]) appsOf[k] = bySlug[s.id];
  }

  const data = await prices([...new Set(Object.values(appsOf).flat())]);
  // The game is the oldest candidate that is on sale at retail. One with only keyshop
  // listings has been delisted, and those listings run from a few dollars to absurd.
  const onSale = id => data[id] && data[id].prices && data[id].prices.currentRetail != null;
  const appOf = {};
  for (const [k, ids] of Object.entries(appsOf)) appOf[k] = ids.find(onSale) || null;
  // whose best way to play mentions PC, so a missing price is worth a look
  const wantsPC = g => g[4].startsWith("PC") || /\bPC\b|Steam/.test(g[3]);
  const out = {}, report = [];
  let currency = "USD";
  for (const g of GAMES) {
    const k = keyOf(g), app = appOf[k];
    if (!app) {
      if (appsOf[k]) report.push("NOT ON SALE  " + k + "  (apps " + appsOf[k].join(",") + ")");
      else if (wantsPC(g)) report.push("NO STEAM ID  " + k + "  (" + g[3] + ")");
      continue;
    }
    const d = data[app], p = d.prices;
    currency = p.currency || currency;
    out[k] = { app, url: d.url, r: num(p.currentRetail), k: num(p.currentKeyshops),
               hr: num(p.historicalRetail), hk: num(p.historicalKeyshops) };
    // what you'd actually buy, when it isn't just this game: a collection or remaster
    if (!sameGame(d.title, g[1])) out[k].t = d.title;
  }

  const today = new Date().toISOString().slice(0, 10);
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(rel("data/prices.js"),
    "// gg.deals prices for games with a Steam release, keyed year|title. Generated by\n" +
    "// tools/fetch-prices.js - don't edit by hand. {app: Steam app id, url: gg.deals page,\n" +
    "// r/k: best retail/keyshop price now, hr/hk: lowest each has ever been,\n" +
    "// t: what you buy, when that's a collection or remaster rather than the game}\n" +
    "window.PRICES_AS_OF = " + JSON.stringify(today) + ";\n" +
    "window.PRICES_CURRENCY = " + JSON.stringify(currency) + ";\n" +
    "window.PRICES = " + JSON.stringify(sorted).replace(/\},"/g, '},\n"') + ";\n", "utf8");
  fs.writeFileSync(path.join(__dirname, "prices-report.txt"), report.sort().join("\n") + "\n", "utf8");
  // what each game matched, to eyeball for a wrong match
  fs.writeFileSync(path.join(__dirname, "prices-matches.txt"),
    Object.keys(sorted).map(k => k + "  ->  " + data[out[k].app].title).join("\n") + "\n", "utf8");
  console.log(Object.keys(out).length + " priced. " + report.length +
    " without a price; see tools/prices-report.txt (matches in prices-matches.txt). Run node build.js next.");
})().catch(e => { console.error(e.message || e); process.exit(1); });
