import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { authRoutes } from "./routes/auth.routes.js";
import { groupRoutes } from "./routes/groups.routes.js";
import { rideRoutes } from "./routes/rides.routes.js";
import { sosRoutes } from "./routes/sos.routes.js";
import { verifyConnection } from "./db/index.js";
import { connectionCount } from "./realtime/hub.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: env.clientOrigins.length ? env.clientOrigins : true }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/", (_req, res) => res.json({ message: "Welcome to the RideMate API" }));

  app.get("/health", async (_req, res) => {
    try {
      await verifyConnection();
      res.json({ ok: true, database: "up", connections: connectionCount() });
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
