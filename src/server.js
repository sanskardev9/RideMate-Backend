import { createServer } from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { attachRealtime } from "./realtime/index.js";
import { closePool, verifyConnection, warmPool } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { startRideSweeper } from "./jobs/index.js";

const server = createServer(createApp());
const wss = attachRealtime(server);

async function start() {
  const { database } = await verifyConnection();
  console.log(`[db] connected to ${database}`);
  if (process.env.AUTO_MIGRATE !== "false") await migrate();
  console.log(`[db] warmed ${await warmPool()} pooled connections`);

  startRideSweeper();
  console.log(
    `[cors] allowing ${env.clientOrigins.length ? env.clientOrigins.join(", ") : "any origin"}`,
  );
  server.listen(env.port, () =>
    console.log(`RideMate API listening on :${env.port} (${env.nodeEnv})`),
  );
}

async function shutdown(signal) {
  console.log(`\n[server] ${signal} received, shutting down`);
  wss.close();
  for (const ws of wss.clients) ws.terminate();
  server.close(async () => {
    await closePool().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(signal));

start().catch(async (error) => {
  console.error("[server] failed to start", error);
  await closePool().catch(() => {});
  process.exit(1);
});
