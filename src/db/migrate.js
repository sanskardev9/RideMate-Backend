import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, closePool } from "./index.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "sql");

/**
 * Applies every sql/*.sql file that has not run yet, in filename order.
 * Each file runs inside a transaction and is recorded in schema_migrations,
 * so running this repeatedly is safe.
 */
export async function migrate() {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const { rows } = await client.query("select filename from schema_migrations");
    const done = new Set(rows.map((row) => row.filename));
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

    for (const filename of files) {
      if (done.has(filename)) continue;
      const sql = await readFile(join(migrationsDir, filename), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations(filename) values($1)", [filename]);
        await client.query("commit");
        applied.push(filename);
        console.log(`[migrate] applied ${filename}`);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw new Error(`Migration ${filename} failed: ${error.message}`, { cause: error });
      }
    }
    if (!applied.length) console.log("[migrate] database already up to date");
  } finally {
    client.release();
  }
  return applied;
}

// `npm run migrate` runs this file directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => closePool())
    .catch(async (error) => {
      console.error(error);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
