import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { createSafeFetcher } from "../server/network.js";
import { Vault } from "../server/vault.js";
import { MediaProxy } from "../server/media.js";

test("safe fetch rejects private literals, encoded loopback, credentials, and DNS private results", async () => {
  const safeFetch = createSafeFetcher({
    lookup: async () => [{ address: "127.0.0.1", family: 4 }],
  });
  for (const url of [
    "http://127.0.0.1/x",
    "http://2130706433/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://u:p@example.com/x",
    "http://example.test/x",
  ]) {
    await assert.rejects(safeFetch(url), /destination|credentials/i);
  }
});

test("safe fetch validates redirect destinations", async () => {
  const responses = [
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }),
  ];
  const safeFetch = createSafeFetcher({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    dispatcherFactory: () => ({
      fetch: async () => responses.shift(),
      close: async () => {},
    }),
  });
  await assert.rejects(safeFetch("http://public.test/start"), /destination/i);
});

test("safe fetch pins a DNS result when undici requests all addresses", async () => {
  const server = createServer((_req, res) => res.end("pinned"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const safeFetch = createSafeFetcher({
      allowPrivate: true,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    assert.equal(
      await (
        await safeFetch(`http://fixture.test:${server.address().port}`)
      ).text(),
      "pinned",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("safe fetch honors pre-aborted signals and strips redirect credentials", async () => {
  let calls = 0;
  const seen = [];
  const safeFetch = createSafeFetcher({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    dispatcherFactory: () => ({
      fetch: async (_url, options) => {
        calls++;
        seen.push(new Headers(options.headers));
        return calls === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "https://other.test/final" },
            })
          : new Response("ok");
      },
      close: async () => {},
    }),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    safeFetch("https://public.test", { signal: controller.signal }),
    /abort/i,
  );
  await safeFetch("https://public.test", {
    headers: {
      Authorization: "secret",
      Cookie: "private",
      Accept: "text/plain",
    },
  });
  assert.equal(seen[1].get("authorization"), null);
  assert.equal(seen[1].get("cookie"), null);
  assert.equal(seen[1].get("accept"), "text/plain");
});

test("vault persists encrypted sessions, hashes tokens, expires and revokes", () => {
  const directory = mkdtempSync(join(tmpdir(), "nova-vault-"));
  try {
    const vault = new Vault({ directory });
    const { token, session } = vault.create({
      username: "alice",
      password: "secret",
    });
    const disk = readFileSync(join(directory, "vault.json"), "utf8");
    assert.doesNotMatch(disk, /alice|secret|token/);
    assert.ok(
      session.expiresAt - session.createdAt === 30 * 24 * 60 * 60 * 1000,
    );
    assert.equal(new Vault({ directory }).get(token).id, session.id);
    assert.equal(vault.update(session.id, { name: "TV" }).name, "TV");
    assert.equal(vault.delete(session.id), true);
    assert.equal(vault.get(token), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("vault fails closed when opened with the wrong key", () => {
  const directory = mkdtempSync(join(tmpdir(), "nova-vault-key-"));
  try {
    new Vault({
      directory,
      key: Buffer.alloc(32, 1).toString("base64"),
    }).create({ password: "hidden" });
    assert.throws(
      () =>
        new Vault({ directory, key: Buffer.alloc(32, 2).toString("base64") }),
      /corrupt|invalid/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("vault requires an exact base64 key and protects reserved fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "nova-vault-fields-"));
  try {
    assert.throws(
      () => new Vault({ directory, key: "short secret" }),
      /32-byte.*base64/i,
    );
    const vault = new Vault({
      directory,
      key: Buffer.alloc(32).toString("base64"),
    });
    const { session } = vault.create({
      id: "chosen",
      createdAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
      name: "safe",
    });
    assert.notEqual(session.id, "chosen");
    assert.ok(session.createdAt > 0);
    assert.equal(
      session.expiresAt - session.createdAt,
      30 * 24 * 60 * 60 * 1000,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function responseRecorder(ticket) {
  let body = "";
  return {
    req: { params: { ticket }, headers: {}, on() {}, once() {} },
    res: {
      headers: {},
      statusCode: 0,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(v = "") {
        body += v;
        this.writableEnded = true;
      },
      write(v) {
        body += v;
        return true;
      },
      on() {},
      once() {},
    },
    body: () => body,
  };
}

test("media proxy rewrites HLS URI lines and URI attributes against final URL", async () => {
  const manifest =
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/k.bin?auth=1"\nvariant/list.m3u8?x=2\n';
  const fetcher = async () => {
    const r = new Response(manifest, {
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
    Object.defineProperty(r, "finalUrl", {
      value: "https://cdn.test/root/master.m3u8?credential=x",
    });
    return r;
  };
  const media = new MediaProxy({ fetcher, getSession: () => ({ id: "s1" }) });
  const url = media.issue("https://provider.test/master.m3u8", "s1");
  const io = responseRecorder(url.split("/")[2]);
  await media.handle(io.req, io.res);
  assert.doesNotMatch(io.body(), /cdn\.test|credential=x/);
  assert.match(io.body(), /\/media\/[A-Za-z0-9_-]+\/media\.bin/);
  assert.match(io.body(), /\/media\/[A-Za-z0-9_-]+\/media\.m3u8/);
});

test("media proxy forwards Range and selected upstream response headers", async () => {
  let received;
  const fetcher = async (_url, options) => {
    received = options.headers.range;
    return new Response("abc", {
      status: 206,
      headers: {
        "content-range": "bytes 2-4/10",
        "content-length": "3",
        "content-type": "video/mp2t",
        "cache-control": "public, max-age=3600",
      },
    });
  };
  const media = new MediaProxy({ fetcher, getSession: () => ({ id: "s1" }) });
  const issued = media.issue("https://provider.test/movie.ts", "s1");
  const io = responseRecorder(issued.split("/")[2]);
  io.req.headers.range = "bytes=2-4";
  await media.handle(io.req, io.res);
  assert.equal(received, "bytes=2-4");
  assert.equal(io.res.statusCode, 206);
  assert.equal(io.res.headers["content-range"], "bytes 2-4/10");
  assert.equal(io.res.headers["cache-control"], "no-store");
  assert.equal(io.body(), "abc");
  media.revoke("s1");
  const denied = responseRecorder(issued.split("/")[2]);
  await media.handle(denied.req, denied.res);
  assert.equal(denied.res.statusCode, 404);
});

test("media proxy sanitizes upstream errors and marks tickets no-store", async () => {
  const media = new MediaProxy({
    fetcher: async () =>
      new Response("https://u:p@provider.test/private", { status: 403 }),
    getSession: () => ({ id: "s1" }),
  });
  const issued = media.issue("https://provider.test/u/p/video.ts", "s1");
  assert.match(issued, /\/media\/[A-Za-z0-9_-]+\/media\.ts$/);
  const io = responseRecorder(issued.split("/")[2]);
  await media.handle(io.req, io.res);
  assert.equal(io.res.statusCode, 502);
  assert.doesNotMatch(io.body(), /provider|u:p|private/);
  assert.equal(io.res.headers["cache-control"], "no-store");
});

test("revoke aborts active streams and close releases backpressure waits", async () => {
  let upstreamSignal;
  const fetcher = async (_url, { signal }) => {
    upstreamSignal = signal;
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("chunk"));
        },
      }),
      { headers: { "content-type": "video/mp4" } },
    );
  };
  const media = new MediaProxy({ fetcher, getSession: () => ({ id: "s1" }) });
  const issued = media.issue("https://provider.test/video.mp4", "s1");
  const req = Object.assign(new EventEmitter(), {
    params: { ticket: issued.split("/")[2] },
    headers: {},
  });
  const res = Object.assign(new EventEmitter(), {
    headers: {},
    statusCode: 0,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    write() {
      return false;
    },
    end() {
      this.writableEnded = true;
    },
  });
  const handling = media.handle(req, res);
  await new Promise((resolve) => setImmediate(resolve));
  media.revoke("s1");
  res.emit("close");
  await handling;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(res.writableEnded, true);
});
