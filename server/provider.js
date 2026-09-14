import { AppError } from "./errors.js";

const ACTIONS = {
  live: ["get_live_categories", "get_live_streams"],
  movie: ["get_vod_categories", "get_vod_streams"],
  series: ["get_series_categories", "get_series"],
};
const CATALOG_ACTIONS = new Set(
  Object.values(ACTIONS).map((actions) => actions[1]),
);
const CATALOG_FIELDS = [
  "stream_id",
  "series_id",
  "id",
  "name",
  "title",
  "category_id",
  "stream_icon",
  "cover",
  "movie_image",
  "year",
  "releaseDate",
  "release_date",
  "rating",
  "rating_5based",
  "container_extension",
];
function compactCatalog(data) {
  if (!Array.isArray(data)) return data;
  return data.map((row) => {
    const item = {};
    for (const field of CATALOG_FIELDS)
      if (row[field] !== undefined) item[field] = row[field];
    return item;
  });
}
const clean = (value, max = 500) => String(value ?? "").slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);
const safeDate = (value) => {
  const date = new Date(Number(value) * 1000);
  return Number(value) > 0 && Number.isFinite(date.getTime())
    ? date.toISOString()
    : null;
};
const decode = (value) => {
  const text = clean(value, 12000);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) return text;
  const decoded = Buffer.from(text, "base64").toString("utf8");
  return decoded.includes("\uFFFD") || /[\x00-\x08]/.test(decoded)
    ? text
    : decoded;
};

export function normalizeProviderUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AppError(
      400,
      "Enter a complete provider URL, including http:// or https://.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new AppError(
      400,
      "Use an HTTP or HTTPS provider URL without embedded login details.",
    );
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname
    .replace(/\/(player_api|get)\.php\/?$/i, "")
    .replace(/\/+$/, "");
  return url.href.replace(/\/+$/, "");
}

async function readJson(response, maxBytes) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      502,
      "The IPTV provider could not complete this request. Try again shortly.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(502, "The IPTV provider returned an empty response.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes)
        throw new AppError(
          502,
          "This provider catalog exceeds the server size limit.",
        );
      chunks.push(Buffer.from(value));
    }
    return { data: JSON.parse(Buffer.concat(chunks).toString("utf8")), size };
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "The server did not return an Xtream-compatible catalog. Check the provider URL.",
    );
  } finally {
    reader.releaseLock();
  }
}

