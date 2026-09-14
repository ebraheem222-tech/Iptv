import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;
const hash = (value) => createHash("sha256").update(value).digest("hex");

function normalizeKey(value) {
  if (Buffer.isBuffer(value) && value.length === 32) return value;
  if (typeof value === "string") {
    const decoded = Buffer.from(value, "base64");
    if (
      decoded.length === 32 &&
      decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")
    )
      return decoded;
  }
  throw new Error(
    "Vault key must be a 32-byte Buffer or base64-encoded 32-byte value",
  );
}

export class Vault {
  constructor({ directory, key } = {}) {
    if (!directory) throw new Error("Vault directory is required");
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, "vault.json");
    this.keyFile = join(directory, "vault.key");
    if (key) this.key = normalizeKey(key);
    else if (existsSync(this.keyFile))
      this.key = normalizeKey(readFileSync(this.keyFile));
    else {
      this.key = randomBytes(32);
      writeFileSync(this.keyFile, this.key, { mode: 0o600, flag: "wx" });
    }
    this.sessions = [];
    if (existsSync(this.file))
      this.sessions = this.#decrypt(readFileSync(this.file, "utf8"));
    this.#purge();
  }
  #decrypt(raw) {
    try {
      const x = JSON.parse(raw);
      const iv = Buffer.from(x.iv, "base64");
      const tag = Buffer.from(x.tag, "base64");
      const d = createDecipheriv("aes-256-gcm", this.key, iv);
      d.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([d.update(Buffer.from(x.data, "base64")), d.final()]),
      );
    } catch {
      throw new Error("Vault data is corrupt or the encryption key is invalid");
    }
  }
  #persist() {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      c.update(JSON.stringify(this.sessions)),
      c.final(),
    ]);
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({
        version: 1,
        iv: iv.toString("base64"),
        tag: c.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      }),
      { mode: 0o600 },
    );
    renameSync(tmp, this.file);
  }
  #purge() {
    const n = Date.now();
    const old = this.sessions.length;
    this.sessions = this.sessions.filter((x) => x.expiresAt > n);
    if (old !== this.sessions.length) this.#persist();
  }
  create(data) {
    this.#purge();
    if (this.sessions.length >= MAX_SESSIONS)
      throw Object.assign(new Error("Session limit reached"), {
        statusCode: 429,
      });
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const session = {
      ...structuredClone(data),
      id: randomBytes(16).toString("base64url"),
      createdAt: now,
      expiresAt: now + TTL,
      tokenHash: hash(token),
    };
    this.sessions.push(session);
    this.#persist();
    return { token, session: this.#public(session) };
  }
  #public(session) {
    if (!session) return null;
    const { tokenHash, ...value } = session;
    return structuredClone(value);
  }
  get(token) {
    this.#purge();
    return this.#public(
      this.sessions.find((x) => x.tokenHash === hash(String(token))),
    );
  }
  getById(id) {
    this.#purge();
    return this.#public(this.sessions.find((x) => x.id === id));
  }
  update(id, patch) {
    this.#purge();
    const session = this.sessions.find((x) => x.id === id);
    if (!session) return null;
    Object.assign(session, structuredClone(patch), {
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      tokenHash: session.tokenHash,
    });
    this.#persist();
    return this.#public(session);
  }
  delete(id) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((x) => x.id !== id);
    if (before !== this.sessions.length) this.#persist();
    return before !== this.sessions.length;
  }
}
