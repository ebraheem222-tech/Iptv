# Verification — 2026-09-14

## Follow-up: real provider VOD catalog

Fixed a 61.7 MB VOD response exceeding the former 24 MB limit, and cleared stale catalog rows on navigation/request failure. The real provider returned 158,760 movie entries in 358 categories; compact cached metadata used approximately 36 MB. The updated bounded response limit is 128 MB, configurable up to 512 MB. Added regressions for large responses, the configured cap, and Live-to-Movies navigation with a failed movie response. Updated test run: 27 Node tests and 6 browser scenarios.

## Implemented scope

Personal Xtream-compatible IPTV backend and React client, browser preview, Samsung Tizen project, LG webOS developer package. Target devices are 2020-current Samsung/LG TVs. Supports named URL/username/password connection, live categories (including provider sports), movies, series seasons/episodes, search, favorites, resume progress, guide information when provided, and remote navigation.

## Automated checks

Final results: 25 Node tests passed. All 5 browser scenarios passed; the Samsung scenario was rerun after narrowing a title selector to distinguish the full film from its trailer. Production build, both TV bundle inspections and LG IPK packaging succeeded. Production dependency audit reported zero vulnerabilities.

- Node tests exercise the actual Express server against a local Xtream fixture: authentication, sanitized profiles, category/search/pagination, series expansion, guide decoding, favorites/progress isolation, restart-safe artwork, session revocation, HLS rewriting and byte ranges.
- Network/vault/media regressions exercise private-address rejection, pinned DNS under Node 22, redirects, cancellation, encryption, keys, immutable session metadata, resource limits and listener cleanup during long streams.
- Browser flows cover connection, demo browsing, favorite persistence, seasons, player opening/closing, remote OK/Back/directional keys, backend settings, category controls, mobile width, resolved movie extensions and navigation during pending requests.
- Production build emits a classic JavaScript IIFE targeting Chrome 68 with local assets. Samsung manifest, LG appinfo, packaged assets and generated LG IPK are checked.

## Public playback observed

- W3C Sintel trailer MP4 decoded in Chromium: 854 × 480, playback time advanced beyond 1 second.
- Unified Streaming Tears of Steel HLS decoded through the backend's rewritten playlists and segments in Chromium: initial adaptive rendition 224 × 100, readyState 4, playback time advanced beyond 1 second.
- Test media come from public demo endpoints, not the user's subscription. Sample channel rows play demo videos and are clearly labeled as a demo experience.

## Review fixes included

Pinned DNS callback shape, sanitized upstream diagnostics, protected stream filenames, stateless encrypted artwork links surviving restart, bounded provider concurrency, restricted web origins, immutable vault identifiers, active-stream cancellation, bounded drain listeners, remote-select/summary support, separate Play/Pause/Stop keys, backend-switch session reset, resolved movie extensions, Favorites loading state, and browser HLS engine selection.

## Remaining device-dependent validation

- No real subscription URL or credentials were supplied, so provider-specific behavior is unverified.
- Samsung and LG physical TVs, native decoder support, AVPlay lifecycle and firmware differences require on-device testing.
- LG IPK is a developer-mode package. Samsung signing needs a developer certificate and device permissions; no signed WGT is provided.
- Docker Compose configuration was checked. Docker image execution was unavailable because the local Docker engine was stopped.
- No transcoding, DRM removal, store submission or publication was performed.
