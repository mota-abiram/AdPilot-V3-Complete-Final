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
  // Render's external Postgres URL requires SSL but uses a self-signed cert chain
  // that fails strict validation. rejectUnauthorized: false is safe here because
  // the connection is still encrypted — we're only skipping CA chain verification.
  // If you switch to the internal URL (same-region), set this to true.
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
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
