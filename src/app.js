import express from "express";
import cors from "cors";
import { env, normalizeOrigin } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { authRoutes } from "./routes/auth.routes.js";
import { groupRoutes } from "./routes/groups.routes.js";
import { rideRoutes } from "./routes/rides.routes.js";
import { sosRoutes } from "./routes/sos.routes.js";
import { verifyConnection } from "./db/index.js";
import { connectionCount } from "./realtime/hub.js";

/** `https://*.vercel.app` style entries, so preview deployments keep working. */
const matches = (pattern, origin) =>
  pattern.includes("*")
    ? new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(origin)
    : pattern === origin;

export function allowOrigin(origin, callback) {
  // No Origin header at all: curl, health checks, server-to-server.
  if (!origin) return callback(null, true);
  // No allow-list configured: permissive, which suits local development.
  if (!env.clientOrigins.length) return callback(null, true);

  const candidate = normalizeOrigin(origin);
  const allowed = env.clientOrigins.some((entry) => matches(entry, candidate));
  if (!allowed)
    console.warn(
      `[cors] blocked "${origin}". CLIENT_ORIGIN allows: ${env.clientOrigins.join(", ")}`,
    );
  callback(null, allowed);
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: allowOrigin }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/", (_req, res) => res.json({ message: "Welcome to the RideMate API" }));

  app.get("/health", async (_req, res) => {
    try {
      await verifyConnection();
      res.json({
        ok: true,
        database: "up",
        connections: connectionCount(),
        // Surfaced so a misconfigured deployment can be diagnosed without
        // shell access to the host.
        allowedOrigins: env.clientOrigins.length ? env.clientOrigins : ["*"],
      });
    } catch {
      res.status(503).json({ ok: false, database: "down" });
    }
  });

  app.use("/auth", authRoutes);
  app.use("/groups", groupRoutes);
  app.use("/rides", rideRoutes);
  app.use("/sos", sosRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
