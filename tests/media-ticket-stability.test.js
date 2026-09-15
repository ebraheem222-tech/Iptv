import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MediaProxy } from "../server/media.js";

function ioFor(issued) {
  const parsed = new URL(issued, "http://local.test");
  let body = "";

  const req = Object.assign(new EventEmitter(), {
    params: { ticket: parsed.pathname.split("/")[2] },
    query: Object.fromEntries(parsed.searchParams),
    headers: {},
  });

  const res = Object.assign(new EventEmitter(), {
    headers: {},
    statusCode: 0,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    write(value) {
      body += Buffer.from(value).toString();
      return true;
    },
    end(value = "") {
      body += value;
      this.writableEnded = true;
    },
  });

  return { req, res, body: () => body };
}

test("rotating HLS query tokens keep the same proxy pathname", async () => {
  const seen = [];
  const media = new MediaProxy({
    getSession: () => ({ id: "session" }),
    fetcher: async (url) => {
      seen.push(url);
      return new Response("segment", {
        headers: { "content-type": "video/mp2t" },
      });
    },
  });

  const first = media.issue(
    "https://cdn.example/live/media.ts?token=old&expires=1",
    "session",
  );
  const second = media.issue(
    "https://cdn.example/live/media.ts?token=new&expires=2",
    "session",
  );

  const firstUrl = new URL(first, "http://local.test");
  const secondUrl = new URL(second, "http://local.test");

  assert.equal(
    firstUrl.pathname,
    secondUrl.pathname,
    "same upstream path must keep a stable proxy path",
  );
  assert.notEqual(
    firstUrl.search,
    secondUrl.search,
    "rotating upstream credentials must select an opaque URL variant",
  );
  assert.doesNotMatch(first + second, /token=|expires=|old|new/);

  const a = ioFor(first);
  await media.handle(a.req, a.res);

  const b = ioFor(second);
  await media.handle(b.req, b.res);

  assert.deepEqual(seen, [
    "https://cdn.example/live/media.ts?token=old&expires=1",
    "https://cdn.example/live/media.ts?token=new&expires=2",
  ]);
});

test("rotating HLS segment paths keep the same pathname for a media sequence", async () => {
  const manifests = [
    "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:50\n#EXTINF:3,\nhttps://cdn.example/old-path/media.ts\n",
    "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:50\n#EXTINF:3,\nhttps://cdn.example/new-path/media.ts\n",
  ];
  const seenSegments = [];
  const media = new MediaProxy({
    getSession: () => ({ id: "session" }),
    fetcher: async (url) => {
      if (url.endsWith("playlist.m3u8")) {
        return new Response(manifests.shift(), {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      seenSegments.push(url);
      return new Response("segment", {
        headers: { "content-type": "video/mp2t" },
      });
    },
  });

  const playlist = media.issue(
    "https://provider.example/live/playlist.m3u8",
    "session",
  );
  const firstManifest = ioFor(playlist);
  await media.handle(firstManifest.req, firstManifest.res);
  const secondManifest = ioFor(playlist);
  await media.handle(secondManifest.req, secondManifest.res);

  const firstSegment = firstManifest
    .body()
    .split("\n")
    .find((line) => line.startsWith("/media/"));
  const secondSegment = secondManifest
    .body()
    .split("\n")
    .find((line) => line.startsWith("/media/"));
  const firstUrl = new URL(firstSegment, "http://local.test");
  const secondUrl = new URL(secondSegment, "http://local.test");

  assert.equal(
    firstUrl.pathname,
    secondUrl.pathname,
    "the same media sequence must keep one proxy pathname",
  );
  assert.notEqual(
    firstUrl.search,
    secondUrl.search,
    "each manifest must retain its exact upstream segment URL",
  );

  const first = ioFor(firstSegment);
  await media.handle(first.req, first.res);
  const second = ioFor(secondSegment);
  await media.handle(second.req, second.res);

  assert.deepEqual(seenSegments, [
    "https://cdn.example/old-path/media.ts",
    "https://cdn.example/new-path/media.ts",
  ]);
});

test("delta HLS playlists include skipped segments in stable sequence paths", async () => {
  const manifests = [
    "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:50\n#EXTINF:3,\nhttps://cdn.example/full-50/media.ts\n#EXTINF:3,\nhttps://cdn.example/full-51/media.ts\n",
    "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:50\n#EXT-X-SKIP:SKIPPED-SEGMENTS=1\n#EXTINF:3,\nhttps://cdn.example/delta-51/media.ts\n",
  ];
  const media = new MediaProxy({
    getSession: () => ({ id: "session" }),
    fetcher: async () =>
      new Response(manifests.shift(), {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
  });
  const playlist = media.issue(
    "https://provider.example/live/playlist.m3u8",
    "session",
  );

  const full = ioFor(playlist);
  await media.handle(full.req, full.res);
  const delta = ioFor(playlist);
  await media.handle(delta.req, delta.res);

  const fullSegments = full
    .body()
    .split("\n")
    .filter((line) => line.startsWith("/media/"))
    .map((line) => new URL(line, "http://local.test"));
  const deltaSegment = new URL(
    delta
      .body()
      .split("\n")
      .find((line) => line.startsWith("/media/")),
    "http://local.test",
  );

  assert.notEqual(fullSegments[0].pathname, fullSegments[1].pathname);
  assert.equal(
    deltaSegment.pathname,
    fullSegments[1].pathname,
    "one skipped segment makes the first listed delta segment sequence 51",
  );
  assert.notEqual(deltaSegment.search, fullSegments[1].search);
});

test("stable HLS sequence paths survive upstream extension changes", async () => {
  const manifests = [
    "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9\n#EXTINF:3,\nhttps://cdn.example/segment\n",
    "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9\n#EXTINF:3,\nhttps://cdn.example/segment.ts\n",
  ];
  const media = new MediaProxy({
    getSession: () => ({ id: "session" }),
    fetcher: async () =>
      new Response(manifests.shift(), {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
  });
  const playlist = media.issue(
    "https://provider.example/live/playlist.m3u8",
    "session",
  );

  const first = ioFor(playlist);
  await media.handle(first.req, first.res);
  const second = ioFor(playlist);
  await media.handle(second.req, second.res);
  const segmentPath = (io) =>
    new URL(
      io
        .body()
        .split("\n")
        .find((line) => line.startsWith("/media/")),
      "http://local.test",
    ).pathname;

  assert.equal(segmentPath(first), segmentPath(second));
});

test("an active playlist ticket remains usable at the ticket capacity", async () => {
  const media = new MediaProxy({
    getSession: () => ({ id: "session" }),
    fetcher: async () =>
      new Response("#EXTM3U\n#EXT-X-ENDLIST\n", {
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
  });
  const playlist = media.issue(
    "https://provider.example/live/playlist.m3u8",
    "session",
  );
  for (let index = 0; index < 4999; index++)
    media.issue(`https://cdn.example/segment-${index}.ts`, "session");

  const firstRefresh = ioFor(playlist);
  await media.handle(firstRefresh.req, firstRefresh.res);
  assert.equal(firstRefresh.res.statusCode, 200);

  media.issue("https://cdn.example/one-more-segment.ts", "session");
  const secondRefresh = ioFor(playlist);
  await media.handle(secondRefresh.req, secondRefresh.res);
  assert.equal(secondRefresh.res.statusCode, 200);
});