export class Provider {
  constructor({
    fetcher,
    media,
    artwork,
    maxResponseBytes = Number(process.env.PROVIDER_MAX_RESPONSE_MB || 128) *
      1024 *
      1024,
  }) {
    if (
      !Number.isSafeInteger(maxResponseBytes) ||
      maxResponseBytes <= 0 ||
      maxResponseBytes > 512 * 1024 * 1024
    )
      throw new Error(
        "PROVIDER_MAX_RESPONSE_MB must be greater than zero and at most 512.",
      );
    this.maxResponseBytes = maxResponseBytes;
    this.fetcher = fetcher;
    this.media = media;
    this.artwork = artwork || media;
    this.cache = new Map();
    this.cacheSize = 0;
    this.active = new Map();
    this.activeTotal = 0;
  }
  forget(sessionId) {
    for (const [key, entry] of this.cache)
      if (key.startsWith(sessionId + ":")) {
        this.cache.delete(key);
        this.cacheSize -= entry.size || 0;
      }
  }
  async request(session, action, params = {}, cache = true) {
    const key = `${session.id}:${action || "auth"}:${JSON.stringify(params)}`;
    const existing = this.cache.get(key);
    if (cache && existing?.expires > Date.now()) return existing.promise;
    if (existing) {
      this.cache.delete(key);
      this.cacheSize -= existing.size || 0;
    }
    if (this.activeTotal >= 24 || (this.active.get(session.id) || 0) >= 8)
      throw new AppError(
        429,
        "Several provider requests are already running. Please try again shortly.",
      );
    this.activeTotal += 1;
    this.active.set(session.id, (this.active.get(session.id) || 0) + 1);
    const run = async () => {
      const { url, username, password } = session.credentials;
      const target = new URL(url + "/player_api.php");
      target.searchParams.set("username", username);
      target.searchParams.set("password", password);
      if (action) target.searchParams.set("action", action);
      for (const [name, value] of Object.entries(params))
        target.searchParams.set(name, String(value));
      let response;
      try {
        response = await this.fetcher(target.href, {
          signal: AbortSignal.timeout(20000),
          headers: { Accept: "application/json", "User-Agent": "NovaTV/1.0" },
        });
      } catch (error) {
        if (error.status === 400 || error.statusCode === 400)
          throw new AppError(
            400,
            "The provider address is not allowed. Use a public IPTV provider address.",
          );
        throw new AppError(
          502,
          "Cannot reach the IPTV provider. Check the server address and your internet connection.",
        );
      }
      const result = await readJson(response, this.maxResponseBytes);
      // Keep only browsing fields in the cache; full movie/episode metadata is
      // loaded through details endpoints. Large provider catalogs often repeat it.
      if (CATALOG_ACTIONS.has(action)) {
        result.data = compactCatalog(result.data);
        result.size = Buffer.byteLength(JSON.stringify(result.data));
      }
      const current = this.cache.get(key);
      if (current) {
        current.size = result.size;
        this.cacheSize += result.size;
        while (this.cache.size > 128 || this.cacheSize > 128 * 1024 * 1024) {
          const [oldKey, old] = this.cache.entries().next().value;
          this.cache.delete(oldKey);
          this.cacheSize -= old.size || 0;
        }
      }
      return result.data;
    };
    const promise = run();
    if (cache)
      this.cache.set(key, {
        promise,
        expires: Date.now() + (action === "get_short_epg" ? 60000 : 300000),
        size: 0,
      });
    try {
      return await promise;
    } catch (error) {
      const entry = this.cache.get(key);
      if (entry) {
        this.cache.delete(key);
        this.cacheSize -= entry.size || 0;
      }
      throw error;
    } finally {
      this.activeTotal -= 1;
      const count = this.active.get(session.id) - 1;
      if (count > 0) this.active.set(session.id, count);
      else this.active.delete(session.id);
    }
  }
  async connect({ name, url, username, password }) {
    const credentials = { url: normalizeProviderUrl(url), username, password };
    const data = await this.request(
      { id: "connect", credentials },
      null,
      {},
      false,
    );
    const user = data?.user_info;
    if (
      !user ||
      !["1", "true"].includes(String(user.auth).toLowerCase()) ||
      (user.status && String(user.status).toLowerCase() !== "active")
    )
      throw new AppError(
        401,
        "The provider rejected this login or the subscription is inactive. Check your username and password.",
      );
    const expiresAt = safeDate(user.exp_date);
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now())
      throw new AppError(401, "This IPTV subscription has expired.");
    return {
      credentials,
      profile: {
        name,
        server: credentials.url,
        demo: false,
        status: "Active",
        expiresAt,
        maxConnections: Number(user.max_connections) || 0,
        activeConnections: Number(user.active_cons) || 0,
      },
    };
  }
  image(url, session) {
    if (!url || !/^https?:\/\//i.test(String(url))) return "";
    try {
      return this.artwork.issue(String(url), session.id);
    } catch {
      return "";
    }
  }
  item(raw, kind, session) {
    return {
      id: clean(raw.series_id ?? raw.stream_id ?? raw.id, 40),
      kind,
      name: clean(raw.name || raw.title || "Untitled"),
      categoryId: clean(raw.category_id, 100),
      image: this.image(
        raw.stream_icon || raw.cover || raw.movie_image,
        session,
      ),
      year: clean(
        raw.year ||
          raw.releaseDate?.slice(0, 4) ||
          raw.release_date?.slice(0, 4),
        4,
      ),
      rating: clean(
        raw.rating || (raw.rating_5based ? Number(raw.rating_5based) * 2 : ""),
        8,
      ),
      extension: /^[a-z0-9]{1,8}$/i.test(raw.container_extension || "")
        ? raw.container_extension
        : kind === "live"
          ? "m3u8"
          : "mp4",
      plot: clean(raw.plot, 6000),
    };
  }
  async catalog(
    session,
    kind,
    { category = "", q = "", page = 1, limit = 36 } = {},
  ) {
    const actions = ACTIONS[kind];
    const [rawCategories, rawItems] = await Promise.all(
      actions.map((action) => this.request(session, action)),
    );
    if (!Array.isArray(rawItems))
      throw new AppError(
        502,
        "The provider returned an invalid catalog. Your subscription may have expired.",
      );
    const categories = list(rawCategories).map((raw) => ({
      id: clean(raw.category_id, 100),
      name: clean(raw.category_name),
    }));
    const query = q.toLocaleLowerCase();
    const filtered = rawItems.filter(
      (raw) =>
        (!category || String(raw.category_id) === category) &&
        (!query ||
          String(raw.name || "")
            .toLocaleLowerCase()
            .includes(query)),
    );
    return {
      items: filtered
        .slice((page - 1) * limit, page * limit)
        .map((raw) => this.item(raw, kind, session)),
      categories,
      total: filtered.length,
      page,
      pages: Math.max(1, Math.ceil(filtered.length / limit)),
    };
  }
  async findItem(session, kind, id) {
    const rawItems = await this.request(session, ACTIONS[kind][1]);
    const raw = list(rawItems).find(
      (row) => String(row.series_id ?? row.stream_id ?? row.id) === id,
    );
    if (!raw)
      throw new AppError(
        404,
        "This title is no longer available in your subscription.",
      );
    return this.item(raw, kind, session);
  }
  async details(session, kind, id) {
    const item = await this.findItem(session, kind, id);
    if (kind === "live") {
      let epg = [];
      let guideError = "";
      try {
        const guide = await this.request(session, "get_short_epg", {
          stream_id: id,
          limit: 8,
        });
        epg = list(guide.epg_listings)
          .map((row) => ({
            title: decode(row.title),
            description: decode(row.description),
            start: safeDate(row.start_timestamp),
            end: safeDate(row.stop_timestamp || row.end_timestamp),
          }))
          .filter((row) => row.start && row.end);
      } catch {
        guideError =
          "The provider guide is unavailable. You can still watch this channel.";
      }
      return {
        item,
        epg,
        guideError,
        plot: "",
        genre: "",
        director: "",
        cast: "",
        duration: "",
      };
    }
    const data = await this.request(
      session,
      kind === "series" ? "get_series_info" : "get_vod_info",
      kind === "series" ? { series_id: id } : { vod_id: id },
    );
    if (!data || typeof data !== "object")
      throw new AppError(502, "The provider returned invalid title details.");
    const info = data.info || {};
    const detail = {
      item,
      plot: clean(info.plot || item.plot, 6000),
      genre: clean(info.genre),
      director: clean(info.director),
      cast: clean(info.cast || info.actors, 2000),
      duration: clean(info.duration),
    };
    if (kind === "movie") {
      if (
        data.movie_data?.container_extension &&
        /^[a-z0-9]{1,8}$/i.test(data.movie_data.container_extension)
      )
        detail.item.extension = data.movie_data.container_extension;
      return detail;
    }
    const episodes = [];
    for (const [seasonKey, values] of Object.entries(data.episodes || {})) {
      for (const episode of list(values)) {
        episodes.push({
          id: clean(episode.id, 40),
          kind: "episode",
          name: clean(episode.title || `Episode ${episode.episode_num}`),
          season: Number(episode.season ?? seasonKey) || 1,
          episode: Number(episode.episode_num) || episodes.length + 1,
          extension: /^[a-z0-9]{1,8}$/i.test(episode.container_extension || "")
            ? episode.container_extension
            : "mp4",
          image: this.image(episode.info?.movie_image, session) || item.image,
          plot: clean(episode.info?.plot, 6000),
          duration: clean(episode.info?.duration),
          seriesId: id,
          seriesName: item.name,
        });
      }
    }
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return {
      ...detail,
      seasons: [...new Set(episodes.map((row) => row.season))].sort(
        (a, b) => a - b,
      ),
      episodes,
    };
  }
  play(session, { kind, id, extension }) {
    const credentials = session.credentials;
    const folder =
      kind === "live" ? "live" : kind === "movie" ? "movie" : "series";
    const ext = kind === "live" ? "m3u8" : extension || "mp4";
    const url = `${credentials.url}/${folder}/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${id}.${ext}`;
    return {
      url: this.media.issue(url, session.id),
      mime:
        ext === "m3u8"
          ? "application/vnd.apple.mpegurl"
          : ext === "mkv"
            ? "video/x-matroska"
            : ext === "webm"
              ? "video/webm"
              : "video/mp4",
      live: kind === "live",
    };
  }
}
