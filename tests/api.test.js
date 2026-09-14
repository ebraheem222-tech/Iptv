import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let api, provider, root, base, upstream, token;
const requests = [];
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    ),
  );
const close = (server) =>
  new Promise((resolve) => (server ? server.close(resolve) : resolve()));
async function request(path, { method = "GET", body, auth = token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    data: res.status === 204 ? null : await res.json(),
  };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "nova-api-"));
  provider = createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
    requests.push(url);
    if (url.pathname === "/poster.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      return res.end("sample-artwork");
    }
    if (
      url.pathname.startsWith("/movie/") ||
      url.pathname.startsWith("/series/")
    ) {
      res.writeHead(206, {
        "Content-Type": "video/mp4",
        "Content-Range": "bytes 0-3/20",
        "Accept-Ranges": "bytes",
      });
      return res.end("test");
    }
    if (url.pathname.endsWith(".m3u8")) {
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      return res.end(
        "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts?secret=provider-token\n",
      );
    }
    res.setHeader("Content-Type", "application/json");
    if (url.searchParams.get("password") !== "paid-pass")
      return res.end(
        JSON.stringify({ user_info: { auth: 0, status: "Disabled" } }),
      );
    let data;
    switch (url.searchParams.get("action")) {
      case null:
        data = {
          user_info: {
            auth: 1,
            status: "Active",
            username: "paid-user",
            password: "paid-pass",
            exp_date: "2000000000",
            max_connections: "2",
            active_cons: "0",
          },
        };
        break;
      case "get_live_categories":
        data = [
          { category_id: "sports", category_name: "Sports" },
          { category_id: "news", category_name: "News" },
        ];
        break;
      case "get_vod_categories":
        data = [{ category_id: "cinema", category_name: "Cinema" }];
        break;
      case "get_series_categories":
        data = [{ category_id: "drama", category_name: "Drama" }];
        break;
      case "get_live_streams":
        data = [
          {
            stream_id: 10,
            name: "Sport One",
            category_id: "sports",
            stream_icon: upstream + "/poster.jpg?password=paid-pass",
          },
          { stream_id: 11, name: "News World", category_id: "news" },
        ];
        break;
      case "get_vod_streams":
        data = [
          {
            stream_id: 20,
            name: "Sample Movie",
            category_id: "cinema",
            container_extension: "mp4",
            rating: "8.2",
          },
        ];
        break;
      case "get_series":
        data = [
          {
            series_id: 30,
            name: "Sample Series",
            category_id: "drama",
            cover: "",
          },
        ];
        break;
      case "get_vod_info":
        data = {
          info: {
            plot: "A film synopsis",
            genre: "Adventure",
            duration: "01:30:00",
          },
          movie_data: {
            stream_id: 20,
            name: "Sample Movie",
            container_extension: "mp4",
          },
        };
        break;
      case "get_series_info":
        data = {
          info: { name: "Sample Series", plot: "A series synopsis" },
          seasons: [{ season_number: 1 }, { season_number: 2 }],
          episodes: {
            1: [
              {
                id: "301",
                title: "The Beginning",
                episode_num: 1,
                container_extension: "mp4",
                info: { plot: "First episode" },
              },
            ],
            2: [
              {
                id: "302",
                title: "The Return",
                episode_num: 1,
                container_extension: "mkv",
                info: {},
              },
            ],
          },
        };
        break;
      case "get_short_epg":
        data = {
          epg_listings: [
            {
              title: Buffer.from("The Match").toString("base64"),
              description: Buffer.from("Live sport").toString("base64"),
              start_timestamp: "1800000000",
              stop_timestamp: "1800003600",
            },
          ],
        };
        break;
      default:
        res.statusCode = 400;
        data = { error: "Unknown action" };
    }
    res.end(JSON.stringify(data));
  });
  upstream = await listen(provider);
  const module = await import("../server/app.js").catch(() => ({}));
  assert.equal(
    typeof module.createApp,
    "function",
    "backend must expose a runnable application factory",
  );
  api = module
    .createApp({ dataDir: root, allowPrivateProviders: true })
    .listen();
  await new Promise((resolve) =>
    api.listening ? resolve() : api.once("listening", resolve),
  );
  base = `http://127.0.0.1:${api.address().port}`;
});
after(async () => {
  await close(api);
  await close(provider);
  if (root) await rm(root, { recursive: true, force: true });
});

