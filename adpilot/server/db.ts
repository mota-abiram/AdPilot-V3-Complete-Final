import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema.js";
import dotenv from "dotenv";
import path from "path";

const __root = import.meta.dirname || process.cwd();
dotenv.config({ path: path.resolve(__root, "../.env") });

if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL must be set in production");
  }
  console.warn("DATABASE_URL is missing! Persistence will be limited to JSON files.");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL configuration for Render Postgres:
  // - Internal URL (postgres://dpg-xxxxx-a): Set ssl: false (encrypted on Render's network)
  // - External URL (postgresql://...postgres.render.com): Set ssl: true (but only if using proper cert validation)
  // For production, use the internal URL when app and DB are in the same region.
  // The DATABASE_URL should start with "postgres://dpg-" for internal (no SSL needed)
  // or "postgresql://" for external (requires SSL, handled by connection string if suffixed with ?sslmode=require).
  ssl: process.env.NODE_ENV === "production"
    ? (process.env.DATABASE_URL?.includes("dpg-") ? false : { rejectUnauthorized: false })
    : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

// Graceful shutdown — close pool when the process exits
process.once("SIGTERM", () => pool.end());
process.once("SIGINT", () => pool.end());

export const db = drizzle(pool, { schema });

export async function runMigrations() {
  if (!process.env.DATABASE_URL) return;
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by text;
    `);
    console.log("[DB] Migrations applied");
  } catch (err) {
    console.error("[DB] Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
