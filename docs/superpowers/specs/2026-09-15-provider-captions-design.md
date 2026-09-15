# Provider captions design

## Purpose and scope

Add captions already supplied with provider movies and series episodes to Nova TV. The same caption menu and visual presentation must work in desktop browsers, LG webOS packages, and Samsung Tizen packages. Arabic is the preferred language: when an Arabic text track exists, Nova selects and enables it automatically. When Arabic is absent, Nova lists the other compatible tracks but leaves captions off until the viewer selects one.

This stage does not generate, translate, download from third-party subtitle sites, or OCR captions. Automatic speech recognition and Arabic translation are a later project. Live-TV caption behavior is unchanged.

## Success criteria

- Opening a movie or episode starts playback without waiting for caption discovery.
- The CC menu lists compatible embedded and HLS subtitle tracks with useful language labels.
- Arabic language variants such as `ar`, `ara`, `ar-*`, `Arabic`, and `العربية` are normalized to `العربية`, ordered first, and automatically selected.
- Captions can be turned off or switched with a mouse, keyboard, or TV remote.
- Caption text is readable right-to-left and remains above Nova's playback controls.
- Caption discovery or conversion failure never stops or restarts video playback.
- Provider credentials and provider media URLs are not returned to the client or written to logs.

## Selected architecture

Use a shared Nova caption controller and renderer with platform-specific cue sources.

For browsers and LG, the backend probes the provider media through Nova's existing authenticated media proxy. Text subtitle streams are converted on demand to WebVTT-compatible cue data. The frontend downloads the converted result, parses the cues, and synchronizes Nova's caption overlay with the player's current playback time.

For Samsung, AVPlay remains the first choice for embedded text tracks. After preparation, Nova reads `getTotalTrackInfo()`, safely parses each TEXT track's metadata, and selects the Arabic track with `setSelectTrack('TEXT', index)`. `setSilentSubtitle(true)` suppresses the platform rendering, and `onsubtitlechange` supplies cues to Nova's shared renderer. If AVPlay does not expose a track that the backend can extract, the WebVTT cue source is the fallback and synchronizes against `getCurrentTime()`.

Existing native and hls.js subtitle renditions are normalized into the same caption menu. The selected approach keeps one user experience while using the most reliable cue source on each platform.

## Backend components

### Caption tickets

`POST /api/play` keeps its current fields and adds an optional authenticated `captionsUrl` for movies and episodes. The URL contains a dedicated opaque caption ticket bound to the same user session and upstream media target as the playback ticket. The ticket must not contain a provider URL or credentials and expires with the media authorization.

The caption routes require both a valid bearer session and a caption ticket owned by that session:

- `GET /api/captions/:ticket` probes the media and returns `{tracks}`.
- `GET /api/captions/:ticket/:trackId.vtt` extracts one previously reported compatible text track and returns `text/vtt; charset=utf-8` with inline content disposition.

Each track is `{id,index,language,label,title,default,forced,source}`. `id` is an opaque server value mapped to an ffprobe stream index; the client cannot supply an arbitrary map expression or path. `source` is `embedded` or `hls`.

### Probe and conversion service

The service resolves FFprobe and FFmpeg from explicit `NOVA_FFPROBE_PATH` and `NOVA_FFMPEG_PATH` settings first, then from pinned platform binary dependencies. The binaries run only on the Node backend; they are not packaged inside the LG or Samsung applications.

FFprobe receives a loopback URL containing an opaque media ticket, so provider credentials do not appear in child-process arguments. It selects subtitle streams and requests JSON output. Only text codecs convertible to WebVTT are reported as compatible in this stage. Bitmap codecs such as PGS and VobSub are recorded internally as unsupported and are not offered as playable caption choices.

FFmpeg converts only the selected subtitle stream to WebVTT. Processes are created with an argument array and shell execution disabled. Probe and conversion have separate timeouts, capped output, and a small concurrency limit so several remote clicks cannot exhaust the home server.

### Cache and cleanup

Probe results and converted WebVTT are cached by an internal hash of media identity and track index. Cache entries are shared only at the server layer; access still requires the current session and ticket. Temporary caption files live in a Nova-owned subdirectory of the operating-system temporary directory. Expired entries are deleted during normal cache maintenance and stale Nova caption files are removed on server startup. Captions are never stored beside application source or provider credentials.

## Frontend components

### Caption controller

Player state moves into a focused caption controller that owns track discovery, selection, cue updates, and cleanup. It accepts adapters for HTML video/hls.js, Samsung AVPlay, and server WebVTT while exposing one interface to `Player.jsx`:

