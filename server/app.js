import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z, ZodError } from "zod";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Vault } from "./vault.js";
import { createSafeFetcher } from "./network.js";
import { MediaProxy } from "./media.js";
import { Artwork } from "./artwork.js";
import { Provider } from "./provider.js";
import { AppError } from "./errors.js";
import { demoCatalog, demoDetails, demoPlay, demoProfile } from "./demo.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kindSchema = z.enum(["live", "movie", "series"]);
const idSchema = z.string().regex(/^\d{1,20}$/);
const itemSchema = z.object({
  id: idSchema,
  kind: z.enum(["live", "movie", "series", "episode"]),
  name: z.string().min(1).max(500),
  categoryId: z.string().max(100).optional().default(""),
  image: z
    .string()
    .max(4096)
    .regex(
      /^(?:|\/artwork\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)|\/image\/[A-Za-z0-9_-]+\/artwork)$/,
    )
    .optional()
    .default(""),
  year: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => String(value ?? "").slice(0, 4)),
  rating: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => String(value ?? "").slice(0, 8)),
  extension: z
    .string()
    .regex(/^[a-zA-Z0-9]{1,8}$/)
    .optional(),
  plot: z.string().max(6000).optional(),
  season: z.number().int().nonnegative().optional(),
  episode: z.number().int().nonnegative().optional(),
  seriesId: idSchema.optional(),
  seriesName: z.string().max(500).optional(),
  duration: z.union([z.number(), z.string()]).optional(),
});
const prefs = () => ({ favorites: [], progress: {} });

