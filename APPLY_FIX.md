# Nova TV player fix

This package replaces the player with an enhanced version and adds styles/tests.

## What changes

- HLS fatal network errors retry automatically with bounded exponential backoff.
- HLS fatal media/codec errors use `recoverMediaError()` and audio-codec swapping on repeated failures.
- Native HLS playback (including webOS path) retries transient live failures before showing the error screen.
- VOD gets a real seek slider with current time and duration.
- Volume slider + mute control.
- Captions/CC toggle when subtitle tracks exist.
- Browser fullscreen toggle and double-click fullscreen.
- Existing Samsung AVPlay transport controls are preserved; Samsung audio/subtitle APIs are used when available.
- Added Playwright coverage for the new controls.

## Apply

Copy these files into the repository, preserving paths:

- `src/components/Player.jsx`
- `src/components/Player.css`
- `tests/player-controls.spec.js`
- `playwright.config.js`

Then run:

```sh
npm ci
npm test
npm run build
npm run test:e2e
```

For the TV projects rebuild afterward:

```sh
npm run build:tv
```

## Note about LIVE duration

A normal live stream has no fixed total duration, so the player intentionally shows a LIVE indicator instead of a fake duration/seek bar. VOD/episodes get the full seek timeline.