- normalized ordered tracks;
- selected track or off;
- current cue text;
- loading and nonfatal error state;
- select, disable, and reset operations.

Discovery starts after the media player is opened and never blocks playback readiness. Requests are aborted and AVPlay subtitle state is cleared when the viewer closes the player, switches content, or starts another episode.

### Arabic preference

Language normalization is case-insensitive and recognizes ISO 639-1/639-2 codes, regional tags beginning with `ar-`, English `Arabic`, and Arabic `العربية`. Arabic tracks sort before all other tracks. If several Arabic tracks exist, a provider-default Arabic track wins, followed by a non-forced Arabic track, then provider order. The automatic choice happens once for each newly opened media item. A viewer can still turn captions off or select another language.

### Shared overlay and controls

Nova renders caption text as text nodes, never as subtitle-provided HTML. The overlay uses RTL direction and centered text for Arabic, preserves line breaks, constrains line width, and uses a high-contrast background and text shadow. It sits above the video plane and above the safe-area bottom edge; when controls are visible it moves high enough not to overlap them.

The existing CC button opens a remote-navigable list containing `Off` followed by available tracks, with Arabic at the top. While discovery runs, the control shows a loading state. An empty or failed result becomes `No compatible captions`; details are logged without displaying provider addresses. Track selection and the current item are announced visually, and remote focus returns to the CC button when the menu closes.

## Data flow

1. The viewer opens a movie or episode and `POST /api/play` returns the media URL plus `captionsUrl`.
2. Video preparation starts immediately.
3. The caption controller asks native/hls.js adapters for already visible tracks and requests `captionsUrl` in parallel.
4. The backend validates the bearer session and caption ticket, then serves a cached probe result or runs FFprobe through the loopback media proxy.
5. The controller merges and de-duplicates tracks, normalizes labels, and selects Arabic when available.
6. Samsung selects a matching AVPlay TEXT track and receives cue callbacks. Browser, LG, or Samsung fallback requests the selected `.vtt` endpoint and synchronizes parsed cues with current playback time.
7. Selecting another track swaps the cue source without reopening the video. Selecting Off clears the active cue immediately.
8. Closing or changing media aborts requests, clears timers and cues, and invalidates component state; normal server ticket expiry handles authorization cleanup.

## Error handling and limits

- Missing FFmpeg/FFprobe makes server extraction unavailable but leaves playback and native/HLS tracks operational.
- Probe timeout, provider range failure, invalid metadata, conversion failure, oversized output, and malformed WebVTT are nonfatal caption errors.
- An expired or foreign caption ticket returns the same authorization behavior as media access and reveals no upstream details.
- The server never accepts a filesystem path, upstream URL, codec, or raw FFmpeg argument from the client.
- Unsupported bitmap subtitle tracks are omitted from the selectable list in this stage.
- A late result from old media is ignored using an operation generation identifier in addition to request cancellation.
- Caption errors use rate-limited structured logs with ticket identifiers redacted and upstream URLs sanitized.

## Testing and validation

Backend automated tests cover session ownership, expired and forged tickets, argument injection attempts, Arabic and non-Arabic metadata, text-versus-bitmap filtering, timeout and process failure, output caps, conversion MIME/disposition, cache reuse, and cleanup. Media fixtures include a small file with English and Arabic text tracks and a bitmap-subtitle metadata fixture.

Frontend tests cover language normalization and ordering, Arabic auto-selection, Off behavior, de-duplication, stale-result rejection, WebVTT parsing and cue boundaries, safe text rendering, and controller cleanup. Samsung tests mock `getTotalTrackInfo`, `setSelectTrack`, `setSilentSubtitle`, `onsubtitlechange`, seeking, and fallback synchronization. Browser end-to-end tests verify that playback starts before discovery completes and that an Arabic cue appears and can be disabled.

Production builds for the browser, LG, and Samsung are required. LG and Samsung manifests and packaged assets are checked. Emulator or mocked validation does not count as physical hardware proof; final handoff must state whether actual LG and Samsung devices were tested.

## Deployment notes

Pinned FFmpeg and FFprobe binary dependencies make local Windows development work without a manual system installation. Explicit binary-path environment variables support Docker and hosts that maintain their own FFmpeg installation. README and environment documentation will explain the backend-only dependency, caption cache location, supported text subtitle types, and the limitation for bitmap captions.

## References

- Samsung AVPlay API: <https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html>
- Samsung subtitle guide: <https://developer.samsung.com/smarttv/develop/guides/multimedia/subtitles.html>
- LG webOS media specifications: <https://webostv.developer.lge.com/develop/specifications/video-audio-50>
- FFprobe documentation: <https://ffmpeg.org/ffprobe.html>
