/**
 * server.mjs -- the demo backend this project was missing: a REST
 * endpoint (matching the JD's "REST APIs" line item, which nothing
 * else in this repo demonstrated) plus a WebSocket stream, both
 * serving the same SYNTHETIC alarm feed described in alarmFeed.mjs.
 * There is still no real plant/SCADA system here -- this replaces
 * the frontend's client-only demo buttons with an actual
 * client<->server protocol, which is the part worth demonstrating.
 *
 * Deliberately built on Node's built-in `http` module rather than
 * Express: two routes don't need a framework, and it keeps this
 * repo's dependency footprint as lean on the backend as it already
 * is on the frontend (see README's bundle-size note).
 */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createAlarmFeed } from "./alarmFeed.mjs";

/** Creates (but does not start listening on) the HTTP + WebSocket
 * server, so tests can bind it to an ephemeral port. */
export function createApp(feed = createAlarmFeed()) {
  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/alarms/history") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ alarms: feed.getHistory(), synthetic: true }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (socket) => {
    // On connect, replay recent history so a client that joins
    // mid-stream isn't starting from a blank board.
    socket.send(JSON.stringify({ type: "history", alarms: feed.getHistory(), synthetic: true }));
    const unsubscribe = feed.subscribe((event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "raise", alarm: event, synthetic: true }));
      }
    });
    socket.on("close", unsubscribe);
  });

  return { httpServer, wss, feed };
}

// Only start listening when run directly (`node server/server.mjs`),
// not when imported by the test file.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { httpServer, feed } = createApp();
  const port = process.env.PORT ? Number(process.env.PORT) : 8787;
  feed.start();
  httpServer.listen(port, () => {
    console.log(`Synthetic alarm feed server listening on http://localhost:${port} (REST: /api/alarms/history, WS: /ws)`);
  });
}
