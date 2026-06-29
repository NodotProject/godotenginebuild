import type { Response } from "express";
import { config } from "../config.js";
import type { SseSink } from "../build/logHub.js";

let activeConnections = 0;

/** True when the server is already at its SSE connection cap. */
export function sseConnectionsAtCapacity(): boolean {
  return activeConnections >= config.maxSseConnections;
}

/** Open an SSE stream on an Express response and return a sink. */
export function openSse(res: Response): SseSink {
  activeConnections++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeConnections--;
  };
  res.on("close", release);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 25_000);
  heartbeat.unref?.();

  let closed = false;
  return {
    send(event, data, id) {
      if (closed || res.writableEnded) return;
      if (id !== undefined) res.write(`id: ${id}\n`);
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
      release();
    },
  };
}
