import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCaptionTracks,
  parseWebVtt,
  cueAt,
} from "../src/lib/captions.js";

test("Arabic provider captions sort first and are selected automatically", () => {
  const result = normalizeCaptionTracks([
    { id: "english", language: "eng", label: "English" },
    { id: "arabic", language: "ara", label: "Arabic", default: true },
  ]);

  assert.deepEqual(
    result.tracks.map(({ id, language, label }) => ({ id, language, label })),
    [
      { id: "arabic", language: "ar", label: "العربية" },
      { id: "english", language: "eng", label: "English" },
    ],
  );
  assert.equal(result.preferredId, "arabic");
});

test("provider WebVTT captions display only during their cue time", () => {
  const cues = parseWebVtt(
    "\uFEFFWEBVTT\r\n\r\n1\r\n00:00:01.000 --> 00:00:03.000 align:center\r\n<b>مرحبا</b>\r\nبكم\r\n",
  );

  assert.deepEqual(cues, [
    { start: 1, end: 3, text: "مرحبا\nبكم" },
  ]);
  assert.equal(cueAt(cues, 0.99), "");
  assert.equal(cueAt(cues, 1), "مرحبا\nبكم");
  assert.equal(cueAt(cues, 3), "");
});