export function createApp(config = {}) {
  const app = express();
  const vault = new Vault({
    directory: resolve(config.dataDir || process.env.DATA_DIR || "./data"),
    key: config.vaultKey || process.env.VAULT_KEY || undefined,
  });
  const fetcher = createSafeFetcher({
    allowPrivate:
      config.allowPrivateProviders ??
      process.env.ALLOW_PRIVATE_PROVIDERS === "true",
  });
  const media = new MediaProxy({
    fetcher,
    getSession: (id) => vault.getById(id),
  });
  const artwork = new Artwork({
    key: vault.key,
    media,
    getSession: (id) => vault.getById(id),
  });
  const provider = new Provider({ fetcher, media, artwork });
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:", "http:", "https:"],
          "connect-src": ["'self'", "http:", "https:"],
          "media-src": ["'self'", "blob:", "http:", "https:"],
          "upgrade-insecure-requests": null,
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      strictTransportSecurity: false,
    }),
  );
  const origins = (config.corsOrigins || process.env.CORS_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  app.use(
    cors((req, done) => {
      const origin = req.headers.origin;
      // LG packaged apps may report a file:// origin as well as null. The token is
      // still mandatory for private routes; no browser cookies grant access.
      const packaged = origin === "null" || origin === "file://";
      const same = origin === `${req.protocol}://${req.get("host")}`;
      const development = /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(
        origin || "",
      );
      const allowed =
        !origin || packaged || same || development || origins.includes(origin);
      done(null, {
        origin: allowed,
        methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "Range"],
        exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
        maxAge: 600,
      });
    }),
  );
  app.use(express.json({ limit: "24kb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // Reject cross-site mutations even when CORS would merely hide their response.
  app.use("/api", (req, res, next) => {
    if (!["POST", "PUT", "DELETE"].includes(req.method) || !req.headers.origin)
      return next();
    const origin = req.headers.origin;
    if (
      origin === "null" ||
      origin === "file://" ||
      origin === `${req.protocol}://${req.get("host")}` ||
      /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin) ||
      origins.includes(origin)
    )
      return next();
    return res
      .status(403)
      .json({
        error:
          "This web address is not allowed to use the backend. Configure CORS_ORIGINS for your frontend.",
      });
  });
  app.get("/api/health", (req, res) =>
    res.json({ status: "ok", name: "Nova TV", version: "1.0.0" }),
  );
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many connection attempts. Please try again in 15 minutes.",
    },
  });
  app.post("/api/connect", loginLimit, async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(60),
        url: z.string().trim().min(1).max(2048),
        username: z.string().min(1).max(256),
        password: z.string().min(1).max(256),
      })
      .parse(req.body);
    const connection = await provider.connect(input);
    const { token, session } = vault.create({
      ...connection,
      preferences: prefs(),
    });
    res.json({ token, profile: session.profile });
  });
  app.post("/api/demo", loginLimit, (req, res) => {
    const { token, session } = vault.create({
      profile: demoProfile,
      preferences: prefs(),
    });
    res.json({ token, profile: session.profile });
  });
  app.use("/api", (req, res, next) => {
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
      req.headers.authorization || "",
    )?.[1];
    const session = token && vault.get(token);
    if (!session)
      return res
        .status(401)
        .json({
          error: "Your session has ended. Please connect your playlist again.",
        });
    req.session = session;
    next();
  });
  app.get("/api/session", (req, res) =>
    res.json({
      profile: req.session.profile,
      preferences: req.session.preferences || prefs(),
    }),
  );
  app.delete("/api/session", (req, res) => {
    media.revoke(req.session.id);
    provider.forget(req.session.id);
    vault.delete(req.session.id);
    res.sendStatus(204);
  });
  app.get("/api/catalog/:kind", async (req, res) => {
    const kind = kindSchema.parse(req.params.kind);
    const query = z
      .object({
        category: z.string().max(100).default(""),
        q: z.string().max(200).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(36),
      })
      .parse(req.query);
    res.json(
      req.session.profile.demo
        ? demoCatalog(kind, query)
        : await provider.catalog(req.session, kind, query),
    );
  });
  app.get("/api/details/:kind/:id", async (req, res) => {
    const kind = kindSchema.parse(req.params.kind);
    const id = idSchema.parse(req.params.id);
    res.json(
      req.session.profile.demo
        ? demoDetails(kind, id)
        : await provider.details(req.session, kind, id),
    );
  });
  app.post("/api/play", (req, res) => {
    const input = z
      .object({
        kind: z.enum(["live", "movie", "episode"]),
        id: idSchema,
        extension: z
          .enum([
            "mp4",
            "mkv",
            "m3u8",
            "ts",
            "webm",
            "avi",
            "mov",
            "m4v",
            "MP4",
            "MKV",
          ])
          .optional()
          .transform((v) => v?.toLowerCase()),
      })
      .parse(req.body);
    res.json(
      req.session.profile.demo
        ? demoPlay(media, req.session, input)
        : provider.play(req.session, input),
    );
  });
  app.get("/api/preferences", (req, res) =>
    res.json(req.session.preferences || prefs()),
  );
  app.put("/api/preferences/favorite", (req, res) => {
    const { item } = z.object({ item: itemSchema }).parse(req.body);
    const preferences = req.session.preferences || prefs();
    const index = preferences.favorites.findIndex(
      (row) => row.kind === item.kind && row.id === item.id,
    );
    if (index >= 0) preferences.favorites.splice(index, 1);
    else {
      if (preferences.favorites.length >= 500)
        throw new AppError(
          400,
          "Your favorites list is full. Remove a title first.",
        );
      preferences.favorites.unshift(item);
    }
    vault.update(req.session.id, { preferences });
    res.json(preferences);
  });
  app.put("/api/preferences/progress", (req, res) => {
    const { item, position, duration } = z
      .object({
        item: itemSchema,
        position: z.number().finite().min(0).max(604800),
        duration: z.number().finite().min(0).max(604800),
      })
      .parse(req.body);
    if (item.kind === "live" || item.kind === "series")
      throw new AppError(400, "Progress is available for movies and episodes.");
    const preferences = req.session.preferences || prefs();
    const key = `${item.kind}:${item.id}`;
    if (duration > 0 && position / duration > 0.95)
      delete preferences.progress[key];
    else
      preferences.progress[key] = {
        item,
        position: duration > 0 ? Math.min(position, duration) : position,
        duration,
        updatedAt: new Date().toISOString(),
      };
    const entries = Object.entries(preferences.progress)
      .sort((a, b) =>
        String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)),
      )
      .slice(0, 200);
    preferences.progress = Object.fromEntries(entries);
    vault.update(req.session.id, { preferences });
    res.json(preferences);
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.get("/media/:ticket/:filename", (req, res) => media.handle(req, res));
  app.get("/image/:token/artwork", (req, res) => artwork.handle(req, res));
  app.use(
    "/artwork",
    express.static(resolve(workspace, "public/artwork"), { maxAge: "1d" }),
  );
  app.use(
    express.static(resolve(workspace, "dist"), {
      maxAge: "1h",
      setHeaders(res, path) {
        if (/\.(html|js)$/.test(path))
          res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/", (req, res) => {
    const index = resolve(workspace, "dist/index.html");
    if (existsSync(index)) return res.sendFile(index);
    res
      .type("html")
      .send(
        '<!doctype html><title>Nova TV</title><h1>Nova TV backend is running</h1><p>Run npm run build, or open the development app at <a href="http://localhost:5173">localhost:5173</a>.</p>',
      );
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError)
      return res
        .status(400)
        .json({
          error: "Some details are invalid. Check the fields and try again.",
          fields: [
            ...new Set(error.issues.map((issue) => issue.path.join("."))),
          ],
        });
    if (error.type === "entity.parse.failed")
      return res
        .status(400)
        .json({ error: "The request body must be valid JSON." });
    if (error.type === "entity.too.large")
      return res.status(413).json({ error: "The request is too large." });
    const status = Number(error.status || error.statusCode) || 500;
    res
      .status(status >= 400 && status <= 599 ? status : 500)
      .json({
        error:
          error instanceof AppError
            ? error.message
            : status === 400
              ? "This address or request is not supported."
              : "The request could not be completed. Please try again.",
      });
  });
  return app;
}
