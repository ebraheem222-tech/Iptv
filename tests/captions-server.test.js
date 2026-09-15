import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CaptionService } from "../server/captions.js";

test("provider caption service returns only authorized text subtitles as WebVTT", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "nova-captions-test-"));
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
    tempRoot,
    binaries: {
      ffprobePath: "probe",
      ffmpegPath: "convert",
      available: true,
    },
    runProcess: async (binary, args) => {
      calls.push({ binary, args });
      if (binary === "probe") {
        return Buffer.from(
          JSON.stringify({
            streams: [
              {
                index: 2,
                codec_name: "ass",
                tags: { language: "ara", title: "Arabic" },
                disposition: { default: 1, forced: 0 },
              },
              {
                index: 3,
                codec_name: "subrip",
                tags: { language: "eng", title: "English" },
                disposition: { default: 0, forced: 0 },
              },
              { index: 4, codec_name: "hdmv_pgs_subtitle" },
            ],
          }),
        );
      }
      await writeFile(
        args.at(-1),
        "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nمرحبا\n",
      );
      return Buffer.alloc(0);
    },
  });

  try {
    const captionsUrl = service.issue("/media/valid/media.mkv", "owner");
    const ticket = captionsUrl.split("/").at(-1);
    assert.match(captionsUrl, /^\/api\/captions\/[A-Za-z0-9_-]+$/);
    await assert.rejects(
      service.list(ticket, "intruder", "http://127.0.0.1:3000"),
      /not found/i,
    );

    const result = await service.list(
      ticket,
      "owner",
      "http://127.0.0.1:3000",
    );
    assert.deepEqual(
      result.tracks.map(({ language, title }) => ({ language, title })),
      [
        { language: "ara", title: "Arabic" },
        { language: "eng", title: "English" },
      ],
    );
    assert.ok(result.tracks.every((track) => /^[A-Za-z0-9_-]+$/.test(track.id)));
    assert.doesNotMatch(JSON.stringify(result), /media\/valid|127\.0\.0\.1/);

    const arabic = result.tracks[0];
    const vtt = await service.vtt(
      ticket,
      arabic.id,
      "owner",
      "http://127.0.0.1:3000",
    );
    assert.match(vtt.toString("utf8"), /مرحبا/);
    assert.deepEqual(calls.at(-1).args.slice(-8, -1), [
      "-map",
      "0:2",
      "-c:s",
      "webvtt",
      "-f",
      "webvtt",
      "-y",
    ]);
    await assert.rejects(
      service.vtt(ticket, "../2", "owner", "http://127.0.0.1:3000"),
      /not found/i,
    );
  } finally {
    await service.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
