import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function publicAddress(value) {
  try {
    let address = ipaddr.parse(value);
    if (address.kind() === "ipv6" && address.isIPv4MappedAddress())
      address = address.toIPv4Address();
    return address.range() === "unicast";
  } catch {
    return false;
  }
}

async function resolveHost(hostname, lookup) {
  if (net.isIP(hostname))
    return [{ address: hostname, family: net.isIP(hostname) }];
  return lookup(hostname, { all: true, verbatim: true });
}

export function createSafeFetcher({
  allowPrivate = false,
  lookup = dns.lookup,
  dispatcherFactory,
} = {}) {
  return async function safeFetch(
    input,
    { method = "GET", headers, signal } = {},
  ) {
    signal?.throwIfAborted();
    let target;
    try {
      target = new URL(input);
    } catch {
      throw Object.assign(new Error("Invalid destination URL"), {
        statusCode: 400,
      });
    }
    let currentMethod = method;
    let currentHeaders = new Headers(headers);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (
        !["http:", "https:"].includes(target.protocol) ||
        target.username ||
        target.password
      ) {
        throw Object.assign(
          new Error("Invalid destination URL or credentials"),
          { statusCode: 400 },
        );
      }
      signal?.throwIfAborted();
      const addresses = await resolveHost(target.hostname, lookup).catch(
        () => [],
      );
      if (
        !addresses.length ||
        (!allowPrivate &&
          addresses.some(({ address }) => !publicAddress(address)))
      ) {
        throw Object.assign(new Error("Destination address is not allowed"), {
          statusCode: 400,
        });
      }
      const pinned = addresses[0];
      const agent = dispatcherFactory
        ? dispatcherFactory({
            hostname: target.hostname,
            address: pinned.address,
            family: pinned.family,
          })
        : new Agent({
            connect: {
              lookup: (_host, opts, callback) =>
                opts.all
                  ? callback(null, [pinned])
                  : callback(null, pinned.address, pinned.family),
              timeout: 10_000,
            },
          });
      const fetchImpl = agent.fetch ? agent.fetch.bind(agent) : undiciFetch;
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new Error("Upstream response timeout")),
        15_000,
      );
      let response;
      try {
        response = await fetchImpl(target, {
          method: currentMethod,
          headers: currentHeaders,
          signal: controller.signal,
          redirect: "manual",
          dispatcher: agent.fetch ? undefined : agent,
        });
      } catch (error) {
        signal?.removeEventListener("abort", abort);
        await agent.close?.();
        throw error;
      } finally {
        clearTimeout(timer);
      }
      if (REDIRECTS.has(response.status) && response.headers.get("location")) {
        response.body?.cancel().catch(() => {});
        await agent.close?.();
        signal?.removeEventListener("abort", abort);
        if (redirects === 5)
          throw Object.assign(new Error("Too many redirects"), {
            statusCode: 502,
          });
        const previousOrigin = target.origin;
        target = new URL(response.headers.get("location"), target);
        if (target.origin !== previousOrigin)
          for (const name of ["authorization", "cookie", "proxy-authorization"])
            currentHeaders.delete(name);
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            currentMethod === "POST")
        )
          currentMethod = "GET";
        continue;
      }
      Object.defineProperty(response, "finalUrl", {
        value: target.href,
        configurable: true,
      });
      const close = () => {
        signal?.removeEventListener("abort", abort);
        agent.close?.().catch?.(() => {});
      };
      if (response.body) {
        const reader = response.body.getReader();
        const stream = new ReadableStream({
          async pull(c) {
            try {
              const x = await reader.read();
              x.done ? (c.close(), close()) : c.enqueue(x.value);
            } catch (e) {
              c.error(e);
              close();
            }
          },
          async cancel(reason) {
            await reader.cancel(reason);
            close();
          },
        });
        const wrapped = new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        Object.defineProperty(wrapped, "finalUrl", { value: target.href });
        return wrapped;
      }
      signal?.removeEventListener("abort", abort);
      close();
      return response;
    }
  };
}

export const safeFetch = createSafeFetcher();
