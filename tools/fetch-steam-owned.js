#!/usr/bin/env node
// Reads your Steam library and writes a file that marks those games owned.
//
// Owned marks live in your browser, so this can't set them directly: it writes
// exports/steam-owned-<date>.json, and Import on the site adds those games to what you
// own. Your played marks, ratings and cart are left alone.
//
// Needs, in .env.local: STEAM_API_KEY (steamcommunity.com/dev/apikey) and
// STEAM_PROFILE (your profile URL), with Game details set to Public in Steam's privacy
// settings.
//
//   node tools/fetch-steam-owned.js
//
// A game counts as owned when you own the Steam app the site prices it under (so
// owning the Castlevania Anniversary Collection marks Super Castlevania IV too), or
// when a game in your library has the same name.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rel = p => path.join(ROOT, p);

try { process.loadEnvFile(rel(".env.local")); } catch (e) { /* fall back to the real environment */ }
const { STEAM_API_KEY: KEY, STEAM_PROFILE: PROFILE } = process.env;
if (!KEY || !PROFILE) {
  console.error("Set STEAM_API_KEY and STEAM_PROFILE in .env.local - see the top of this file.");
  process.exit(1);
}

global.window = {};
require(rel("data/games.js"));
require(rel("data/prices.js"));
const GAMES = window.GAMES, PRICES = window.PRICES;
const PINS = JSON.parse(fs.readFileSync(rel("tools/steam-overrides.json"), "utf8"));
const keyOf = g => g[0] + "|" + g[1];
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[™®]|\([^)]*\)/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/^the /, "").trim();

async function get(url){
  const r = await fetch(url);
  if (r.status === 403) throw new Error("Steam refused the API key (403). Check STEAM_API_KEY.");
  if (!r.ok) throw new Error("Steam request failed: " + r.status);
  return r.json();
}

async function steamId(){
  const s = PROFILE.trim().replace(/\/+$/, "");
  const id = s.match(/(?:^|\/profiles\/)(7656\d{13})$/);
  if (id) return id[1];
  const vanity = (s.match(/\/id\/([^/]+)$/) || [, s])[1];
  const j = await get("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=" +
    encodeURIComponent(KEY) + "&vanityurl=" + encodeURIComponent(vanity));
  if (!j.response || j.response.success !== 1) throw new Error("Couldn't find the Steam profile '" + vanity + "'.");
  return j.response.steamid;
}

(async () => {
  const sid = await steamId();
  const j = await get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=" + encodeURIComponent(KEY) +
    "&steamid=" + sid + "&include_appinfo=1&include_played_free_games=1&format=json");
  const library = (j.response && j.response.games) || [];
  if (!library.length) {
    console.error("Steam returned no games. Set Game details to Public (Profile > Edit Profile > Privacy Settings) and try again.");
    process.exit(1);
  }

  const apps = new Set(library.map(g => g.appid));
  const appOf = k => (PRICES[k] && PRICES[k].app) || PINS[k];
  const owned = new Set(), how = [];
  for (const g of GAMES) {
    const k = keyOf(g), app = appOf(k);
    if (app && apps.has(app)) { owned.add(k); how.push(k + "  (app " + app + ")"); }
  }
  // Name matching catches games the site has no price for. A Steam game already
  // matched by app id is spoken for: Steam's "Resident Evil 4" is the 2023 remake, and
  // must not also mark the 2005 original owned.
  const claimed = new Set([...owned].map(appOf));
  const byName = new Map(library.filter(g => !claimed.has(g.appid)).map(g => [norm(g.name || ""), g.appid]));
  for (const g of GAMES) {
    const k = keyOf(g);
    if (!owned.has(k) && byName.has(norm(g[1]))) { owned.add(k); how.push(k + "  (by name, app " + byName.get(norm(g[1])) + ")"); }
  }

  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(rel("exports"), { recursive: true });
  const out = rel("exports/steam-owned-" + today + ".json");
  fs.writeFileSync(out, JSON.stringify({ app: "games-list", kind: "owned", source: "steam", exported: today, o: [...owned] }, null, 1));
  console.log(how.join("\n"));
  console.log("\n" + library.length + " games in your Steam library; " + owned.size + " of them are on the list.");
  console.log("Wrote " + path.relative(ROOT, out) + " - on the site, press Import and pick it.");
})().catch(e => { console.error(e.message || e); process.exit(1); });
