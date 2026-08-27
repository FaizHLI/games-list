# games-list

Two checklists of games worth playing, with the recommended way to play each one.

- **The Canon** (`index.html`) — 261 titles, the historical spine.
- **The Playlist** (`playlist.html`) — 204 titles: everything from the canon that still
  holds up today, plus a handful of additions.

Both pages share one progress store (`localStorage`, keyed `year|title`), so checking a
game off on one list checks it off on the other. 188 titles overlap.

## Layout

```
index.html        The Canon
playlist.html     The Playlist
assets/app.css    shared styles
assets/app.js     shared rendering, filtering, and persistence
data/canon.js     canon rows      -> window.DATA
data/playlist.js  playlist rows   -> window.DATA
original/         the two standalone files this site was built from
```

Each row is `[year, title, rating, best way to play, console group, rough time]`.
To add or change a game, edit the relevant file in `data/` — nothing else needs touching.

## Running it locally

Any static server works, e.g.:

```
python -m http.server 8000
```

then open <http://localhost:8000>. Opening the files directly with `file://` will render
but may not save progress, since browsers restrict storage on local files.

## Deploying

Pushing to `main` publishes via GitHub Pages. No build step.
