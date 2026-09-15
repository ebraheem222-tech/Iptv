# Provider Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Display provider-supplied movie and episode captions in Nova TV on browsers, LG webOS, and Samsung Tizen, automatically selecting Arabic when it exists.

**Architecture:** The backend binds an opaque caption ticket to the existing media ticket, probes subtitle streams through the loopback media proxy, and converts a selected text stream to cached WebVTT. A frontend caption controller merges server, HTML/HLS, and Samsung AVPlay tracks, selects Arabic, and sends every cue to one safe RTL-aware overlay.

**Tech Stack:** Node.js 22, Express 5, FFmpeg/FFprobe child processes, React 18, hls.js, Node test runner, Playwright, esbuild targeting Chrome 68.

**Spec:** \`docs/superpowers/specs/2026-09-15-provider-captions-design.md\`

## Global Constraints

- Movies and series episodes are in scope; Live-TV caption behavior remains unchanged.
- Playback starts without waiting for caption discovery.
- Arabic variants \`ar\`, \`ara\`, \`ar-*\`, \`Arabic\`, and \`العربية\` normalize to \`العربية\`, sort first, and auto-select.
- If Arabic is absent, list compatible tracks but leave captions off.
- Text subtitle codecs are supported; bitmap PGS, VobSub, DVB subtitle, and XSUB tracks are not selectable.
- Caption failures are nonfatal and must not restart, pause, or cover working video.
- Never return or log provider credentials, upstream media URLs, raw FFmpeg arguments, or unredacted caption/media tickets.
- Never accept a filesystem path, upstream URL, codec, or process argument from a client.
- Render caption text as text nodes; never inject provider caption markup as HTML.
- Preserve the Chrome 68 build target and existing Samsung/LG packaging.
- Do not claim physical LG or Samsung validation unless it is actually performed.
- This workspace is not currently a Git repository. Do not initialize one implicitly. At each commit checkpoint, run \`git rev-parse --is-inside-work-tree\`; only run the listed commit if it succeeds.

---

### Task 1: Add a safe media-ticket descriptor

**Files:**

- Modify: \`server/media.js:1-176\`
- Modify: \`tests/security.test.js:167-310\`

**Interfaces:**

- Consumes: A media path returned by \`MediaProxy.issue(url, sessionId, stableId?)\`.
- Produces: \`MediaProxy.describe(mediaPath, sessionId) -> {mediaPath, cacheKey, expiresAt} | null\`.
- Security contract: \`describe\` returns no upstream URL, credentials, variant URL, or raw deduplication key.

- [ ] **Step 1: Write failing descriptor authorization tests**

Add these cases to \`tests/security.test.js\`:

~~~js
test("media descriptions expose only an opaque authorized identity", () => {
  const media = new MediaProxy({
    fetcher: async () => new Response("video"),
    getSession: (id) => (id === "owner" ? { id } : null),
  });
  const issued = media.issue(
    "https://user:pass@provider.example/movie.mkv?token=secret",
    "owner",
  );
  const description = media.describe(issued, "owner");

  assert.equal(description.mediaPath, issued);
  assert.match(description.cacheKey, /^[a-f0-9]{64}$/);
  assert.ok(description.expiresAt > Date.now());
  assert.doesNotMatch(JSON.stringify(description), /provider|user|pass|secret/);
  assert.equal(media.describe(issued, "another-session"), null);
  assert.equal(media.describe("/media/forged/media.mkv", "owner"), null);
  assert.equal(media.describe("https://provider.example/movie.mkv", "owner"), null);
});

test("revoking media also invalidates its safe description", () => {
  const media = new MediaProxy({
    fetcher: async () => new Response("video"),
    getSession: () => ({ id: "owner" }),
  });
  const issued = media.issue("https://provider.example/movie.mkv", "owner");
  media.revoke("owner");
  assert.equal(media.describe(issued, "owner"), null);
});
~~~

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

~~~powershell
node --test --test-name-pattern="media descriptions|safe description" tests/security.test.js
~~~

Expected: FAIL because \`media.describe\` does not exist.

- [ ] **Step 3: Implement strict path parsing and a hashed descriptor**

Import \`createHash\` beside \`randomBytes\`. Add a method that accepts only this proxy's own relative paths, validates the ticket and optional variant, verifies session ownership and current session existence, refreshes no authorization by itself, and hashes the internal identity:

~~~js
describe(mediaPath, sessionId) {
  this.#clean();
  if (typeof mediaPath !== "string" || !mediaPath.startsWith(this.basePath + "/"))
    return null;

  let parsed;
  try {
    parsed = new URL(mediaPath, "http://nova.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://nova.invalid") return null;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const baseParts = this.basePath.split("/").filter(Boolean);
  if (
    parts.length !== baseParts.length + 2 ||
    parts.slice(0, baseParts.length).join("/") !== baseParts.join("/")
  )
    return null;

  const ticket = parts[baseParts.length];
  const entry = this.tickets.get(ticket);
  if (
    !entry ||
    entry.sessionId !== sessionId ||
    !this.getSession(entry.sessionId)
  )
    return null;

  const variant = parsed.searchParams.get("v");
  if (variant && !entry.variants.has(variant)) return null;
  for (const key of parsed.searchParams.keys()) if (key !== "v") return null;

  return {
    mediaPath,
    cacheKey: createHash("sha256").update(entry.dedupKey).digest("hex"),
    expiresAt: entry.expiresAt,
  };
}
~~~

Do not add any method that exposes \`entry.url\), \`entry.variants\), or \`entry.dedupKey\).

- [ ] **Step 4: Run media/security tests**

Run:

~~~powershell
node --test tests/security.test.js tests/media-lifecycle.test.js tests/media-ticket-stability.test.js
~~~

Expected: all tests PASS and existing stable HLS ticket behavior remains unchanged.

- [ ] **Step 5: Record the task checkpoint**

Run \`git rev-parse --is-inside-work-tree\`. If it succeeds:

~~~powershell
git add server/media.js tests/security.test.js
git commit -m "feat: expose safe media ticket descriptors"
~~~

If it fails in the current workspace, skip the Git commands and do not initialize a repository.

---

### Task 2: Isolate FFprobe and FFmpeg process handling

**Files:**

- Create: \`server/caption-process.js\`
- Create: \`tests/caption-process.test.js\`
- Create: \`tests/caption-binaries.test.js\`
- Create: \`tests/fixtures/captions/english.srt\`
- Create: \`tests/fixtures/captions/arabic.srt\`
- Create: \`tests/fixtures/captions/bitmap-probe.json\`
- Modify: \`package.json:14-27\`
- Modify: \`package-lock.json\`

**Interfaces:**

- Produces: \`resolveCaptionBinaries(env) -> {ffprobePath, ffmpegPath, available}\`.
- Produces: \`runCaptionProcess(binary, args, {signal, timeoutMs, maxStdoutBytes}) -> Promise<Buffer>\`.
- Produces: \`parseSubtitleStreams(stdout) -> Array<{index,codec,language,title,default,forced}>\`.
- Supported text codecs: \`subrip\`, \`srt\`, \`ass\`, \`ssa\`, \`webvtt\`, \`mov_text\`, and \`text\`.

- [ ] **Step 1: Write failing normalization and process-safety tests**

Create \`tests/caption-process.test.js\` with deterministic JSON and a temporary Node child process:

~~~js
import test from "node:test";
import assert from "node:assert/strict";
import { execPath } from "node:process";
import {
  parseSubtitleStreams,
  runCaptionProcess,
} from "../server/caption-process.js";

test("subtitle probe output keeps text tracks and rejects bitmap tracks", () => {
  const tracks = parseSubtitleStreams(
    Buffer.from(JSON.stringify({
      streams: [
        {
          index: 2,
          codec_name: "ass",
          tags: { language: "ara", title: "Arabic" },
          disposition: { default: 1, forced: 0 },
        },
        {
          index: 3,
          codec_name: "hdmv_pgs_subtitle",
          tags: { language: "eng" },
          disposition: { default: 0, forced: 0 },
        },
      ],
    })),
  );
  assert.deepEqual(tracks, [{
    index: 2,
    codec: "ass",
    language: "ara",
    title: "Arabic",
    default: true,
    forced: false,
  }]);
});

test("caption processes cap stdout and honor timeout", async () => {
  await assert.rejects(
    runCaptionProcess(
      execPath,
      ["-e", "process.stdout.write('x'.repeat(2048))"],
      { timeoutMs: 2000, maxStdoutBytes: 32 },
    ),
    /output limit/i,
  );
  await assert.rejects(
    runCaptionProcess(
      execPath,
      ["-e", "setTimeout(() => {}, 5000)"],
      { timeoutMs: 20, maxStdoutBytes: 32 },
    ),
    /timed out/i,
  );
});
~~~

- [ ] **Step 2: Verify the tests fail for the missing module**

Run:

~~~powershell
node --test tests/caption-process.test.js
~~~

Expected: FAIL with module-not-found for \`server/caption-process.js\`.

- [ ] **Step 3: Add pinned backend binary dependencies**

Run:

~~~powershell
npm install --save-exact ffmpeg-static@5.3.0 @ffprobe-installer/ffprobe@2.1.2
~~~

Expected: \`package.json\` and \`package-lock.json\` record exact top-level versions. Do not add \`fluent-ffmpeg\); the server must use \`spawn\` with explicit arguments.

- [ ] **Step 4: Implement the binary resolver and bounded runner**

Create \`server/caption-process.js\`. Use \`spawn(binary, args, {shell: false, windowsHide: true})\), kill on timeout/abort, cap stdout and stderr, and never include the argument list in thrown errors:

~~~js
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const TEXT_CODECS = new Set([
  "subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text",
]);

export function resolveCaptionBinaries(env = process.env) {
  const ffprobePath = env.NOVA_FFPROBE_PATH || ffprobeInstaller?.path || "";
  const ffmpegPath = env.NOVA_FFMPEG_PATH || ffmpegStatic || "";
  return {
    ffprobePath,
    ffmpegPath,
    available: Boolean(ffprobePath && ffmpegPath),
  };
}

export function parseSubtitleStreams(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(stdout).toString("utf8"));
  } catch {
    return [];
  }
  return (Array.isArray(parsed.streams) ? parsed.streams : [])
    .filter((stream) =>
      Number.isInteger(stream.index) &&
      TEXT_CODECS.has(String(stream.codec_name || "").toLowerCase()),
    )
    .map((stream) => ({
      index: stream.index,
      codec: String(stream.codec_name).toLowerCase(),
      language: String(stream.tags?.language || "").slice(0, 32),
      title: String(stream.tags?.title || "").slice(0, 120),
      default: stream.disposition?.default === 1,
      forced: stream.disposition?.forced === 1,
    }));
}
~~~

\`runCaptionProcess\` must:

1. reject an empty/non-string binary and non-array arguments;
2. register the optional AbortSignal before spawning;
3. collect stdout up to \`maxStdoutBytes\` and stderr up to 64 KiB;
4. terminate with \`SIGKILL\` after timeout or limit breach;
5. resolve only on exit code zero;
6. reject with fixed messages: \`Caption tool unavailable\`, \`Caption process timed out\`, \`Caption process output limit exceeded\`, \`Caption process cancelled\`, or \`Caption process failed\`;
7. remove all timers and signal listeners on every completion path.

- [ ] **Step 5: Add cancellation and listener-cleanup assertions**

Extend \`tests/caption-process.test.js\`:

~~~js
test("caption processes honor an AbortSignal without leaking details", async () => {
  const controller = new AbortController();
  const running = runCaptionProcess(
    execPath,
    ["-e", "setTimeout(() => {}, 5000)"],
    { signal: controller.signal, timeoutMs: 2000, maxStdoutBytes: 32 },
  );
  controller.abort();
  await assert.rejects(running, /^Error: Caption process cancelled$/);
});
~~~

- [ ] **Step 6: Add a real local binary smoke test**

Create the two SRT fixtures with these exact contents:

~~~text
1
00:00:00,000 --> 00:00:01,500
Hello
~~~

~~~text
1
00:00:00,000 --> 00:00:01,500
مرحبا
~~~

Create \`bitmap-probe.json\` with one \`hdmv_pgs_subtitle\` stream and assert \`parseSubtitleStreams(readFile(...))\` returns an empty array.

Create \`tests/caption-binaries.test.js\`. Resolve the packaged binaries, generate a two-second MKV in a test-owned temporary directory, probe both text tracks, and convert the Arabic stream:

~~~js
const binaries = resolveCaptionBinaries();
assert.equal(binaries.available, true);
await runCaptionProcess(
  binaries.ffmpegPath,
  [
    "-v", "error",
    "-f", "lavfi",
    "-i", "color=c=black:s=32x32:d=2",
    "-i", englishPath,
    "-i", arabicPath,
    "-map", "0:v:0",
    "-map", "1:0",
    "-map", "2:0",
    "-metadata:s:s:0", "language=eng",
    "-metadata:s:s:1", "language=ara",
    "-c:v", "mpeg4",
    "-c:s", "srt",
    "-t", "2",
    "-y", mkvPath,
  ],
  { timeoutMs: 30_000, maxStdoutBytes: 64 * 1024 },
);
const probe = await runCaptionProcess(
  binaries.ffprobePath,
  [
    "-v", "error",
    "-select_streams", "s",
    "-show_entries",
    "stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced",
    "-of", "json",
    mkvPath,
  ],
  { timeoutMs: 12_000, maxStdoutBytes: 2 * 1024 * 1024 },
);
const tracks = parseSubtitleStreams(probe);
assert.deepEqual(tracks.map((track) => track.language), ["eng", "ara"]);
const arabic = tracks.find((track) => track.language === "ara");
await runCaptionProcess(
  binaries.ffmpegPath,
  [
    "-v", "error",
    "-nostdin",
    "-i", mkvPath,
    "-map", "0:" + arabic.index,
    "-c:s", "webvtt",
    "-f", "webvtt",
    "-y", vttPath,
  ],
  { timeoutMs: 30_000, maxStdoutBytes: 64 * 1024 },
);
assert.match(await readFile(vttPath, "utf8"), /مرحبا/);
~~~

Use \`mkdtemp(join(tmpdir(), "nova-caption-binary-"))\` and remove that exact directory in \`finally\`.

- [ ] **Step 7: Run the process and binary tests**

Run:

~~~powershell
node --test tests/caption-process.test.js tests/caption-binaries.test.js
~~~

Expected: all caption-process tests PASS, both packaged binaries execute, the generated MKV exposes English and Arabic text tracks, Arabic converts to WebVTT, and no child process remains.

- [ ] **Step 8: Record the task checkpoint**

If Git is available:

~~~powershell
git add package.json package-lock.json server/caption-process.js tests/caption-process.test.js tests/caption-binaries.test.js tests/fixtures/captions
git commit -m "feat: add bounded caption process runner"
~~~

Otherwise skip the Git commands.

---

### Task 3: Build the caption ticket, probe, conversion, and cache service

**Files:**

- Create: \`server/captions.js\`
- Create: \`tests/captions-server.test.js\`

**Interfaces:**

- Consumes: \`media.describe(mediaPath, sessionId)\`, \`runCaptionProcess\`, resolved binary paths, a fixed loopback base supplied by the route, and optional injected \`logger\`/\`now\` test dependencies.
- Produces: \`CaptionService.issue(mediaPath, sessionId) -> "/api/captions/:ticket"\`.
- Produces: \`CaptionService.list(ticket, sessionId, loopbackBase, {signal?}) -> {tracks}\`.
- Produces: \`CaptionService.vtt(ticket, trackId, sessionId, loopbackBase, {signal?}) -> Buffer\`.
- Produces: \`CaptionService.revoke(sessionId)\` and \`CaptionService.close()\`.

- [ ] **Step 1: Write failing service authorization and probe tests**

Create \`tests/captions-server.test.js\` using a fake media descriptor and injected process runner:

~~~js
import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CaptionService } from "../server/captions.js";

const probeJson = Buffer.from(JSON.stringify({
  streams: [
    {
      index: 4,
      codec_name: "ass",
      tags: { language: "ara", title: "Arabic Full" },
      disposition: { default: 1, forced: 0 },
    },
    {
      index: 7,
      codec_name: "subrip",
      tags: { language: "eng", title: "English" },
      disposition: { default: 0, forced: 0 },
    },
    { index: 8, codec_name: "hdmv_pgs_subtitle" },
  ],
}));

test("caption tickets are session-bound and expose opaque text tracks", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "nova-tv-captions-test-"),
  );
  const calls = [];
  const service = new CaptionService({
    media: {
      describe: (path, sessionId) =>
        path === "/media/valid/media.mkv" && sessionId === "owner"
          ? { mediaPath: path, cacheKey: "a".repeat(64), expiresAt: Date.now() + 60000 }
          : null,
    },
    getSession: (id) => (id === "owner" ? { id } : null),
    tempRoot: directory,
    binaries: { available: true, ffprobePath: "probe", ffmpegPath: "convert" },
    runProcess: async (binary, args) => {
      calls.push({ binary, args });
      return probeJson;
    },
  });
  try {
    const url = service.issue("/media/valid/media.mkv", "owner");
    assert.match(url, /^\/api\/captions\/[A-Za-z0-9_-]+$/);
    const ticket = url.split("/").at(-1);
    await assert.rejects(
      service.list(ticket, "intruder", "http://127.0.0.1:3000"),
      /not found/i,
    );
    const result = await service.list(
      ticket,
      "owner",
      "http://127.0.0.1:3000",
    );
    assert.deepEqual(result.tracks.map((track) => track.language), ["ara", "eng"]);
    assert.ok(result.tracks.every((track) => /^[A-Za-z0-9_-]+$/.test(track.id)));
    assert.doesNotMatch(JSON.stringify(result), /media\/valid|127\.0\.0\.1/);
    assert.equal(calls[0].binary, "probe");
    assert.deepEqual(calls[0].args.slice(0, 4), [
      "-v", "error", "-select_streams", "s",
    ]);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
~~~

- [ ] **Step 2: Verify the service test fails**

Run:

~~~powershell
node --test tests/captions-server.test.js
~~~

Expected: FAIL with module-not-found for \`server/captions.js\`.

- [ ] **Step 3: Implement tickets and probe mapping**

Create \`CaptionService\` with constants:

~~~js
const TICKET_TTL_MS = 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 12_000;
const CONVERT_TIMEOUT_MS = 30_000;
const MAX_PROBE_BYTES = 2 * 1024 * 1024;
const MAX_VTT_BYTES = 10 * 1024 * 1024;
const MAX_TICKETS = 2_000;
const MAX_CONCURRENT_PROCESSES = 2;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const LOG_INTERVAL_MS = 60_000;
~~~

The FFprobe argument array must be exactly shaped from constants plus the internally constructed URL:

~~~js
const args = [
  "-v", "error",
  "-select_streams", "s",
  "-show_entries",
  "stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced",
  "-of", "json",
  sourceUrl,
];
~~~

Validate \`loopbackBase\` as an HTTP URL whose hostname is exactly \`127.0.0.1\` or \`::1\`. Construct \`sourceUrl\` with \`new URL(entry.mediaPath, loopbackBase)\`; never accept a base from a request header. Materialize fresh opaque track IDs for each caption ticket and map them server-side to the reported integer stream indexes.

If binaries are unavailable, \`list\` returns \`{tracks: []}\` and emits one sanitized startup warning. Foreign, expired, revoked, or forged tickets throw \`new AppError(404, "Captions not found.")\`.

Each ticket expiry is \`Math.min(descriptor.expiresAt, now() + TICKET_TTL_MS)\`. Before issuing or resolving, delete expired tickets and evict oldest tickets until size is below \`MAX_TICKETS\`. A failed probe is removed from the in-flight map so a later request may retry.

- [ ] **Step 4: Write failing conversion, cache, timeout, and cleanup tests**

Add this self-contained conversion and cache case to \`tests/captions-server.test.js\`:

~~~js
test("VTT extraction maps only a reported opaque track and reuses its cache", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "nova-tv-captions-test-"),
  );
  const calls = [];
  const service = new CaptionService({
    media: {
      describe: (path, sessionId) =>
        path === "/media/valid/media.mkv" && sessionId === "owner"
          ? {
              mediaPath: path,
              cacheKey: "a".repeat(64),
              expiresAt: Date.now() + 60_000,
            }
          : null,
    },
    getSession: (id) => (id === "owner" ? { id } : null),
    tempRoot: directory,
    binaries: {
      available: true,
      ffprobePath: "probe",
      ffmpegPath: "convert",
    },
    runProcess: async (binary, args) => {
      calls.push({ binary, args });
      if (binary === "probe") return probeJson;
      await writeFile(
        args.at(-1),
        "WEBVTT\\n\\n00:00:00.000 --> 00:00:02.000\\nمرحبا\\n",
      );
      return Buffer.alloc(0);
    },
  });
  try {
    const captionsUrl = service.issue(
      "/media/valid/media.mkv",
      "owner",
    );
    const ticket = captionsUrl.split("/").at(-1);
    const loopback = "http://127.0.0.1:3000";
    const list = await service.list(ticket, "owner", loopback);
    const arabic = list.tracks.find((track) => track.language === "ara");
    assert.equal(
      (await service.vtt(ticket, arabic.id, "owner", loopback)).toString(),
      "WEBVTT\\n\\n00:00:00.000 --> 00:00:02.000\\nمرحبا\\n",
    );
    await service.vtt(ticket, arabic.id, "owner", loopback);
    assert.equal(
      calls.filter((call) => call.binary === "convert").length,
      1,
    );
    await assert.rejects(
      service.vtt(ticket, "../4", "owner", loopback),
      /not found/i,
    );
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
~~~

Define a \`createFixtureService(runProcess)\` helper by moving the exact media descriptor, session function, binary names, temporary-directory creation, caption issuing, and loopback value from the case above into one function that returns \`{service, directory, ticket, loopback}\`. Then add these concrete failure assertions:

~~~js
test("conversion timeout is sanitized", async () => {
  const fixture = await createFixtureService(async (binary) => {
    if (binary === "probe") return probeJson;
    throw new Error("Caption process timed out");
  });
  try {
    const list = await fixture.service.list(
      fixture.ticket, "owner", fixture.loopback,
    );
    await assert.rejects(
      fixture.service.vtt(
        fixture.ticket,
        list.tracks[0].id,
        "owner",
        fixture.loopback,
      ),
      (error) =>
        error.status === 502 &&
        error.message === "Captions could not be prepared.",
    );
  } finally {
    await fixture.service.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("oversized VTT is deleted", async () => {
  let outputPath;
  const fixture = await createFixtureService(async (binary, args) => {
    if (binary === "probe") return probeJson;
    outputPath = args.at(-1);
    await writeFile(outputPath, Buffer.alloc(10 * 1024 * 1024 + 1));
    return Buffer.alloc(0);
  });
  try {
    const list = await fixture.service.list(
      fixture.ticket, "owner", fixture.loopback,
    );
    await assert.rejects(
      fixture.service.vtt(
        fixture.ticket,
        list.tracks[0].id,
        "owner",
        fixture.loopback,
      ),
      /could not be prepared/i,
    );
    await assert.rejects(access(outputPath));
  } finally {
    await fixture.service.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
~~~

Add a revoke case whose injected runner remains pending until its supplied \`signal\` aborts. Call \`service.revoke("owner")\`, assert that the runner rejects with cancellation, and assert the ticket then returns 404. Add a concurrency case whose runner increments \`active\`, records \`peak = Math.max(peak, active)\`, waits on externally controlled resolvers, and asserts \`peak === 2\` while three uncached conversions are queued. Finally, write a stale file beneath a \`nova-tv-captions-test-*\` root, construct and close a service, and assert that exact root is gone while a sibling temporary directory still exists.

Add this sanitized logging assertion:

~~~js
test("repeated caption failures are logged once without sensitive data", async () => {
  const warnings = [];
  let now = 1000;
  const fixture = await createFixtureService(async () => {
    throw new Error(
      "https://paid-user:paid-pass@provider.example/private.mkv",
    );
  }, {
    logger: { warn: (entry) => warnings.push(entry) },
    now: () => now,
  });
  try {
    await assert.rejects(
      fixture.service.list(
        fixture.ticket, "owner", fixture.loopback,
      ),
    );
    await assert.rejects(
      fixture.service.list(
        fixture.ticket, "owner", fixture.loopback,
      ),
    );
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], {
      event: "caption_probe_failed",
      code: "process_failed",
    });
    assert.doesNotMatch(
      JSON.stringify(warnings),
      /paid-user|paid-pass|provider|private|https/i,
    );
    now += 60_001;
    await assert.rejects(
      fixture.service.list(
        fixture.ticket, "owner", fixture.loopback,
      ),
    );
    assert.equal(warnings.length, 2);
  } finally {
    await fixture.service.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
~~~

Extend \`createFixtureService\` to merge the optional dependency object into the \`CaptionService\` constructor.

- [ ] **Step 5: Implement on-demand VTT extraction and bounded cache cleanup**

Use only the mapped integer stream index in FFmpeg arguments:

~~~js
const args = [
  "-v", "error",
  "-nostdin",
  "-i", sourceUrl,
  "-map", "0:" + stream.index,
  "-c:s", "webvtt",
  "-f", "webvtt",
  "-y", outputPath,
];
~~~

\`outputPath\` must be \`join(tempRoot, cacheKey + "-" + stream.index + ".vtt")\`, where \`cacheKey\` is exactly 64 lowercase hex characters obtained from \`MediaProxy.describe\` and \`stream.index\` is an integer returned by FFprobe. Reject any descriptor not matching that shape.

Implement a two-slot FIFO semaphore. One in-flight promise per cache key/stream prevents duplicate conversion. After conversion, use \`stat\` to enforce \`MAX_VTT_BYTES\` before \`readFile\`. Cache metadata tracks size and last access. Remove oldest entries until total cached file size is at most 128 MiB. \`close()\` aborts service-owned controllers, waits for settled tasks, and removes \`tempRoot\` only after verifying its resolved basename begins with \`nova-tv-captions\`.

Implement \`#warn(event, code)\` with a \`Map\` keyed by \`event + ":" + code\`. It calls \`logger.warn({event, code})\` at most once per key per 60 seconds. Allowed codes are fixed internal values such as \`binary_unavailable\`, \`process_failed\`, \`timeout\`, \`output_limit\`, and \`invalid_probe\`; never pass error messages, paths, process arguments, tickets, or URLs to the logger.

- [ ] **Step 6: Run caption service and media tests**

Run:

~~~powershell
node --test tests/caption-process.test.js tests/captions-server.test.js tests/security.test.js
~~~

Expected: all tests PASS, output contains no credential-bearing fixture URL, and concurrency peaks at two.

- [ ] **Step 7: Record the task checkpoint**

If Git is available:

~~~powershell
git add server/captions.js tests/captions-server.test.js
git commit -m "feat: probe and cache provider captions"
~~~

Otherwise skip the Git commands.

---

### Task 4: Add authenticated caption API routes

**Files:**

- Modify: \`server/app.js:1-320\`
- Modify: \`tests/api.test.js:1-410\`

**Interfaces:**

- Consumes: \`CaptionService\` from Task 3.
- Changes: VOD \`POST /api/play\` response to \`{url,mime,live:false,captionsUrl}\`; live response remains \`{url,mime,live:true}\`.
- Adds: \`GET /api/captions/:ticket -> {tracks}\`.
- Adds: \`GET /api/captions/:ticket/:trackId.vtt -> text/vtt; charset=utf-8\`.
- Test injection: \`createApp({captionService})\` uses the supplied service; production constructs a real service.

- [ ] **Step 1: Write failing API contract tests with an injected service**

Define a fake caption service in \`tests/api.test.js\` before \`createApp\`:

~~~js
const captionCalls = [];
let captionOwner = "";
const captionService = {
  issue: (mediaPath, sessionId) => {
    captionCalls.push({ type: "issue", mediaPath, sessionId });
    captionOwner = sessionId;
    return "/api/captions/caption-ticket-1234";
  },
  list: async (ticket, sessionId, loopbackBase) => {
    captionCalls.push({ type: "list", ticket, sessionId, loopbackBase });
    if (sessionId !== captionOwner)
      throw Object.assign(new Error("Captions not found."), { status: 404 });
    return {
      tracks: [{
        id: "arabic-track-1234",
        index: 2,
        language: "ara",
        label: "Arabic",
        title: "Arabic",
        default: true,
        forced: false,
        source: "embedded",
      }],
    };
  },
  vtt: async (_ticket, _trackId, sessionId) => {
    if (sessionId !== captionOwner)
      throw Object.assign(new Error("Captions not found."), { status: 404 });
    return Buffer.from(
      "WEBVTT\\n\\n00:00:00.000 --> 00:00:02.000\\nمرحبا\\n",
    );
  },
  revoke: (sessionId) => captionCalls.push({ type: "revoke", sessionId }),
};
~~~

Pass it to \`createApp\`. Add assertions:

~~~js
test("movie playback returns protected provider-caption endpoints", async () => {
  const play = await request("/api/play", {
    method: "POST",
    body: { kind: "movie", id: "20", extension: "mp4" },
  });
  assert.equal(play.status, 200);
  assert.equal(play.data.captionsUrl, "/api/captions/caption-ticket-1234");
  assert.ok(!play.data.captionsUrl.includes("paid-pass"));

  assert.equal(
    (await request(play.data.captionsUrl, { auth: "" })).status,
    401,
  );
  const tracks = await request(play.data.captionsUrl);
  assert.equal(tracks.data.tracks[0].language, "ara");

  const vtt = await fetch(
    base + play.data.captionsUrl + "/arabic-track-1234.vtt",
    { headers: { Authorization: "Bearer " + token } },
  );
  assert.equal(vtt.status, 200);
  assert.match(vtt.headers.get("content-type"), /^text\/vtt/);
  assert.equal(vtt.headers.get("content-disposition"), "inline");
  assert.match(await vtt.text(), /مرحبا/);
});

test("live playback does not start caption probing", async () => {
  const before = captionCalls.filter((call) => call.type === "issue").length;
  const play = await request("/api/play", {
    method: "POST",
    body: { kind: "live", id: "10" },
  });
  assert.equal(play.data.captionsUrl, undefined);
  assert.equal(
    captionCalls.filter((call) => call.type === "issue").length,
    before,
  );
});
~~~

- [ ] **Step 2: Verify API tests fail**

Run:

~~~powershell
node --test --test-name-pattern="provider-caption|caption probing" tests/api.test.js
~~~

Expected: FAIL because \`captionsUrl\` and the caption routes are absent.

- [ ] **Step 3: Construct or inject CaptionService and decorate VOD play results**

In \`createApp\`, construct after \`MediaProxy\`:

~~~js
const captions =
  config.captionService ||
  new CaptionService({
    media,
    getSession: (id) => vault.getById(id),
    tempRoot: config.captionTempRoot,
    binaries: config.captionBinaries,
    runProcess: config.captionRunProcess,
  });
~~~

Change \`POST /api/play\` to compute one playback object and issue captions only when \`playback.live === false\`:

~~~js
const playback = req.session.profile.demo
  ? demoPlay(media, req.session, input)
  : provider.play(req.session, input);
if (!playback.live)
  playback.captionsUrl = captions.issue(playback.url, req.session.id);
res.json(playback);
~~~

Do not modify provider credential construction in \`server/provider.js\` and do not return the upstream URL.

- [ ] **Step 4: Add the two routes before the API 404 middleware**

Construct the loopback base only from the actual local socket port:

~~~js
const captionLoopback = (req) => {
  const port = Number(req.socket.localPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new AppError(503, "Captions are unavailable.");
  return "http://127.0.0.1:" + port;
};

app.get("/api/captions/:ticket", async (req, res) => {
  res.json(
    await captions.list(
      req.params.ticket,
      req.session.id,
      captionLoopback(req),
      { signal: AbortSignal.timeout(15_000) },
    ),
  );
});

app.get("/api/captions/:ticket/:trackId.vtt", async (req, res) => {
  const body = await captions.vtt(
    req.params.ticket,
    req.params.trackId,
    req.session.id,
    captionLoopback(req),
    { signal: AbortSignal.timeout(35_000) },
  );
  res
    .type("text/vtt")
    .set("Content-Disposition", "inline")
    .set("Cache-Control", "private, max-age=3600")
    .send(body);
});
~~~

Validate both params with Zod using \`/^[A-Za-z0-9_-]{16,128}$/\` before calling the service. Use fixed client messages from \`AppError\); never attach a process error or URL.

Add \`captions.revoke(req.session.id)\` before vault deletion during logout. Expose \`app.locals.captionService = captions\` so \`server/index.js\` can call \`close()\` during graceful shutdown.

- [ ] **Step 5: Add foreign-session, invalid-ID, logout, and sanitization assertions**

Extend the API case with these exact checks:

~~~js
const other = await request("/api/demo", { method: "POST", auth: "" });
assert.equal(
  (
    await request(play.data.captionsUrl, {
      auth: other.data.token,
    })
  ).status,
  404,
);

const vttCallsBefore = captionCalls.filter(
  (call) => call.type === "vtt",
).length;
for (const path of [
  play.data.captionsUrl + "/..%2F4.vtt",
  play.data.captionsUrl + "/" + "x".repeat(129) + ".vtt",
]) {
  const response = await fetch(base + path, {
    headers: { Authorization: "Bearer " + token },
  });
  assert.ok([400, 404].includes(response.status));
}
assert.equal(
  captionCalls.filter((call) => call.type === "vtt").length,
  vttCallsBefore,
);
assert.doesNotMatch(
  JSON.stringify(await request(play.data.captionsUrl)),
  /paid-pass|ffmpeg|ffprobe|provider\/movie/i,
);
~~~

Update the fake \`vtt\` method to record \`{type: "vtt"}\`. After deleting the owner session, assert \`captionCalls.some(call => call.type === "revoke" && call.sessionId === captionOwner)\`. Keep the existing header assertions that Content-Disposition equals \`inline\` and add \`assert.doesNotMatch(vtt.headers.get("content-disposition"), /attachment/i)\`.

- [ ] **Step 6: Close the service during server shutdown**

Keep the Express application reference in \`server/index.js:1-18\` and use it during shutdown:

~~~js
const app = createApp();
const server = app.listen(port, host, () => {
  console.log("Nova TV is ready at http://localhost:" + port);
  console.log(
    "For a television, use this computer's LAN IP address and the same port.",
  );
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const forced = setTimeout(() => process.exit(1), 5000);
  forced.unref();
  await new Promise((resolve) => server.close(resolve));
  await app.locals.captionService?.close?.();
  clearTimeout(forced);
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, shutdown);
~~~

Retain the existing \`requestTimeout\` and \`headersTimeout\` assignments between \`listen\` and the signal handlers.

- [ ] **Step 7: Run API and security tests**

Run:

~~~powershell
node --test tests/api.test.js tests/security.test.js tests/captions-server.test.js
~~~

Expected: all tests PASS; existing media range, HLS rewriting, and logout tests still pass.

- [ ] **Step 8: Record the task checkpoint**

If Git is available:

~~~powershell
git add server/app.js server/index.js tests/api.test.js
git commit -m "feat: expose authenticated caption routes"
~~~

Otherwise skip the Git commands.

---

### Task 5: Add caption normalization and WebVTT parsing

**Files:**

- Create: \`src/lib/captions.js\`
- Create: \`tests/captions.test.js\`
- Modify: \`src/lib/api.js:1-58\`

**Interfaces:**

- Produces: \`normalizeCaptionTrack(raw, source, order) -> CaptionTrack\`.
- Produces: \`mergeCaptionTracks(sourceGroups) -> CaptionTrack[]\`, with source alternatives retained.
- Produces: \`preferredArabicTrack(tracks) -> CaptionTrack | null\`.
- Produces: \`parseWebVtt(text) -> Array<{start,end,text}>\`.
- Produces: \`cueAt(cues, seconds) -> string\`.
- Produces: \`apiText(path, signal?) -> Promise<string>\`, using the same bearer token and base URL as \`api\`.

- [ ] **Step 1: Write failing language, merge, parser, and cue tests**

Create \`tests/captions.test.js\`:

~~~js
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCaptionTrack,
  mergeCaptionTracks,
  preferredArabicTrack,
  parseWebVtt,
  cueAt,
} from "../src/lib/captions.js";

test("Arabic aliases normalize, sort first, and prefer provider default", () => {
  const tracks = mergeCaptionTracks([
    {
      source: "server",
      priority: 20,
      tracks: [
        { id: "en", language: "eng", title: "English" },
        { id: "ar-forced", language: "ar-LB", title: "Arabic Forced", forced: true },
        { id: "ar-full", language: "ara", title: "Arabic Full", default: true },
      ],
    },
  ]);
  assert.deepEqual(tracks.map((track) => track.language), ["ar", "ar", "eng"]);
  assert.equal(tracks[0].label, "العربية");
  assert.equal(preferredArabicTrack(tracks).sourceId, "ar-full");
});

test("equivalent native and server tracks merge but keep activation fallbacks", () => {
  const tracks = mergeCaptionTracks([
    {
      source: "avplay",
      priority: 10,
      tracks: [{ id: "4", language: "ara", title: "Arabic" }],
    },
    {
      source: "server",
      priority: 20,
      tracks: [{ id: "opaque", language: "ar", title: "Arabic" }],
    },
  ]);
  assert.equal(tracks.length, 1);
  assert.deepEqual(tracks[0].alternatives.map((x) => x.source), [
    "avplay", "server",
  ]);
});

test("WebVTT parsing keeps safe text and uses start-inclusive end-exclusive cues", () => {
  const cues = parseWebVtt(
    "\\uFEFFWEBVTT\\r\\n\\r\\n1\\r\\n00:00:01.000 --> 00:00:03.000 align:center\\r\\n<b>مرحبا</b>\\r\\nبكم\\r\\n\\r\\n",
  );
  assert.deepEqual(cues, [{
    start: 1,
    end: 3,
    text: "مرحبا\\nبكم",
  }]);
  assert.equal(cueAt(cues, 0.999), "");
  assert.equal(cueAt(cues, 1), "مرحبا\\nبكم");
  assert.equal(cueAt(cues, 3), "");
});
~~~

- [ ] **Step 2: Verify the utility tests fail**

Run:

~~~powershell
node --test tests/captions.test.js
~~~

Expected: FAIL with module-not-found for \`src/lib/captions.js\`.

- [ ] **Step 3: Implement exact language and merge rules**

\`normalizeCaptionTrack\` returns:

~~~js
{
  id: source + ":" + String(raw.id),
  source,
  sourceId: String(raw.id),
  language: canonicalLanguage,
  label,
  title,
  default: Boolean(raw.default),
  forced: Boolean(raw.forced),
  order,
  alternatives: [],
}
~~~

Canonical Arabic is \`ar\` when the lowercased trimmed language is \`ar\`, \`ara\`, begins with \`ar-\`, or when language/title/label equals \`arabic\` or \`العربية\`. Arabic labels are always \`العربية\`; other labels use title, then label, then language, then \`Subtitle N\`.

Merge only when canonical language, normalized non-generic title, and forced status match. If title is empty or generic like \`Subtitle 1\`, retain separate tracks to avoid merging unrelated unknown-language tracks. Sort Arabic first, then provider-default, non-forced before forced, label with \`localeCompare\`, then source order. Each merged item keeps alternatives ordered by numeric source priority.

- [ ] **Step 4: Implement a bounded WebVTT parser**

The parser must:

- reject non-string input and input over 10 MiB by returning \`[]\`;
- remove BOM and normalize CRLF;
- skip \`WEBVTT\`, \`NOTE\`, \`STYLE\`, and \`REGION\` blocks;
- accept \`MM:SS.mmm\` and \`HH:MM:SS.mmm\` timing;
- ignore cue settings after the end time;
- strip WebVTT tags and inline timestamps;
- decode only \`&amp;\`, \`&lt;\`, \`&gt;\`, \`&quot;\`, \`&#39;\`, and \`&nbsp;\`;
- preserve line breaks and return cues sorted by start time;
- never use \`innerHTML\`, \`DOMParser\`, or \`eval\`.

\`cueAt\` joins overlapping cue text with a newline and treats cue end as exclusive.

- [ ] **Step 5: Add authenticated text fetching without duplicating API error rules**

Refactor the shared fetch setup in \`src/lib/api.js\` into an internal \`request(path, options)\`. Keep \`api\` behavior unchanged and add:

~~~js
export async function apiText(path, signal) {
  return request(path, {
    method: "GET",
    signal,
    parse: async (response) => response.text(),
  });
}
~~~

The shared request keeps the 30-second timeout, bearer header, backend base, cancellation distinction, and user-friendly network errors. It must inspect non-OK JSON or text without trying to render server HTML.

- [ ] **Step 6: Run utility and existing API tests**

Run:

~~~powershell
node --test tests/captions.test.js tests/api.test.js
~~~

Expected: all tests PASS and existing frontend API call signatures remain unchanged.

- [ ] **Step 7: Record the task checkpoint**

If Git is available:

~~~powershell
git add src/lib/captions.js src/lib/api.js tests/captions.test.js
git commit -m "feat: normalize and parse caption tracks"
~~~

Otherwise skip the Git commands.

---

### Task 6: Add the caption controller and platform sources

**Files:**

- Create: \`src/lib/caption-controller.js\`
- Create: \`src/lib/caption-sources.js\`
- Create: \`tests/caption-controller.test.js\`

**Interfaces:**

- Produces: \`new CaptionController({onChange})\`.
- Controller methods: \`beginMedia()\`, \`replaceSource(generation, name, priority, tracks, activate)\`, \`setSourceError(generation, name)\`, \`select(trackId, automatic?)\`, \`updateTime(seconds)\`, \`pushCue(source, text, durationMs)\`, \`finishDiscovery(generation)\`, \`snapshot()\`, \`whenSettled()\`, and \`destroy()\`.
- Source activation contract: \`activate(sourceTrack, emitCue) -> Promise<{cues?: Cue[], dispose?: Function}> | {cues?: Cue[], dispose?: Function}\`.
- Produces source helpers: \`loadServerCaptionSource(captionsUrl, signal, requests?)\`, \`samsungCaptionTracks(rawTracks)\`, \`activateSamsungTrack(av, track, emitCue)\`, \`htmlCaptionTracks(textTracks)\`, \`activateHtmlTrack(textTracks, track, emitCue)\`, \`hlsCaptionTracks(rawTracks)\`, and \`activateHlsTrack(hls, video, track, emitCue)\`. Optional \`requests\` is \`{requestJson, requestText}\` for deterministic tests; production defaults to \`api\` and \`apiText\`.

- [ ] **Step 1: Write failing controller behavior tests**

Create \`tests/caption-controller.test.js\`:

~~~js
import test from "node:test";
import assert from "node:assert/strict";
import { CaptionController } from "../src/lib/caption-controller.js";

test("controller auto-selects Arabic, emits timed cues, and supports Off", async () => {
  const states = [];
  const controller = new CaptionController({
    onChange: (state) => states.push(structuredClone(state)),
  });
  const generation = controller.beginMedia();
  let disposed = 0;
  controller.replaceSource(
    generation,
    "server",
    20,
    [
      { id: "en", language: "eng", title: "English" },
      { id: "ar", language: "ara", title: "Arabic", default: true },
    ],
    async (track) => ({
      cues: [{ start: 1, end: 3, text: track.id === "ar" ? "مرحبا" : "Hello" }],
      dispose: () => disposed++,
    }),
  );
  await controller.whenSettled();
  assert.equal(controller.snapshot().selectedId, "server:ar");
  controller.updateTime(1.5);
  assert.equal(controller.snapshot().cue, "مرحبا");
  await controller.select(null);
  assert.equal(controller.snapshot().cue, "");
  assert.equal(disposed, 1);
  controller.destroy();
});

test("late discovery from old media cannot replace current captions", () => {
  const controller = new CaptionController({ onChange() {} });
  const oldGeneration = controller.beginMedia();
  const currentGeneration = controller.beginMedia();
  controller.replaceSource(
    oldGeneration,
    "server",
    20,
    [{ id: "old", language: "ara" }],
    async () => ({}),
  );
  assert.equal(controller.snapshot().tracks.length, 0);
  assert.equal(controller.generation, currentGeneration);
});

test("controller falls back to the next equivalent source", async () => {
  const controller = new CaptionController({ onChange() {} });
  const generation = controller.beginMedia();
  controller.replaceSource(
    generation,
    "avplay",
    10,
    [{ id: "4", language: "ara", title: "Arabic" }],
    async () => { throw new Error("native failure"); },
  );
  controller.replaceSource(
    generation,
    "server",
    20,
    [{ id: "opaque", language: "ar", title: "Arabic" }],
    async () => ({ cues: [{ start: 0, end: 10, text: "بديل" }] }),
  );
  await controller.whenSettled();
  controller.updateTime(1);
  assert.equal(controller.snapshot().cue, "بديل");
});
~~~

- [ ] **Step 2: Verify controller tests fail**

Run:

~~~powershell
node --test tests/caption-controller.test.js
~~~

Expected: FAIL with module-not-found for \`src/lib/caption-controller.js\`.

- [ ] **Step 3: Implement generation-safe controller state**

Initial public state is:

~~~js
{
  checking: false,
  tracks: [],
  selectedId: null,
  cue: "",
  error: "",
}
~~~

\`beginMedia\` increments \`generation\`, disposes the active source, clears pending cue timers and source maps, resets \`userSelected\` to false, sets \`checking: true\`, emits state, and returns the generation.

\`replaceSource\` ignores a stale generation. It normalizes and merges every current source group using Task 5 utilities. If the viewer has not made an explicit selection, call \`preferredArabicTrack\`; select it automatically. If a previously selected merged track still exists, preserve it. Source errors set only the nonfatal caption \`error\` field and never throw into video playback.

\`select(null)\` marks \`userSelected\`, disposes the active source, clears cue data, and reports captions off. A track selection tries its \`alternatives\` in priority order. Failed activation is sanitized; the next alternative is tried. Only after all alternatives fail does state report \`Captions could not be loaded.\`.

\`updateTime\` uses \`cueAt\` for timed server cues. \`pushCue\` accepts Samsung/HTML cue text only from the active source, strips tags through the Task 5 sanitizer, and clears the cue after bounded \`durationMs\`. \`destroy\` makes every later callback a no-op.

\`whenSettled()\` returns the current automatic/manual selection promise, or an already-resolved promise if no selection is pending. \`snapshot()\` returns a shallow-cloned public state whose \`tracks\` array is also cloned so tests and React cannot mutate controller internals.

- [ ] **Step 4: Write and implement platform-source mapping tests**

Add tests that feed:

~~~js
const samsung = samsungCaptionTracks([
  {
    type: "TEXT",
    index: 4,
    extra_info: JSON.stringify({ track_lang: "ara", title: "Arabic Full" }),
  },
  {
    type: "AUDIO",
    index: 5,
    extra_info: JSON.stringify({ track_lang: "eng" }),
  },
  { type: "TEXT", index: 6, extra_info: "{broken" },
]);
assert.deepEqual(samsung.map((track) => track.id), ["4", "6"]);
assert.equal(samsung[0].language, "ara");
assert.equal(samsung[1].label, "Subtitle 2");
~~~

\`activateSamsungTrack\` must always call:

~~~js
av.setSelectTrack("TEXT", Number(track.id));
av.setSilentSubtitle(true);
~~~

It must never set silent subtitles to false because Nova needs \`onsubtitlechange\` for the shared overlay.

\`loadServerCaptionSource\` calls its \`requestJson\` dependency as \`requestJson(captionsUrl, "GET", undefined, signal)\`, maps each result track, and activates by fetching with its \`requestText\` dependency:

~~~js
apiText(captionsUrl + "/" + encodeURIComponent(track.id) + ".vtt", signal)
~~~

then returns \`{cues: parseWebVtt(text)}\`.

\`activateHtmlTrack\` disables all non-selected tracks, sets the selected track to \`hidden\`, listens for \`cuechange\`, and emits \`Array.from(track.activeCues || []).map(cue => cue.text).join("\\n")\`. Its disposer removes the listener and disables that track. For hls.js, the caller sets \`hls.subtitleTrack\` first, then registers the matching HTML TextTrack once it appears.

\`hlsCaptionTracks\` maps hls.js \`name\`, \`lang\`/\`language\`, \`default\`, and \`forced\` fields while preserving the numeric hls.js track index as a string ID. \`activateHlsTrack\` sets \`hls.subtitleTrack\`, listens for \`SUBTITLE_TRACK_SWITCH\`, then delegates cue handling to \`activateHtmlTrack\` for the matching HTML TextTrack. Its disposer removes the hls.js listener, disposes the HTML listener, and sets \`hls.subtitleTrack = -1\`.

- [ ] **Step 5: Add cancellation and empty-result tests**

Add these controller cases:

~~~js
test("Off prevents late Arabic discovery from re-enabling captions", async () => {
  const controller = new CaptionController({ onChange() {} });
  const generation = controller.beginMedia();
  controller.replaceSource(
    generation,
    "server",
    20,
    [{ id: "en", language: "eng" }],
    async () => ({}),
  );
  await controller.select(null);
  controller.replaceSource(
    generation,
    "avplay",
    10,
    [{ id: "ar", language: "ara" }],
    async () => ({}),
  );
  await controller.whenSettled();
  assert.equal(controller.snapshot().selectedId, null);
  controller.destroy();
});

test("empty discovery is ready and nonfatal", () => {
  const controller = new CaptionController({ onChange() {} });
  const generation = controller.beginMedia();
  controller.finishDiscovery(generation);
  assert.deepEqual(controller.snapshot(), {
    checking: false,
    tracks: [],
    selectedId: null,
    cue: "",
    error: "",
  });
  controller.destroy();
});

test("destroy disposes an active source exactly once", async () => {
  let disposed = 0;
  const controller = new CaptionController({ onChange() {} });
  const generation = controller.beginMedia();
  controller.replaceSource(
    generation,
    "server",
    20,
    [{ id: "ar", language: "ara" }],
    async () => ({
      dispose: () => disposed++,
    }),
  );
  await controller.whenSettled();
  controller.pushCue("server", "مرحبا", 5000);
  controller.destroy();
  controller.destroy();
  assert.equal(disposed, 1);
  assert.equal(controller.snapshot().cue, "");
});
~~~

Add this source-helper case; production defaults use \`api\` and \`apiText\`:

~~~js
test("cancelled server discovery is an empty nonfatal source", async () => {
  const controller = new AbortController();
  controller.abort();
  const source = await loadServerCaptionSource(
    "/api/captions/ticket",
    controller.signal,
    {
      requestJson: async () => {
        throw new Error("Request cancelled.");
      },
      requestText: async () => "",
    },
  );
  assert.deepEqual(source.tracks, []);
  assert.equal(typeof source.activate, "function");
});
~~~

The malformed \`extra_info\` row in Step 4 must remain present and prove safe parsing.

- [ ] **Step 6: Run controller and utility tests**

Run:

~~~powershell
node --test tests/captions.test.js tests/caption-controller.test.js
~~~

Expected: all tests PASS.

- [ ] **Step 7: Record the task checkpoint**

If Git is available:

~~~powershell
git add src/lib/caption-controller.js src/lib/caption-sources.js tests/caption-controller.test.js
git commit -m "feat: coordinate caption sources and Arabic selection"
~~~

Otherwise skip the Git commands.

---

### Task 7: Integrate captions into Player and TV controls

**Files:**

- Create: \`src/components/CaptionOverlay.jsx\`
- Create: \`src/components/CaptionMenu.jsx\`
- Modify: \`src/components/Player.jsx:35-870\`
- Modify: \`src/components/Player.css:1-238\`
- Modify: \`tests/player-controls.spec.js:1-75\`
- Modify: \`tests/ui.spec.js:130-260\`

**Interfaces:**

- Consumes: \`CaptionController\` and source helpers from Task 6.
- \`CaptionOverlay({text, language, controlsVisible})\` renders text only.
- \`CaptionMenu({open, tracks, selectedId, checking, onSelect, onClose, anchorRef})\` renders Off plus tracks and restores focus on close.
- Player feeds playback position and platform cue events to the controller.

- [ ] **Step 1: Write failing browser caption UI test**

Add a helper to \`tests/player-controls.spec.js\` that modifies demo movie playback while preserving its playable URL:

~~~js
async function mockArabicCaptions(page) {
  await page.route("**/api/play", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: { ...data, captionsUrl: "/api/captions/test-ticket" },
    });
  });
  await page.route("**/api/captions/test-ticket", (route) =>
    route.fulfill({
      json: {
        tracks: [
          {
            id: "english",
            language: "eng",
            label: "English",
            title: "English",
            default: false,
            forced: false,
            source: "embedded",
          },
          {
            id: "arabic",
            language: "ara",
            label: "Arabic",
            title: "Arabic",
            default: true,
            forced: false,
            source: "embedded",
          },
        ],
      },
    }),
  );
  await page.route("**/api/captions/test-ticket/arabic.vtt", (route) =>
    route.fulfill({
      contentType: "text/vtt",
      body: "WEBVTT\\n\\n00:00:00.000 --> 00:10:00.000\\nمرحبا بكم\\n",
    }),
  );
}

test("provider Arabic captions auto-select and can be turned off", async ({ page }) => {
  await mockArabicCaptions(page);
  await openDemoMovie(page);
  await expect(page.getByTestId("caption-overlay")).toContainText("مرحبا بكم");
  await page.getByRole("button", { name: /Captions: العربية/ }).click();
  await expect(page.getByRole("menuitemradio", { name: "العربية" })).toBeChecked();
  await page.getByRole("menuitemradio", { name: "Off" }).click();
  await expect(page.getByTestId("caption-overlay")).toHaveCount(0);
});
~~~

- [ ] **Step 2: Verify the browser UI test fails**

Run:

~~~powershell
npx playwright test tests/player-controls.spec.js --grep "Arabic captions"
~~~

Expected: FAIL because no caption menu or Nova caption overlay exists.

- [ ] **Step 3: Add the safe overlay and remote-friendly menu components**

\`CaptionOverlay.jsx\`:

~~~jsx
import React from "react";

export default function CaptionOverlay({ text, language }) {
  if (!text) return null;
  return (
    <div
      className={"caption-overlay " + (language === "ar" ? "arabic" : "")}
      data-testid="caption-overlay"
      dir={language === "ar" ? "rtl" : "auto"}
    >
      {String(text).split("\\n").map((line, index) => (
        <React.Fragment key={index}>
          {index > 0 && <br />}
          {line}
        </React.Fragment>
      ))}
    </div>
  );
}
~~~

\`CaptionMenu\` uses \`role="menu"\`; every choice uses \`role="menuitemradio"\` and \`aria-checked\`. It renders Off first and all normalized tracks after it. On selection it awaits \`onSelect\`, closes, and focuses \`anchorRef.current\`. On Back/Escape key codes 10009, 461, or 27 it prevents default, stops propagation, closes, and restores focus instead of closing the whole player.

- [ ] **Step 4: Wire one controller into each Player playback generation**

Replace \`captionIndexRef\`, \`captionTracks\`, \`captionIndex\`, and the adapter's cycling \`captions()\` method. Add:

~~~js
const captions = useRef(null);
const captionButton = useRef(null);
const [captionState, setCaptionState] = useState({
  checking: false,
  tracks: [],
  selectedId: null,
  cue: "",
  error: "",
});
const [captionMenuOpen, setCaptionMenuOpen] = useState(false);
~~~

At the start of the playback effect:

~~~js
const captionController = new CaptionController({
  onChange: (state) => {
    if (!disposed) setCaptionState(state);
  },
});
captions.current = captionController;
const captionGeneration = captionController.beginMedia();
~~~

After \`POST /api/play\` resolves, start \`loadServerCaptionSource(data.captionsUrl, signal)\` in parallel when \`captionsUrl\` exists. Do not await it before \`av.open\`, \`v.load\`, or \`v.play\`. Register its tracks and activation function only if \`captionGeneration\` is current.

Update the existing \`update(p, d)\` helper to call \`captionController.updateTime(p)\`. Destroy the controller and abort its server request in the playback effect cleanup.

- [ ] **Step 5: Replace Samsung caption cycling with Arabic native cues**

Add \`onsubtitlechange\` to the existing AVPlay listener:

~~~js
onsubtitlechange: (durationMs, text) =>
  captionController.pushCue("avplay", text, Number(durationMs) || 0),
~~~

After \`prepareAsync\`, pass all \`getTotalTrackInfo()\` rows through \`samsungCaptionTracks\` and register source priority 10. Activation calls \`activateSamsungTrack\`. Keep \`setSilentSubtitle(true)\` at preparation and selection. Remove the existing branch that calls \`setSilentSubtitle(false)\`.

Auto-selection is performed by the controller after tracks are registered. A Samsung track with \`track_lang: "ara"\` must call \`setSelectTrack("TEXT", index)\` without a CC-button click.

- [ ] **Step 6: Connect browser, LG, native, and hls.js text tracks**

\`syncNativeTracks\` registers HTML TextTracks at source priority 10 instead of directly setting React state:

~~~js
const syncNativeTracks = () => {
  const rows = Array.from(v.textTracks || []);
  captionController.replaceSource(
    captionGeneration,
    "html",
    10,
    htmlCaptionTracks(rows),
    (track, emitCue) =>
      activateHtmlTrack(Array.from(v.textTracks || []), track, emitCue),
  );
};
v.textTracks?.addEventListener?.("addtrack", syncNativeTracks);
~~~

Replace the current hls.js caption state handlers with:

~~~js
hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
  const rows = data.subtitleTracks || hls.subtitleTracks || [];
  captionController.replaceSource(
    captionGeneration,
    "hls",
    10,
    hlsCaptionTracks(rows),
    (track, emitCue) =>
      activateHlsTrack(hls, v, track, emitCue),
  );
});
~~~

\`activateHlsTrack\` handles \`SUBTITLE_TRACK_SWITCH\`, sets the selected HTML TextTrack to hidden, forwards \`cuechange\`, and resets \`hls.subtitleTrack = -1\` on disposal. Cleanup removes the native \`addtrack\` listener. Never use \`mode = "showing"\`; Nova's shared overlay renders the cue.

- [ ] **Step 7: Render the menu, status, and overlay**

Render \`CaptionOverlay\` between the video/object and \`.player-controls\`. Determine its language from the selected normalized track. Replace the CC button with:

~~~jsx
<button
  ref={captionButton}
  className={"tool-button " + (captionState.selectedId ? "active" : "")}
  aria-label={
    captionState.checking && !captionState.tracks.length
      ? "Checking captions"
      : captionState.selectedId
        ? "Captions: " + selectedCaption.label
        : captionState.tracks.length
          ? "Captions off"
          : "No compatible captions"
  }
  disabled={!captionState.checking && !captionState.tracks.length}
  onClick={() => setCaptionMenuOpen((open) => !open)}
>
  <Captions />
  <span>CC</span>
</button>
~~~

Render \`CaptionMenu\` adjacent to the button. A caption-only error is shown as small menu text, never through the main playback \`error\` state.

- [ ] **Step 8: Add Chrome-68-compatible caption styling**

Add styles without CSS \`gap\`, \`:has\`, \`:focus-visible\`, or \`aspect-ratio\`:

~~~css
.caption-overlay {
  position: absolute;
  left: 12%;
  right: 12%;
  bottom: 190px;
  z-index: 3;
  color: #fff;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.35;
  text-align: center;
  text-shadow: 0 2px 5px #000, 0 0 2px #000;
  pointer-events: none;
}
.caption-overlay.arabic {
  direction: rtl;
  font-family: Arial, "Noto Sans Arabic", sans-serif;
}
.caption-overlay > span,
.caption-overlay {
  white-space: pre-wrap;
}
.caption-menu {
  position: absolute;
  right: 50px;
  bottom: 96px;
  z-index: 5;
  width: 280px;
  max-height: 45vh;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid #ffffff2d;
  border-radius: 10px;
  background: #10161df2;
}
.caption-menu button {
  display: block;
  width: 100%;
  margin-top: 4px;
  text-align: left;
}
.caption-menu button[aria-checked="true"] {
  color: #d5f678;
  background: #1b251f;
}
.player-top,
.player-controls {
  z-index: 4;
}
@media (max-width: 900px) {
  .caption-overlay {
    left: 8%;
    right: 8%;
    bottom: 230px;
    font-size: 28px;
  }
  .caption-menu {
    right: 22px;
    bottom: 92px;
  }
}
@media (max-width: 560px) {
  .caption-overlay {
    left: 5%;
    right: 5%;
    bottom: 245px;
    font-size: 20px;
  }
  .caption-menu {
    left: 12px;
    right: 12px;
    bottom: 82px;
    width: auto;
  }
}
~~~

Verify the AVPlay object remains below z-index 3.

- [ ] **Step 9: Add a Samsung AVPlay subtitle callback test**

Extend the Samsung mock in \`tests/ui.spec.js\`:

~~~js
setListener: (listener) => (window.avListener = listener),
getTotalTrackInfo: () => [
  {
    type: "TEXT",
    index: 4,
    extra_info: JSON.stringify({ track_lang: "ara", title: "Arabic" }),
  },
  {
    type: "TEXT",
    index: 5,
    extra_info: JSON.stringify({ track_lang: "eng", title: "English" }),
  },
],
setSelectTrack: (type, index) => (window.selectedTextTrack = [type, index]),
setSilentSubtitle: (silent) => (window.silentSubtitle = silent),
~~~

After opening the demo movie, assert:

~~~js
await expect.poll(() => page.evaluate(() => window.selectedTextTrack))
  .toEqual(["TEXT", 4]);
expect(await page.evaluate(() => window.silentSubtitle)).toBe(true);
await page.evaluate(() => window.avListener.onsubtitlechange(2000, "أهلاً"));
await expect(page.getByTestId("caption-overlay")).toHaveText("أهلاً");
~~~

Route the test's caption endpoint to an empty \`{tracks: []}\` response so the test isolates AVPlay.

- [ ] **Step 10: Run focused browser and Samsung tests**

Run:

~~~powershell
npx playwright test tests/player-controls.spec.js tests/ui.spec.js --grep "caption|subtitle"
~~~

Expected: Arabic server caption auto-select, Off, menu roles/focus, and Samsung AVPlay cue tests PASS.

- [ ] **Step 11: Record the task checkpoint**

If Git is available:

~~~powershell
git add src/components/CaptionOverlay.jsx src/components/CaptionMenu.jsx src/components/Player.jsx src/components/Player.css tests/player-controls.spec.js tests/ui.spec.js
git commit -m "feat: show Arabic provider captions across players"
~~~

Otherwise skip the Git commands.

---

### Task 8: Document deployment and run the complete validation matrix

**Files:**

- Modify: \`.env.example:1-12\`
- Modify: \`README.md:1-90\`
- Modify: \`docs/TV-INSTALL.md\`
- Modify: \`docs/VERIFICATION.md\`
- Verify generated: \`dist/\`, \`build/lg/\`, \`build/samsung/\`

**Interfaces:**

- Documents: \`NOVA_FFPROBE_PATH\` and \`NOVA_FFMPEG_PATH\` optional backend overrides.
- Documents: provider text captions, Arabic-first behavior, bitmap limitation, temp-cache behavior, and hardware-validation limits.

- [ ] **Step 1: Add environment and deployment documentation**

Append to \`.env.example\`:

~~~dotenv
# Optional absolute backend paths. Leave empty to use pinned packaged binaries.
NOVA_FFPROBE_PATH=
NOVA_FFMPEG_PATH=
~~~

Update README's playback limitation: Nova still does not transcode video; FFmpeg and FFprobe run only on the Node backend to inspect and extract provider text subtitles as WebVTT. State that Arabic auto-enables, other languages remain selectable, bitmap PGS/VobSub need a future OCR stage, and no third-party subtitles or generated translations are included.

Update TV installation instructions to say both TV apps obtain captions from the configured Nova backend URL. The binaries belong on the backend computer/container, not on the television.

- [ ] **Step 2: Run all Node tests**

Run:

~~~powershell
npm test
~~~

Expected: all \`tests/*.test.js\` PASS, including media/HLS stability, security, caption runner/service, utilities, and controller suites.

- [ ] **Step 3: Run all browser and mocked-TV tests**

Run:

~~~powershell
npm run test:e2e
~~~

Expected: all Playwright tests PASS, including existing catalog/player behavior and new browser/Samsung caption behavior.

- [ ] **Step 4: Build browser, LG, and Samsung outputs**

Run:

~~~powershell
npm run build:tv
~~~

Expected:

- esbuild reports a successful Chrome 68 IIFE build;
- \`dist/app.js\`, \`build/lg/app.js\`, and \`build/samsung/app.js\` exist;
- \`build/lg/appinfo.json\` parses as JSON;
- \`build/samsung/config.xml\` exists;
- Samsung \`index.html\` includes \`$WEBAPIS/webapis/webapis.js\`.

- [ ] **Step 5: Perform a local caption smoke test against the built server**

Start Nova with \`npm start\`, connect the existing subscription, open one movie and one series episode known to use MKV, and verify:

1. video starts before the caption check completes;
2. the CC label changes from Checking captions to Arabic or No compatible captions;
3. when Arabic exists, \`العربية\` is selected and a cue displays RTL;
4. Off clears the cue immediately;
5. switching to another item never shows the previous item's cue;
6. browser network responses use \`text/vtt\` and \`Content-Disposition: inline\`;
7. no provider credential appears in DevTools URLs, response JSON, \`data/server-output.log\`, or \`data/server-error.log\`.

Do not require or open IDM for this smoke test.

- [ ] **Step 6: Record validation truthfully**

Update \`docs/VERIFICATION.md\` with exact commands, pass counts, build results, the sample media/container and track languages actually observed, and whether LG/Samsung hardware was physically tested. If no TV hardware was used, explicitly record browser plus mocked AVPlay/package validation only.

- [ ] **Step 7: Record the final checkpoint**

If Git is available:

~~~powershell
git add .env.example README.md docs/TV-INSTALL.md docs/VERIFICATION.md package.json package-lock.json server src tests tv scripts
git commit -m "docs: explain provider caption deployment"
~~~

Otherwise skip the Git commands and provide the user a file-by-file change summary.

---

## Completion gate

Do not claim this feature is complete until all of the following are true:

- every focused red/green cycle above has been observed;
- \`npm test\`, \`npm run test:e2e\`, and \`npm run build:tv\` pass;
- a real provider movie and episode have been checked without credential leakage;
- Arabic auto-selection and Off are verified;
- the final report distinguishes physical TV testing from mocks and package validation;
- no bitmap subtitle or automatic speech-translation support is claimed.
