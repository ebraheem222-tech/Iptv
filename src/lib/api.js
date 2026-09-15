export function saved(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}
export function base() {
  return saved(
    "nova.backend",
    window.NOVA_CONFIG?.apiBase || window.NOVA_API_BASE || "",
  ).replace(/\/$/, "");
}
export function asset(path) {
  path = path || "/artwork/mountains.jpg";
  if (/^(https?:|data:)/.test(path)) return path;
  if (/^\/?artwork\//.test(path)) return "./" + path.replace(/^\//, "");
  return base() + "/" + path.replace(/^\//, "");
}
export async function api(path, method = "GET", body, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort);
  }
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(base() + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + saved("nova.token"),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        data.error?.message ||
          data.error ||
          data.message ||
          "Request failed (" +
            res.status +
            "). Check your connection and try again.",
      );
    return data;
  } catch (e) {
    if (e.name === "AbortError")
      throw new Error(
        signal?.aborted
          ? "Request cancelled."
          : "The server took too long. Check the backend address and try again.",
      );
    if (e instanceof TypeError)
      throw new Error(
        "Cannot reach your server. Check the backend address and network connection.",
      );
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function apiText(path, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort);
  }
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(base() + path, {
      headers: { Authorization: "Bearer " + saved("nova.token") },
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(
        data.error || `Captions could not be loaded (${res.status}).`,
      );
    }
    return await res.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Request cancelled.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
