# games-list

Two checklists of games worth playing, with the recommended way to play each one.

- **The Canon** (`index.html`) — 974 titles, the historical spine.
- **The Playlist** (`playlist.html`) — 669 of those that still hold up today.

Live at <https://faizhli.github.io/games-list/>.

The playlist is a *derived view*, not a second list: it renders every game flagged
`true` in the last field of `data/games.js`. There is one source of truth, so the two
pages can't drift apart.

Scope is home console and PC. Mobile and annual sports releases are deliberately out.

## What it does

- **Three states per game.** Tapping a row marks it played. The small ▶ marks the one
  you're playing now — a rare state, so it gets its own control and leaves the one-tap
  row click meaning "done".
- **Time remaining.** The stats line under the bar totals the hours left in whatever is
  currently on screen, so filtering to one platform answers "how long is what's left
  here". Games marked `∞` are counted separately as endless.
- **Filters:** search, minimum rating, maximum length, and platform. Sort by year,
  platform, or rating. Hide played.
- **Two ratings per game, kept apart.** The first badge is the IGDB community average
  (IGDB is the database Backloggd is built on), in stars to one decimal like Backloggd.
  The blue one beside it is yours: tap it to rate in half stars. The rating chips filter
  on IGDB; sort by **IGDB** or by **Mine**, which groups your scores and puts unrated
  games last.
- **Tap a game** for its panel: played/playing, **owned**, **in cart**, your rating,
  IGDB and Backloggd links, and prices. The checkbox on the left still marks a game
  played in one tap. Owned games get an OWNED tag, and More → Show filters by it.
- **Prices** are a gg.deals snapshot for every game sold on Steam (about 490): best
  retail and keyshop price now, and the lowest ever. Games bought as part of a
  collection say so ("Sold as Castlevania Anniversary Collection"). Switch games link
  to Deku Deals, which has no API.
- **Cart** totals what the games you've added cost now, counting a collection once
  even when several of its games are in the cart. It appears once something is in it.
- **Pick one** chooses at random from what's on screen and not already finished.
- **Shared progress.** Both pages read one store, keyed `year|title`. Open in two tabs
  and they stay in sync.
- **Export / Import** moves progress between browsers and devices as a JSON file.
  Importing replaces rather than merges, so a game left unmarked in the file ends up
  unmarked here.
- **Filter state lives in the URL**, so a view like `?r=5&p=PS1` can be shared.
- **Light and dark**, following the system by default; the Theme button overrides it.
- **Installable and offline.** A service worker caches the shell, so it works on a
  phone with no connection.

## Layout

```
index.html             The Canon      (<body data-list="canon">)
playlist.html          The Playlist   (<body data-list="playlist">)
assets/app.css         styles, including the light/dark tokens
assets/app.js          rendering, filtering, marking, persistence
assets/fonts.css       @font-face for the self-hosted fonts
assets/fonts/          Press Start 2P + Public Sans woff2, and their OFL licence
assets/icon-*.png      app icons
assets/make-icons.js   regenerates those icons: node assets/make-icons.js
build.js               regenerates the two pages and sw.js: node build.js
data/games.js          every game -> window.GAMES
data/scores.js         IGDB ratings -> window.SCORES (generated, don't edit)
tools/fetch-scores.js  regenerates data/scores.js from IGDB
tools/igdb-overrides.json  hand-pinned IGDB ids for games the matcher gets wrong
data/prices.js         gg.deals price snapshot -> window.PRICES (generated, don't edit)
tools/fetch-prices.js  regenerates data/prices.js
tools/steam-overrides.json  hand-pinned Steam app ids: collections, remasters, misses
sw.js                  offline cache
manifest.webmanifest   PWA metadata
original/              the two standalone files this site was built from
```

## Editing the list

Each row is:

```
[year, title, rating, best way to play, console group, rough time, on the playlist]
```

To add a game, append a row to `data/games.js` — nothing else needs touching. Rows are
sorted by year; within a year the order is curated, so put a new entry where you want it.

Two constraints worth knowing:

- `console group` is the platform the game first shipped on, not where to play it now —
  Super Metroid is SNES even though the best way to play it is NSO. A game that launched
  on several consoles at once, or on PC, is grouped where it's best played instead. It
  must be one of the strings in `CONSOLE_ORDER` at the top of `assets/app.js`. The
  console view iterates that list, so an unlisted platform is silently dropped.
- `rough time` is either a number of hours (`"12h"`) or `"∞"` for something endless.
  Endless games are excluded from the length filters, since they have no length to fit.

### Refreshing the ratings

`node tools/fetch-scores.js` searches IGDB for every game (about 10 minutes) and
rewrites `data/scores.js`; then run `node build.js`. It needs Twitch API credentials in
`.env.local`, which is gitignored — the top of the script says how to get them.

Matching is by name and year. Whatever it can't match, or matches to an entry with
fewer than 5 ratings, is listed in `tools/fetch-report.txt`. Pin those in
`tools/igdb-overrides.json` as `"year|title": <IGDB id>` (or `null` to keep the list's
own 1–5 score), then `node tools/fetch-scores.js --pinned` refetches just the pinned
games in a few seconds. A new game with no IGDB score falls back to its own rating.

### Refreshing the prices

`node tools/fetch-prices.js`, then `node build.js`. It needs `GGDEALS_API_KEY` in
`.env.local` as well as the Twitch credentials, since each game's Steam app id comes
from its IGDB entry. gg.deals prices at most 1000 games an hour and one run uses
about 950, so don't run it twice in an hour.

When the game you'd buy isn't the game's own IGDB entry — a collection, a remaster —
pin its Steam app id in `tools/steam-overrides.json`. `tools/prices-report.txt` lists
PC games still without a price; `tools/prices-matches.txt` shows what each game
matched, worth a skim after adding pins.

Progress is stored per `year|title`, so renaming a game or changing its year orphans
whatever was saved under the old key. To carry it over, add `"old year|old title": "new
year|new title"` to `window.RENAMED` at the bottom of `data/games.js`; the app moves
saved and imported progress across on load.

## Running it locally

```
python -m http.server 8000
```

then open <http://localhost:8000>. Opening the files directly with `file://` will render
but won't save progress or register the service worker, since browsers restrict both on
local files.

## Deploying

**Run `node build.js` before committing any change to `assets/` or `data/`.** Then push
to `main`; GitHub Pages does the rest.

`build.js` writes `index.html`, `playlist.html` and the service worker's file list,
stamping every asset URL with a hash of its contents (`app.js?v=b389a3c6`). This is not
cosmetic. GitHub Pages serves everything with `Cache-Control: max-age=600`, so without
the stamp a deploy can hand a browser the new HTML while it reuses the old `app.js` from
cache for up to ten minutes — new markup driven by old code, which looks broken rather
than merely out of date. With the stamp, new HTML can only ever request assets that
match it, and the service worker's cache name changes with them so old caches are
retired on activation.

The one thing the stamp cannot cover is the HTML itself, which is also cached for ten
minutes. A returning visitor may see the previous version for that long — but a
consistent previous version, not a mixture. Ctrl+Shift+R skips it.
