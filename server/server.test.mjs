// @vitest-environment node
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./server.mjs";
import { createAlarmFeed } from "./alarmFeed.mjs";

let app;
let baseUrl;

beforeEach(async () => {
  app = createApp(createAlarmFeed());
  await new Promise((resolve) => app.httpServer.listen(0, resolve));
  const { port } = app.httpServer.address();
  baseUrl = `http://localhost:${port}`;
});

afterEach(async () => {
  app.wss.close();
  await new Promise((resolve) => app.httpServer.close(resolve));
});

describe("REST endpoints", () => {
  it("GET /health reports ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/alarms/history returns the synthetic feed's history, clearly labeled synthetic", async () => {
    app.feed.raiseRandom();
    app.feed.raiseRandom();

    const res = await fetch(`${baseUrl}/api/alarms/history`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synthetic).toBe(true);
    expect(body.alarms).toHaveLength(2);
    expect(body.alarms[0]).toHaveProperty("tag");
    expect(body.alarms[0]).toHaveProperty("priority");
  });

  it("an unknown route returns 404", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});

describe("WebSocket feed", () => {
  it("sends a history snapshot immediately on connect", async () => {
    app.feed.raiseRandom();
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/ws`);

    const firstMessage = await new Promise((resolve, reject) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
    });

    expect(firstMessage.type).toBe("history");
    expect(firstMessage.synthetic).toBe(true);
    expect(firstMessage.alarms).toHaveLength(1);
    ws.close();
  });

  it("broadcasts a new synthetic raise to a connected client", async () => {
    // Attach the first "message" listener synchronously, right after
    // construction, before any await -- waiting on a separate "open"
    // promise first would leave a gap where the server's immediate
    // history snapshot could arrive and fire with no listener yet
    // attached, losing it for good (Node's EventEmitter doesn't queue
    // events for listeners that show up late).
    const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/ws`);
    const historySnapshot = await new Promise((resolve, reject) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
    });
    expect(historySnapshot.type).toBe("history");

    // Only now, with the prior message already consumed, is it safe
    // to attach a listener for the *next* message and trigger it --
    // the broadcast can't exist before raiseRandom() runs, and the
    // listener is attached before that call.
    const nextMessage = new Promise((resolve, reject) => {
      ws.once("message", (data) => resolve(JSON.parse(data.toString())));
      ws.once("error", reject);
    });
    app.feed.raiseRandom();

    const message = await nextMessage;
    expect(message.type).toBe("raise");
    expect(message.synthetic).toBe(true);
    expect(message.alarm).toHaveProperty("tag");
    ws.close();
  });
});
