# games-list

Two checklists of games worth playing, with the recommended way to play each one.

- **The Canon** (`index.html`) — 297 titles, the historical spine.
- **The Playlist** (`playlist.html`) — 225 of those that still hold up today.

The playlist is a *derived view*, not a second list: it renders every game flagged
`true` in the last field of `data/games.js`. There is one source of truth, so the two
pages can't drift apart.

Both pages share one progress store (`localStorage`, keyed `year|title`), so checking a
game off on one list checks it off on the other.

Scope is home console and PC. Mobile and annual sports releases are deliberately out.

## Layout

```
index.html        The Canon      (<body data-list="canon">)
playlist.html     The Playlist   (<body data-list="playlist">)
assets/app.css    shared styles
assets/app.js     shared rendering, filtering, and persistence
data/games.js     every game -> window.GAMES
original/         the two standalone files this site was built from
```

Each row is:

```
[year, title, rating, best way to play, console group, rough time, on the playlist]
```

To add a game, append a row to `data/games.js` — nothing else needs touching. Rows are
sorted by year; within a year the order is curated, so put a new entry where you want it.

`console group` means *where to play it now*, not what it originally shipped on, and it
must be one of the strings in `CONSOLE_ORDER` at the top of `assets/app.js` — the console
view iterates that list, so an unlisted platform is silently dropped.

## Running it locally

Any static server works, e.g.:

```
python -m http.server 8000
```

then open <http://localhost:8000>. Opening the files directly with `file://` will render
but may not save progress, since browsers restrict storage on local files.

## Deploying

Pushing to `main` publishes via GitHub Pages. No build step.
