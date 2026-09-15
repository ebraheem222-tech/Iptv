const ARABIC_NAMES = new Set(["ar", "ara", "arabic", "العربية"]);

function isArabic(value) {
  const language = String(value || "").trim().toLowerCase();
  return ARABIC_NAMES.has(language) || language.startsWith("ar-");
}

export function normalizeCaptionTracks(rows = []) {
  const tracks = rows
    .filter((row) => row && row.id !== undefined && row.id !== null)
    .map((row, order) => {
      const arabic =
        isArabic(row.language) || isArabic(row.label) || isArabic(row.title);
      const language = arabic
        ? "ar"
        : String(row.language || "").trim().toLowerCase();
      return {
        ...row,
        id: String(row.id),
        language,
        label: arabic
          ? "العربية"
          : String(
              row.title ||
                row.label ||
                row.language ||
                `Subtitle ${order + 1}`,
            ).trim(),
        default: Boolean(row.default),
        forced: Boolean(row.forced),
        order,
      };
    })
    .sort((a, b) => {
      const arabic = Number(b.language === "ar") - Number(a.language === "ar");
      if (arabic) return arabic;
      if (a.language === "ar" && b.language === "ar") {
        const preferred = Number(b.default) - Number(a.default);
        if (preferred) return preferred;
        const full = Number(a.forced) - Number(b.forced);
        if (full) return full;
      }
      return a.order - b.order;
    });

  return {
    tracks,
    preferredId: tracks.find((track) => track.language === "ar")?.id || null,
  };
}

function seconds(value) {
  const parts = String(value).replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  const hours = parts.length === 3 ? Number(parts.shift()) : 0;
  const minutes = Number(parts.shift());
  const secs = Number(parts.shift());
  if (![hours, minutes, secs].every(Number.isFinite)) return NaN;
  return hours * 3600 + minutes * 60 + secs;
}

function cleanCueText(value) {
  return String(value)
    .replace(/<\d{2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

export function parseWebVtt(value) {
  if (typeof value !== "string" || value.length > 10 * 1024 * 1024)
    return [];

  const blocks = value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (!lines.length || /^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]))
      continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const match = /^\s*([^\s]+)\s+-->\s+([^\s]+)/.exec(lines[timingIndex]);
    if (!match) continue;
    const start = seconds(match[1]);
    const end = seconds(match[2]);
    const text = cleanCueText(lines.slice(timingIndex + 1).join("\n"));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text)
      cues.push({ start, end, text });
  }

  return cues.sort((a, b) => a.start - b.start);
}

export function cueAt(cues, position) {
  return (Array.isArray(cues) ? cues : [])
    .filter((cue) => position >= cue.start && position < cue.end)
    .map((cue) => cue.text)
    .join("\n");
}