test("protected routes cannot read any subscription without a session", async () => {
  assert.equal((await request("/api/catalog/live", { auth: "" })).status, 401);
});
test("default CORS permits the app origin and rejects unrelated websites", async () => {
  const denied = await fetch(base + "/api/health", {
    headers: { Origin: "https://unrelated.example" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const local = await fetch(base + "/api/health", {
    headers: { Origin: base },
  });
  assert.equal(local.headers.get("access-control-allow-origin"), base);
  const tv = await fetch(base + "/api/health", { headers: { Origin: "null" } });
  assert.equal(tv.headers.get("access-control-allow-origin"), "null");
});
test("invalid provider credentials do not create a session", async () => {
  const result = await request("/api/connect", {
    method: "POST",
    auth: "",
    body: {
      name: "Home",
      url: upstream,
      username: "paid-user",
      password: "wrong",
    },
  });
  assert.equal(result.status, 401);
  assert.ok(!JSON.stringify(result.data).includes("wrong"));
});
test("connect authenticates credentials and returns a safe named profile", async () => {
  const result = await request("/api/connect", {
    method: "POST",
    auth: "",
    body: {
      name: "Living room",
      url: upstream + "/player_api.php",
      username: "paid-user",
      password: "paid-pass",
    },
  });
  assert.equal(result.status, 200);
  token = result.data.token;
  assert.ok(token.length >= 32);
  assert.equal(result.data.profile.name, "Living room");
  assert.equal(result.data.profile.maxConnections, 2);
  assert.equal(result.data.profile.server, upstream);
  assert.ok(!JSON.stringify(result.data).includes("paid-pass"));
});
test("catalog normalizes, filters and paginates provider data", async () => {
  const result = await request(
    "/api/catalog/live?category=sports&q=Sport&limit=1",
  );
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.data.items.map(({ id, name, kind }) => ({ id, name, kind })),
    [{ id: "10", name: "Sport One", kind: "live" }],
  );
  assert.equal(result.data.total, 1);
  assert.equal(result.data.categories[0].name, "Sports");
  assert.equal((await request("/api/catalog/live?page=0")).status, 400);
});
test("series expands provider seasons into selectable episodes", async () => {
  const result = await request("/api/details/series/30");
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.seasons, [1, 2]);
  assert.equal(result.data.episodes[1].id, "302");
  assert.equal(result.data.episodes[1].extension, "mkv");
  assert.equal(result.data.episodes[0].kind, "episode");
});
test("live guide decodes titles and gives unambiguous ISO times", async () => {
  const result = await request("/api/details/live/10");
  assert.equal(result.status, 200);
  assert.equal(result.data.epg[0].title, "The Match");
  assert.equal(result.data.epg[0].start, "2027-01-15T08:00:00.000Z");
});
test("favorites and progress persist and another session cannot see them", async () => {
  const item = {
    id: "20",
    kind: "movie",
    name: "Sample Movie",
    categoryId: "cinema",
    image: "",
    extension: "mp4",
    year: "",
    rating: "8.2",
  };
  assert.equal(
    (
      await request("/api/preferences/favorite", {
        method: "PUT",
        body: { item },
      })
    ).data.favorites.length,
    1,
  );
  assert.equal(
    (
      await request("/api/preferences/progress", {
        method: "PUT",
        body: { item, position: 123, duration: 5400 },
      })
    ).data.progress["movie:20"].position,
    123,
  );
  const restored = await request("/api/session");
  assert.equal(restored.data.preferences.favorites[0].id, "20");
  const other = await request("/api/demo", { method: "POST", auth: "" });
  assert.equal(
    (await request("/api/preferences", { auth: other.data.token })).data
      .favorites.length,
    0,
  );
  assert.equal(
    (
      await request("/api/preferences/progress", {
        method: "PUT",
        body: { item, position: -1, duration: 50 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/preferences/favorite", {
        method: "PUT",
        body: {
          item: {
            ...item,
            image: "https://provider/paid-user/paid-pass/image.jpg",
          },
        },
      })
    ).status,
    400,
  );
});
test("saved provider artwork survives an application restart without exposing credentials", async () => {
  const item = (await request("/api/catalog/live")).data.items[0];
  assert.equal((await fetch(base + item.image)).status, 200);
  assert.ok(!item.image.includes("paid-pass"));
  await request("/api/preferences/favorite", { method: "PUT", body: { item } });
  await close(api);
  const { createApp } = await import("../server/app.js");
  api = createApp({ dataDir: root, allowPrivateProviders: true }).listen();
  await new Promise((resolve) =>
    api.listening ? resolve() : api.once("listening", resolve),
  );
  base = `http://127.0.0.1:${api.address().port}`;
  const saved = (await request("/api/preferences")).data.favorites.find(
    (row) => row.id === "10",
  );
  const image = await fetch(base + saved.image);
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "sample-artwork");
});
test("play uses opaque tickets and rewrites HLS without leaking credentials", async () => {
  const result = await request("/api/play", {
    method: "POST",
    body: { kind: "live", id: "10" },
  });
  assert.equal(result.status, 200);
  assert.ok(result.data.url.startsWith("/media/"));
  assert.ok(!result.data.url.includes("paid-pass"));
  const playlist = await fetch(base + result.data.url);
  assert.equal(playlist.status, 200);
  const text = await playlist.text();
  assert.ok(text.includes("/media/"));
  assert.ok(!text.includes("provider-token"));
  assert.equal(
    (
      await request("/api/play", {
        method: "POST",
        body: { kind: "movie", id: "../etc", extension: "mp4" },
      })
    ).status,
    400,
  );
});
test("movie proxy forwards partial content and logout invalidates playback", async () => {
  const play = await request("/api/play", {
    method: "POST",
    body: { kind: "movie", id: "20", extension: "mp4" },
  });
  const response = await fetch(base + play.data.url, {
    headers: { Range: "bytes=0-3" },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/20");
  assert.equal(await response.text(), "test");
  assert.equal(
    (await request("/api/session", { method: "DELETE" })).status,
    204,
  );
  assert.equal((await request("/api/session")).status, 401);
  assert.ok(
    [401, 403, 404, 410].includes((await fetch(base + play.data.url)).status),
  );
});
test("demo provides clearly identified working browsing data", async () => {
  const connected = await request("/api/demo", { method: "POST", auth: "" });
  assert.equal(connected.status, 200);
  assert.equal(connected.data.profile.demo, true);
  const result = await request("/api/catalog/movie", {
    auth: connected.data.token,
  });
  assert.ok(result.data.items.length >= 3);
  assert.ok(result.data.categories.length >= 1);
  assert.equal(
    (await request("/api/catalog/nope", { auth: connected.data.token })).status,
    400,
  );
});
