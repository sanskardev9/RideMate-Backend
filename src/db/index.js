import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  // Supabase (and most hosted Postgres) terminate TLS with a certificate the
  // pooler cannot verify from here.
  ssl: env.databaseUrl.includes("supabase") ? { rejectUnauthorized: false } : false,
  max: env.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (error) => console.error("[db] idle client error", error));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

export async function transaction(run) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Opens a few connections up front. A cold connection to a hosted Postgres
 * costs seconds, and paying that during a rider's first request makes the app
 * feel broken.
 */
export async function warmPool(size = 3) {
  const clients = await Promise.all(
    Array.from({ length: Math.min(size, env.poolMax) }, () => pool.connect()),
  );
  clients.forEach((client) => client.release());
  return clients.length;
}

export async function verifyConnection() {
  const row = await one("select current_database() as database, now() as now");
  return row;
}

export const closePool = () => pool.end();
