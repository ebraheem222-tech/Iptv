import test from "node:test";
import assert from "node:assert/strict";
import { Provider } from "../server/provider.js";

test("large VOD catalogs load and remain cached without unused provider metadata", async () => {
  let calls = 0;
  const json = JSON.stringify([
    {
      stream_id: 123,
      name: "A real movie",
      category_id: "films",
      container_extension: "mkv",
      provider_extra: "x".repeat(25 * 1024 * 1024),
    },
  ]);
  const provider = new Provider({
    fetcher: async () => {
      calls++;
      return new Response(json);
    },
    media: {},
  });
  const session = {
    id: "large",
    credentials: {
      url: "https://provider.example",
      username: "user",
      password: "pass",
    },
  };
  const first = await provider.request(session, "get_vod_streams");
  assert.equal(first[0].name, "A real movie");
  assert.equal(first[0].container_extension, "mkv");
  assert.equal(first[0].provider_extra, undefined);
  assert.equal(
    (await provider.request(session, "get_vod_streams"))[0].stream_id,
    123,
  );
  assert.equal(calls, 1);
});

test("catalog responses still enforce the configured upper bound", async () => {
  const provider = new Provider({
    fetcher: async () => new Response("x".repeat(2048)),
    media: {},
    maxResponseBytes: 1024,
  });
  await assert.rejects(
    provider.request(
      {
        id: "cap",
        credentials: {
          url: "https://provider.example",
          username: "u",
          password: "p",
        },
      },
      "get_vod_streams",
    ),
    /size limit/,
  );
});

test("provider bounds concurrent requests and frees capacity after completion", async () => {
  const waiting = [];
  const fetcher = () => new Promise((resolve) => waiting.push(resolve));
  const provider = new Provider({ fetcher, media: {} });
  const session = {
    id: "bounded",
    credentials: {
      url: "https://provider.example",
      username: "u",
      password: "p",
    },
  };
  const requests = Array.from({ length: 8 }, (_, i) =>
    provider.request(session, "get_short_epg", { stream_id: i }),
  );
  let outcome = "pending";
  const extra = provider
    .request(session, "get_short_epg", { stream_id: 100 })
    .then(
      () => {
        outcome = "accepted";
      },
      (error) => {
        outcome = error.status;
      },
    );
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Resolve held requests before asserting, so even a failing test leaves no work running.
  const blocked = outcome;
  waiting.forEach((resolve) =>
    resolve(
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ),
  );
  await Promise.all([...requests, extra]);
  assert.equal(blocked, 429);
  const next = provider.request(session, "get_short_epg", { stream_id: 101 });
  waiting.at(-1)(new Response("{}"));
  assert.deepEqual(await next, {});
});
