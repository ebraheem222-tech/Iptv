import { randomBytes } from "node:crypto";

const TICKET_TTL = 24 * 60 * 60 * 1000;
const MAX_TICKETS = 5000;
const MAX_MANIFEST = 2 * 1024 * 1024;
const HLS =
  /(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|\.m3u8(?:$|\?))/i;

function filename(url) {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(new URL(url).pathname);
  return `media.${match?.[1]?.toLowerCase() || "bin"}`;
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
    this.dedup = new Map();
    this.active = new Map();
  }
  #clean() {
    const now = Date.now();
    for (const [key, value] of this.tickets)
      if (value.expiresAt <= now) {
        this.tickets.delete(key);
        this.dedup.delete(`${value.sessionId}\0${value.url}`);
      }
    while (this.tickets.size >= MAX_TICKETS) {
      const key = this.tickets.keys().next().value;
      const x = this.tickets.get(key);
      this.tickets.delete(key);
      this.dedup.delete(`${x.sessionId}\0${x.url}`);
    }
  }
  issue(url, sessionId) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol))
      throw Object.assign(new Error("Invalid media URL"), { statusCode: 400 });
    this.#clean();
    const dkey = `${sessionId}\0${parsed.href}`;
    let ticket = this.dedup.get(dkey);
    if (!ticket || !this.tickets.has(ticket)) {
      ticket = randomBytes(24).toString("base64url");
      this.tickets.set(ticket, {
        url: parsed.href,
        sessionId,
        expiresAt: Date.now() + TICKET_TTL,
      });
      this.dedup.set(dkey, ticket);
    }
    return `${this.basePath}/${ticket}/${encodeURIComponent(filename(parsed.href))}`;
  }
  revoke(sessionId) {
    for (const [key, value] of this.tickets)
      if (value.sessionId === sessionId) {
        this.tickets.delete(key);
        this.dedup.delete(`${value.sessionId}\0${value.url}`);
      }
    for (const controller of this.active.get(sessionId) || [])
      controller.abort();
    this.active.delete(sessionId);
  }
  async handle(req, res) {
    res.setHeader("cache-control", "no-store");
    this.#clean();
    const entry = this.tickets.get(req.params.ticket);
    if (!entry || !this.getSession(entry.sessionId))
      return this.#error(res, 404);
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
      const upstream = await this.fetcher(entry.url, {
        headers,
        signal: controller.signal,
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw new Error("Upstream rejected media");
      }
      const type = upstream.headers.get("content-type") || "";
      if (HLS.test(type) || HLS.test(upstream.finalUrl || entry.url)) {
        const reader = upstream.body.getReader();
        let size = 0,
          parts = [];
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
        const base = upstream.finalUrl || upstream.url || entry.url;
        const rewrite = (raw) => {
          const absolute = new URL(raw, base);
          if (!["http:", "https:"].includes(absolute.protocol))
            throw new Error("Invalid manifest resource");
          return this.issue(absolute.href, entry.sessionId);
        };
        text = text.replace(
          /URI=("([^"]+)"|'([^']+)')/g,
          (_m, quote, a, b) => `URI=${quote[0]}${rewrite(a || b)}${quote[0]}`,
        );
        text = text
          .split(/(\r?\n)/)
          .map((part) =>
            part.startsWith("#") || /^\r?\n$/.test(part) || !part.trim()
              ? part
              : rewrite(part.trim()),
          )
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
    } catch (error) {
      if (!controller.signal.aborted && !res.headersSent) this.#error(res, 502);
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
