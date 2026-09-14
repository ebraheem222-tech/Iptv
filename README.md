# Nova TV

Nova TV is a personal IPTV client for an existing paid, Xtream-compatible subscription. It provides one React interface for browsers, Samsung Tizen TVs, and LG webOS TVs, backed by a small Node service that keeps provider credentials off the television and proxies media with short-lived URLs.

You must supply your own legitimate provider account. Nova assumes the provider supports Xtream's `player_api.php` interface; it does not include channels or credentials.

## Run locally

Requires Node.js 22.15 or newer.

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/media` to the API at `http://localhost:3000`. Choose **Demo** to explore without a provider, or add a connection with a playlist label, server URL, username, and password.

For a production-style local run:

```sh
npm run build
npm start
```

The server listens on `0.0.0.0:3000` by default and serves the built client. From another device on the LAN, use `http://<computer-lan-ip>:3000`.

## Configuration

Copy `.env.example` to `.env` if you need overrides. `PORT` defaults to `3000`, `HOST` to `0.0.0.0`, `DATA_DIR` to `./data`, and `ALLOW_PRIVATE_PROVIDERS` to `false`. Keep that default unless your provider endpoint is deliberately hosted on your private LAN.

`VAULT_KEY` is an optional base64-encoded 32-byte key. When omitted, the server generates a key and persists it in `DATA_DIR`. Back up or move the entire data directory, including its key, as one unit; saved credentials cannot be decrypted if the key is lost or separated from the data. `CORS_ORIGINS` accepts a comma-separated allowlist. Defaults cover the server origin, local development, packaged TV origins, and `null` origins used by some TV runtimes.

Docker keeps the encrypted database and generated vault key together in the `nova-data` volume:

```sh
docker compose up --build -d
```

This is a single-process home backend. Put it behind an HTTPS reverse proxy before exposing it outside your trusted LAN, and set an explicit `CORS_ORIGINS` allowlist.

## Checks

Large provider catalogs use a bounded 128 MB response limit, adjustable with `PROVIDER_MAX_RESPONSE_MB` (maximum 512). Catalogs are compacted to browsing fields before caching; individual movie and episode details load separately. The first load of a large library can take several seconds.

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

The browser tests start the local API and Vite automatically when needed. They cover demo connection, remote navigation, mobile layout, favorites, season selection, and playback requests. Public sample MP4 and HLS playback was also checked in Chromium. Actual Samsung/LG playback and your subscription still need testing on your televisions. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the recorded checks.

## TV projects

```sh
npm run build:tv
```

This creates unpackaged projects in `build/samsung` and `build/lg`. Each contains all JavaScript, CSS, icons, and artwork locally. `config.js` runs before the application and defines:

```js
window.NOVA_CONFIG = { apiBase: '' };
```

Leave it empty to enter the backend URL in the app, or set it to a reachable LAN URL such as `http://192.168.1.20:3000` before running the vendor packaging command. Do not use `localhost`; on a TV that points to the TV itself. Full Samsung and LG steps are in [docs/TV-INSTALL.md](docs/TV-INSTALL.md).

An LG Developer Mode IPK can be produced without adding a project dependency:

```sh
npm exec --yes --package=@webos-tools/cli@3.2.6 -c "ares-package build/lg -o build"
```

The resulting `build/tv.nova.app.iptv_1.0.0_all.ipk` is a developer package ready for the LG installation step. The Samsung folder still requires a user-owned Samsung certificate profile to create its signed WGT.

The demo uses Blender Foundation open-movie samples hosted by [W3C Media Resources](https://media.w3.org/2010/05/) and an HLS Tears of Steel sample hosted by [Unified Streaming](https://demo.unified-streaming.com/). Demo artwork and media source details are recorded in `public/artwork/SOURCES.md`.

## Limits

Nova does not transcode. Playback depends on the TV model, firmware, container, codec, bitrate, subtitles, and the provider stream. HLS is supported through the platform/browser player path, but a stream playable on one model may fail on another. Provider connection limits still apply: avoid opening more simultaneous streams than your subscription permits, and stop playback before testing another device.

The build target is a classic IIFE compatible with the Chrome 68-level engine used as the 2020 TV baseline. Automated checks cannot prove AVPlay, remote-key, codec, or model-specific behavior; test the unsigned project in vendor tools and the signed package on each target family. Store publication is a separate vendor review process and is outside this project.

Validation on 2026-09-14 used Node 22.15.1: the classic bundle and both TV project directories built successfully, all 16 API/security tests passed, manifest JSON/XML parsed, required package assets and icon dimensions were checked, and all HTML runtime scripts/styles were local. The pinned webOS CLI created and inspected the LG Developer Mode IPK. Tizen Studio and a Samsung signing identity were unavailable, and Docker Desktop's engine was stopped; consequently no signed WGT, container image, emulator run, or physical-TV/codec test was performed.
