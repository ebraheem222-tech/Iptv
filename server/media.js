import { createHash, randomBytes } from "node:crypto";

const TICKET_TTL = 24 * 60 * 60 * 1000;
const MAX_TICKETS = 5000;
const MAX_VARIANTS_PER_TICKET = 256;
const MAX_MANIFEST = 2 * 1024 * 1024;
const HLS =
  /(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|\.m3u8(?:$|\?))/i;

function filename(url) {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(new URL(url).pathname);
  return `media.${match?.[1]?.toLowerCase() || "bin"}`;
}

function identityUrl(url) {
  const value = new URL(url);
  value.search = "";
  value.hash = "";
  return value.href;
}

function waitForDrain(req, res, signal) {
  return new Promise((resolve) => {
    const done = () => {
      res.removeListener("drain", done);
      res.removeListener("close", done);
      res.removeListener("error", done);
      req.removeListener("aborted", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
    res.once("error", done);
    req.once("aborted", done);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted || res.destroyed) done();
  });
}

export class MediaProxy {
  constructor({ fetcher, getSession, basePath = "/media" }) {
    this.fetcher = fetcher;
    this.getSession = getSession;
    this.basePath = basePath.replace(/\/$/, "");
    this.tickets = new Map();

    // Deduplicate by origin + pathname, not the complete URL.
    // HLS providers often rotate signed query parameters for the SAME media
    // sequence. Keeping the proxy pathname stable lets hls.js correctly merge
    // live playlist refreshes while the opaque ?v= token selects the exact
    // upstream URL requested by that refresh.
    this.dedup = new Map();

    this.active = new Map();
  }

  #clean() {
    const now = Date.now();

    for (const [key, value] of this.tickets) {
      if (value.expiresAt <= now) {
        this.tickets.delete(key);
        this.dedup.delete(value.dedupKey);
      }
    }

  }

  #variant(entry, url) {
    let token = entry.variantByUrl.get(url);
    if (token && entry.variants.has(token)) return token;

    token = randomBytes(12).toString("base64url");
    entry.variants.set(token, url);
    entry.variantByUrl.set(url, token);

    while (entry.variants.size > MAX_VARIANTS_PER_TICKET) {
      const oldest = entry.variants.keys().next().value;
      const oldUrl = entry.variants.get(oldest);
      entry.variants.delete(oldest);
      if (entry.variantByUrl.get(oldUrl) === oldest)
        entry.variantByUrl.delete(oldUrl);
    }

    return token;
  }

  #makeRoom() {
    while (this.tickets.size >= MAX_TICKETS) {
      const key = this.tickets.keys().next().value;
      const entry = this.tickets.get(key);
      this.tickets.delete(key);
      if (entry) this.dedup.delete(entry.dedupKey);
    }
  }

  issue(url, sessionId, stableId = "") {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol))
      throw Object.assign(new Error("Invalid media URL"), { statusCode: 400 });

    this.#clean();

    const identity = stableId || identityUrl(parsed.href);
    const dkey = `${sessionId}\0${identity}`;
    let ticket = this.dedup.get(dkey);
    let entry = ticket && this.tickets.get(ticket);

    if (!entry) {
      this.#makeRoom();
      ticket = randomBytes(24).toString("base64url");
      entry = {
        url: parsed.href,
        filename: filename(parsed.href),
        sessionId,
        expiresAt: Date.now() + TICKET_TTL,
        dedupKey: dkey,
        variants: new Map(),
        variantByUrl: new Map(),
      };
      this.tickets.set(ticket, entry);
      this.dedup.set(dkey, ticket);
    } else {
      entry.expiresAt = Date.now() + TICKET_TTL;
      this.tickets.delete(ticket);
      this.tickets.set(ticket, entry);
    }

    const path = `${this.basePath}/${ticket}/${encodeURIComponent(
      entry.filename,
    )}`;

    // Preserve stable proxy path identity across rotating provider query tokens.
    // The exact provider URL stays server-side behind an opaque short token.
    if (stableId || parsed.search || parsed.hash) {
      const variant = this.#variant(entry, parsed.href);
      return `${path}?v=${variant}`;
    }

    entry.url = parsed.href;
    return path;
  }

  revoke(sessionId) {
    for (const [key, value] of this.tickets) {
      if (value.sessionId === sessionId) {
        this.tickets.delete(key);
        this.dedup.delete(value.dedupKey);
      }
    }

    for (const controller of this.active.get(sessionId) || [])
      controller.abort();

    this.active.delete(sessionId);
  }

  describe(mediaPath, sessionId) {
    this.#clean();
    if (
      typeof mediaPath !== "string" ||
      !mediaPath.startsWith(`${this.basePath}/`)
    )
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

    const entry = this.tickets.get(parts[baseParts.length]);
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

  async handle(req, res) {
    res.setHeader("cache-control", "no-store");
    this.#clean();

    const entry = this.tickets.get(req.params.ticket);
    if (!entry || !this.getSession(entry.sessionId))
      return this.#error(res, 404);

    entry.expiresAt = Date.now() + TICKET_TTL;
    this.tickets.delete(req.params.ticket);
    this.tickets.set(req.params.ticket, entry);

    let sourceUrl = entry.url;
    const variant =
      typeof req.query?.v === "string"
        ? req.query.v
        : Array.isArray(req.query?.v)
          ? req.query.v[0]
          : "";

    if (variant) {
      sourceUrl = entry.variants.get(variant);
      if (!sourceUrl) return this.#error(res, 404);
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once?.("aborted", abort);
    res.once?.("close", abort);

    const active = this.active.get(entry.sessionId) || new Set();
    active.add(controller);
    this.active.set(entry.sessionId, active);

    try {
      const headers = {};
      if (req.headers.range) headers.range = req.headers.range;

      const upstream = await this.fetcher(sourceUrl, {
        headers,
        signal: controller.signal,
      });

      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw new Error("Upstream rejected media");
      }

      const type = upstream.headers.get("content-type") || "";
      res.setHeader("content-disposition", "inline");

      if (HLS.test(type) || HLS.test(upstream.finalUrl || sourceUrl)) {
        const reader = upstream.body.getReader();
        let size = 0;
        const parts = [];

        for (;;) {
          const x = await reader.read();
          if (x.done) break;

          size += x.value.length;
          if (size > MAX_MANIFEST) {
            await reader.cancel();
            throw new Error("Manifest too large");
          }

          parts.push(x.value);
        }

        let text = new TextDecoder().decode(Buffer.concat(parts));
        const base = upstream.finalUrl || upstream.url || sourceUrl;

        const rewrite = (raw, stableId = "") => {
          const absolute = new URL(raw, base);
          if (!["http:", "https:"].includes(absolute.protocol))
            throw new Error("Invalid manifest resource");

          return this.issue(absolute.href, entry.sessionId, stableId);
        };

        text = text.replace(
          /URI=("([^"]+)"|'([^']+)')/g,
          (_m, quote, a, b) =>
            `URI=${quote[0]}${rewrite(a || b)}${quote[0]}`,
        );

        const mediaSequence = Number(
          /#EXT-X-MEDIA-SEQUENCE\s*:\s*(\d+)/i.exec(text)?.[1] || 0,
        );
        const skippedSegments = Number(
          /#EXT-X-SKIP\s*:[^\r\n]*\bSKIPPED-SEGMENTS\s*=\s*"?(\d+)/i.exec(
            text,
          )?.[1] || 0,
        );
        let segmentIndex = 0;
        let segmentUriFollows = false;
        text = text
          .split(/(\r?\n)/)
          .map((part) => {
            if (/^#EXTINF\s*:/i.test(part)) segmentUriFollows = true;
            if (part.startsWith("#") || /^\r?\n$/.test(part) || !part.trim())
              return part;
            if (!segmentUriFollows) return rewrite(part.trim());

            segmentUriFollows = false;
            const sequence = mediaSequence + skippedSegments + segmentIndex++;
            return rewrite(
              part.trim(),
              `hls-segment:${req.params.ticket}:${sequence}`,
            );
          })
          .join("");

        res.statusCode = upstream.status;
        res.setHeader("content-type", "application/vnd.apple.mpegurl");
        res.setHeader("content-length", Buffer.byteLength(text));
        return res.end(text);
      }

      res.statusCode = upstream.status;

      for (const h of [
        "content-range",
        "content-length",
        "content-type",
        "accept-ranges",
      ]) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }

      if (!upstream.body) return res.end();

      const reader = upstream.body.getReader();

      for (;;) {
        const x = await reader.read();
        if (x.done) break;

        if (!res.write(Buffer.from(x.value)))
          await waitForDrain(req, res, controller.signal);

        if (controller.signal.aborted) {
          await reader.cancel();
          break;
        }
      }

      if (!res.writableEnded) res.end();
    } catch {
      if (!controller.signal.aborted && !res.headersSent)
        this.#error(res, 502);
      else if (!res.writableEnded) res.end();
    } finally {
      req.removeListener?.("aborted", abort);
      res.removeListener?.("close", abort);
      active.delete(controller);
      if (!active.size) this.active.delete(entry.sessionId);
    }
  }

  #error(res, status) {
    res.statusCode = status;
    res.setHeader?.("content-type", "application/json");
    res.end(
      JSON.stringify({
        error:
          status === 404 ? "Media ticket not found" : "Unable to load media",
      }),
    );
  }
}
