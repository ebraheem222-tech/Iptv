import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MediaProxy } from "../server/media.js";

test("long streams release every backpressure listener after each drain", async () => {
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index++ === 30) controller.close();
      else controller.enqueue(new Uint8Array([42]));
    },
  });
  const proxy = new MediaProxy({
    getSession: () => ({ id: "session" }),
    fetcher: async () =>
      new Response(body, { headers: { "content-type": "video/mp4" } }),
  });
  const url = proxy.issue("https://provider.example/video.mp4", "session");
  const req = Object.assign(new EventEmitter(), {
    headers: {},
    params: { ticket: url.split("/")[2] },
  });
  const res = Object.assign(new EventEmitter(), {
    setHeader() {},
    write() {
      setImmediate(() => res.emit("drain"));
      return false;
    },
    end() {
      this.writableEnded = true;
    },
  });
  await proxy.handle(req, res);
  assert.equal(req.listenerCount("aborted"), 0);
  assert.equal(res.listenerCount("close"), 0);
  assert.equal(res.listenerCount("drain"), 0);
});
