# The Autocomplete Trap

A self-paced, full-screen prediction lab mission (about 10–15 minutes).

## Launch

- **Double-click `index.html`.** It runs straight from the folder.
- Or upload the whole folder to any static web host and open `index.html`.

Everything is in this folder (no internet, CDN, font service or account needed), so it works fully offline.

## Browser

Chrome, Edge or Firefox (current versions), or Safari 18.4+. Older Safari versions have no Ogg audio support and run with captions only. Best in landscape; the mission scales to any screen size.

## Web hosting notes

- Serve `.ogg` as `audio/ogg`, `.webp` as `image/webp`, `.woff2` as `font/woff2`.
- A loading bar fills before **Start Mission** appears, so the mission never waits on the network once it starts.
- When embedded in an iframe, the game posts `{ type: 'mission-complete' }` to the parent page on finish.
