import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { AppError } from "./errors.js";

const TEXT_CODECS = new Set([
  "subrip",
  "srt",
  "ass",
  "ssa",
  "webvtt",
  "mov_text",
  "text",
]);
const MAX_PROBE_OUTPUT = 2 * 1024 * 1024;
const MAX_VTT_OUTPUT = 10 * 1024 * 1024;

function execute(binary, args, { signal, timeoutMs, maxOutputBytes }) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const child = spawn(binary, args, { shell: false, windowsHide: true });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) rejectPromise(error);
      else resolvePromise(value);
    };
    const stop = (message) => {
      child.kill("SIGKILL");
      finish(new Error(message));
    };
    const abort = () => stop("Caption process cancelled");
    const timer = setTimeout(
      () => stop("Caption process timed out"),
      timeoutMs,
    );
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxOutputBytes)
        return stop("Caption process output limit exceeded");
      chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.once("error", () => finish(new Error("Caption tool unavailable")));
    child.once("close", (code) =>
      code === 0
        ? finish(null, Buffer.concat(chunks))
        : finish(new Error("Caption process failed")),
    );
  });
}

function sourceUrl(loopbackBase, mediaPath) {
  let base;
  try {
    base = new URL(loopbackBase);
  } catch {
    throw new AppError(503, "Captions are unavailable.");
  }
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new AppError(503, "Captions are unavailable.");
  return new URL(mediaPath, base).href;
}

export class CaptionService {
  constructor({
    media,
    getSession,
    tempRoot = join(tmpdir(), "nova-tv-captions"),
    binaries = {
      ffprobePath:
        process.env.NOVA_FFPROBE_PATH || ffprobeInstaller?.path || "",
      ffmpegPath: process.env.NOVA_FFMPEG_PATH || ffmpegStatic || "",
      available: Boolean(
        (process.env.NOVA_FFPROBE_PATH || ffprobeInstaller?.path) &&
          (process.env.NOVA_FFMPEG_PATH || ffmpegStatic),
      ),
    },
    runProcess = execute,
  }) {
    this.media = media;
    this.getSession = getSession;
    this.tempRoot = resolve(tempRoot);
    this.binaries = binaries;
    this.runProcess = runProcess;
    this.tickets = new Map();
    this.active = new Map();
    this.ready = mkdir(this.tempRoot, { recursive: true });
  }

  issue(mediaPath, sessionId) {
    const description = this.media.describe(mediaPath, sessionId);
    if (!description) throw new AppError(404, "Captions not found.");
    const ticket = randomBytes(24).toString("base64url");
    this.tickets.set(ticket, {
      ...description,
      sessionId,
      tracks: null,
      trackMap: new Map(),
    });
    return `/api/captions/${ticket}`;
  }

  #entry(ticket, sessionId) {
    const entry = this.tickets.get(ticket);
    if (
      !entry ||
      entry.sessionId !== sessionId ||
      entry.expiresAt <= Date.now() ||
      !this.getSession(sessionId)
    )
      throw new AppError(404, "Captions not found.");
    return entry;
  }

  async #run(entry, binary, args, options) {
    const controller = new AbortController();
    const externalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const active = this.active.get(entry.sessionId) || new Set();
    active.add(controller);
    this.active.set(entry.sessionId, active);
    try {
      return await this.runProcess(binary, args, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      options.signal?.removeEventListener("abort", externalAbort);
      active.delete(controller);
      if (!active.size) this.active.delete(entry.sessionId);
    }
  }

  async list(ticket, sessionId, loopbackBase, { signal } = {}) {
    const entry = this.#entry(ticket, sessionId);
    if (entry.tracks) return { tracks: entry.tracks };
    if (!this.binaries.available) return { tracks: [] };
    const input = sourceUrl(loopbackBase, entry.mediaPath);
    try {
      const output = await this.#run(
        entry,
        this.binaries.ffprobePath,
        [
          "-v",
          "error",
          "-select_streams",
          "s",
          "-show_entries",
          "stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced",
          "-of",
          "json",
          input,
        ],
        { signal, timeoutMs: 12_000, maxOutputBytes: MAX_PROBE_OUTPUT },
      );
      const parsed = JSON.parse(output.toString("utf8"));
      entry.tracks = (Array.isArray(parsed.streams) ? parsed.streams : [])
        .filter(
          (stream) =>
            Number.isInteger(stream.index) &&
            TEXT_CODECS.has(String(stream.codec_name || "").toLowerCase()),
        )
        .map((stream, order) => {
          const id = randomBytes(12).toString("base64url");
          entry.trackMap.set(id, stream.index);
          return {
            id,
            language: String(stream.tags?.language || "").slice(0, 32),
            title: String(stream.tags?.title || "").slice(0, 120),
            label: String(
              stream.tags?.title ||
                stream.tags?.language ||
                `Subtitle ${order + 1}`,
            ).slice(0, 120),
            default: stream.disposition?.default === 1,
            forced: stream.disposition?.forced === 1,
            source: "embedded",
          };
        });
      return { tracks: entry.tracks };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, "Captions could not be checked.");
    }
  }

  async vtt(ticket, trackId, sessionId, loopbackBase, { signal } = {}) {
    const entry = this.#entry(ticket, sessionId);
    if (!entry.tracks)
      await this.list(ticket, sessionId, loopbackBase, { signal });
    const streamIndex = entry.trackMap.get(trackId);
    if (!Number.isInteger(streamIndex))
      throw new AppError(404, "Captions not found.");
    await this.ready;

    const path = join(this.tempRoot, `${entry.cacheKey}-${streamIndex}.vtt`);
    try {
      const cached = await readFile(path);
      if (cached.length <= MAX_VTT_OUTPUT) return cached;
      await rm(path, { force: true });
    } catch {}

    const input = sourceUrl(loopbackBase, entry.mediaPath);
    try {
      await this.#run(
        entry,
        this.binaries.ffmpegPath,
        [
          "-v",
          "error",
          "-nostdin",
          "-i",
          input,
          "-map",
          `0:${streamIndex}`,
          "-c:s",
          "webvtt",
          "-f",
          "webvtt",
          "-y",
          path,
        ],
        { signal, timeoutMs: 30_000, maxOutputBytes: 64 * 1024 },
      );
      const info = await stat(path);
      if (info.size > MAX_VTT_OUTPUT) {
        await rm(path, { force: true });
        throw new Error("Caption output too large");
      }
      return await readFile(path);
    } catch (error) {
      await rm(path, { force: true }).catch(() => {});
      if (error instanceof AppError) throw error;
      throw new AppError(502, "Captions could not be prepared.");
    }
  }

  revoke(sessionId) {
    for (const [ticket, entry] of this.tickets)
      if (entry.sessionId === sessionId) this.tickets.delete(ticket);
    for (const controller of this.active.get(sessionId) || [])
      controller.abort();
    this.active.delete(sessionId);
  }

  async close() {
    for (const sessionId of [...this.active.keys()]) this.revoke(sessionId);
    await this.ready.catch(() => {});
    if (basename(this.tempRoot).startsWith("nova-"))
      await rm(this.tempRoot, { recursive: true, force: true });
  }
}
