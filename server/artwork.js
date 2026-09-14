import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Artwork links persist with favorites. Encrypt their source URL rather than storing
// a temporary media ticket, so they survive a restart without exposing credentials.
export class Artwork {
  constructor({ key, media, getSession }) {
    this.key = key;
    this.media = media;
    this.getSession = getSession;
  }
  issue(url, sessionId) {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.href.length > 2400
    )
      return "";
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("nova-artwork-v1"));
    const body = Buffer.concat([
      cipher.update(JSON.stringify({ url: parsed.href, sessionId })),
      cipher.final(),
    ]);
    const token = Buffer.concat([iv, cipher.getAuthTag(), body]).toString(
      "base64url",
    );
    return `/image/${token}/artwork`;
  }
  async handle(req, res) {
    try {
      const token = req.params.token;
      if (!/^[A-Za-z0-9_-]{40,4096}$/.test(token)) throw new Error();
      const bytes = Buffer.from(token, "base64url");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from("nova-artwork-v1"));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const data = JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      );
      if (!this.getSession(data.sessionId)) throw new Error();
      const path = this.media.issue(data.url, data.sessionId);
      req.params.ticket = path.split("/")[2];
      return this.media.handle(req, res);
    } catch {
      return res.status(404).json({ error: "Artwork is unavailable." });
    }
  }
}
