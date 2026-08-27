# games-list

Two checklists of games worth playing, with the recommended way to play each one.

- **The Canon** (`index.html`) — 297 titles, the historical spine.
- **The Playlist** (`playlist.html`) — 225 of those that still hold up today.

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
data/games.js          every game -> window.GAMES
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

- `console group` means *where to play it now*, not what it originally shipped on, and
  it must be one of the strings in `CONSOLE_ORDER` at the top of `assets/app.js`. The
  console view iterates that list, so an unlisted platform is silently dropped.
- `rough time` is either a number of hours (`"12h"`) or `"∞"` for something endless.
  Endless games are excluded from the length filters, since they have no length to fit.

## Running it locally

```
python -m http.server 8000
```

then open <http://localhost:8000>. Opening the files directly with `file://` will render
but won't save progress or register the service worker, since browsers restrict both on
local files.

## Deploying

Pushing to `main` publishes via GitHub Pages. No build step. If you change a cached
asset and want existing installs to pick it up immediately, bump `CACHE` in `sw.js`.
