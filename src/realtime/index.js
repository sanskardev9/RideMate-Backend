import { WebSocketServer } from "ws";
import { verifyToken } from "../services/auth.service.js";
import { listGroupIds } from "../services/groups.service.js";
import { ApiError } from "../middleware/errors.js";
import { handleEvent } from "./handlers.js";
import {
  addClient,
  broadcastToGroup,
  clientFor,
  flushPending,
  removeClient,
  send,
} from "./hub.js";

const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;

const presence = (client, online) => ({
  type: "presence",
  userId: client.rider.id,
  name: client.rider.name,
  online,
  timestamp: new Date().toISOString(),
});

export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_MESSAGE_BYTES });

  wss.on("connection", (ws, req) => {
    let client;
    try {
      const token = new URL(req.url, "http://localhost").searchParams.get("token");
      if (!token) throw new Error("token missing");
      const claims = verifyToken(token);
      // Register synchronously. Loading the rider's groups needs a database
      // round trip, and anything the client sends before that resolves would
      // otherwise be dropped without a trace.
      client = addClient(ws, { id: claims.sub, name: claims.name, email: claims.email }, []);
    } catch {
      ws.close(1008, "Unauthorized");
      return;
    }

    send(ws, { type: "connected", userId: client.rider.id });

    // Until this resolves, handlers fall back to a membership check per event.
    listGroupIds(client.rider.id)
      .then((groupIds) => {
        if (!clientFor(ws)) return;
        for (const groupId of groupIds) client.groupIds.add(groupId);
        flushPending(client);
        send(ws, { type: "groups_ready", groupIds: [...client.groupIds] });
        for (const groupId of client.groupIds)
          broadcastToGroup(groupId, presence(client, true), ws);
      })
      .catch((error) => {
        console.error("[ws] could not load groups", error);
        flushPending(client); // Stop queueing; the client can still refresh over REST.
      });

    ws.on("pong", () => {
      const current = clientFor(ws);
      if (current) current.alive = true;
    });

    ws.on("message", async (raw) => {
      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return void send(ws, { type: "error", detail: "Malformed event" });
      }
      try {
        const current = clientFor(ws);
        if (current) await handleEvent(current, event);
      } catch (error) {
        const detail = error instanceof ApiError ? error.detail : "Could not process that event";
        if (!(error instanceof ApiError)) console.error("[ws] event failed", event?.type, error);
        send(ws, { type: "error", event: event?.type ?? null, detail });
      }
    });

    ws.on("close", () => {
      const current = clientFor(ws);
      removeClient(ws);
      if (!current) return;
      for (const groupId of current.groupIds)
        broadcastToGroup(groupId, presence(current, false));
    });
  });

  // Drops connections that stopped answering, so presence stays truthful.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const current = clientFor(ws);
      if (current && !current.alive) {
        ws.terminate();
        continue;
      }
      if (current) current.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on("close", () => clearInterval(heartbeat));
  return wss;
}
