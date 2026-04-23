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
    ? (
        process.env.DATABASE_URL?.includes("dpg-") || 
        process.env.DATABASE_URL?.includes("localhost") || 
        process.env.DATABASE_URL?.includes("127.0.0.1") 
          ? false 
          : { rejectUnauthorized: false }
      )
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
    // Helper to run query and log results (idempotent wrapper)
    const safeQuery = async (label: string, sql: string) => {
      try {
        await client.query(sql);
      } catch (err: any) {
        // Ignore "already exists" errors (code 42P07 for tables, 23505 for unique violations in some contexts)
        if (err.code === "42P07" || err.code === "42710" || err.message.includes("already exists")) {
          // Silent skip
        } else {
          console.error(`[DB] ${label} migration failed:`, err.message);
        }
      }
    };

    // --- clients table ---
    await safeQuery("clients", `
      CREATE TABLE IF NOT EXISTS "clients" (
        "id" text PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "short_name" text NOT NULL,
        "project" text NOT NULL,
        "location" text NOT NULL,
        "target_locations" jsonb DEFAULT '[]'::jsonb,
        "platforms" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "targets" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        "created_by" text
      );
    `);

    // --- client_credentials table ---
    await safeQuery("client_credentials", `
      CREATE TABLE IF NOT EXISTS "client_credentials" (
        "client_id" text PRIMARY KEY NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "meta" jsonb,
        "google" jsonb,
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- analysis_snapshots table ---
    await safeQuery("analysis_snapshots", `
      CREATE TABLE IF NOT EXISTS "analysis_snapshots" (
        "id" serial PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "platform" text NOT NULL,
        "cadence" text NOT NULL DEFAULT 'twice_weekly',
        "data" jsonb NOT NULL,
        "created_at" timestamp DEFAULT now()
      );
    `);
    
    await safeQuery("analysis_snapshots_cadence_col", `
      ALTER TABLE "analysis_snapshots" ADD COLUMN IF NOT EXISTS "cadence" text NOT NULL DEFAULT 'twice_weekly';
    `);

    await safeQuery("drop_old_uq", `DROP INDEX IF EXISTS "uq_analysis_client_platform";`);
    await safeQuery("analysis_snapshots_uq_index", `
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_analysis_client_platform_cadence"
      ON "analysis_snapshots" USING btree ("client_id","platform","cadence");
    `);

    // --- performance_alerts table ---
    await safeQuery("performance_alerts", `
      CREATE TABLE IF NOT EXISTS "performance_alerts" (
        "id" serial PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "platform" text NOT NULL,
        "type" text NOT NULL,
        "entity_id" text,
        "entity_name" text,
        "metric" text,
        "severity" text NOT NULL,
        "message" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- ai_configs table ---
    await safeQuery("ai_configs", `
      CREATE TABLE IF NOT EXISTS "ai_configs" (
        "id" serial PRIMARY KEY NOT NULL,
        "openapi_api_key" text DEFAULT '' NOT NULL,
        "gemini_model" text DEFAULT 'gemini-1.5-flash' NOT NULL,
        "gemini_image_model" text DEFAULT 'gemini-2.0-flash-preview-image-generation' NOT NULL,
        "groq_api_key" text DEFAULT '' NOT NULL,
        "groq_model" text DEFAULT 'llama-3.3-70b-versatile' NOT NULL,
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- creative_hubs table ---
    await safeQuery("creative_hubs", `
      CREATE TABLE IF NOT EXISTS "creative_hubs" (
        "client_id" text PRIMARY KEY NOT NULL,
        "setup" jsonb,
        "threads" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- action_logs table ---
    await safeQuery("action_logs", `
      CREATE TABLE IF NOT EXISTS "action_logs" (
        "id" serial PRIMARY KEY NOT NULL,
        "recommendation_id" text NOT NULL,
        "client_id" text NOT NULL,
        "platform" text NOT NULL,
        "action" text NOT NULL,
        "strategic_call" text NOT NULL,
        "created_at" timestamp DEFAULT now()
      );
    `);

    // --- users table ---
    await safeQuery("users", `
      CREATE TABLE IF NOT EXISTS "users" (
        "id" text PRIMARY KEY NOT NULL,
        "email" text NOT NULL UNIQUE,
        "name" text NOT NULL,
        "password_hash" text NOT NULL,
        "role" text DEFAULT 'member' NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "last_login_at" timestamp,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- execution_logs table ---
    await safeQuery("execution_logs", `
      CREATE TABLE IF NOT EXISTS "execution_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "platform" text NOT NULL,
        "intent" text NOT NULL,
        "command" text NOT NULL,
        "action_type" text NOT NULL,
        "campaign_ids" jsonb NOT NULL,
        "rationale" text,
        "safety_warnings" text,
        "success_count" integer DEFAULT 0 NOT NULL,
        "failure_count" integer DEFAULT 0 NOT NULL,
        "requested_by" text NOT NULL,
        "created_at" timestamp DEFAULT now()
      );
    `);

    // --- execution_outcomes table ---
    await safeQuery("execution_outcomes", `
      CREATE TABLE IF NOT EXISTS "execution_outcomes" (
        "id" text PRIMARY KEY NOT NULL,
        "log_id" text NOT NULL,
        "client_id" text NOT NULL,
        "metric_type" text NOT NULL,
        "pre_value" numeric NOT NULL,
        "post_value" numeric,
        "recorded_at" timestamp DEFAULT now(),
        "resolved_at" timestamp
      );
    `);

    // --- execution_learnings table ---
    await safeQuery("execution_learnings", `
      CREATE TABLE IF NOT EXISTS "execution_learnings" (
        "id" serial PRIMARY KEY NOT NULL,
        "client_id" text NOT NULL,
        "platform" text NOT NULL,
        "entity_id" text NOT NULL,
        "entity_name" text NOT NULL,
        "entity_type" text NOT NULL,
        "action" text NOT NULL,
        "executed_at" timestamp DEFAULT now(),
        "strategic_rationale" text,
        "before_metrics" jsonb NOT NULL,
        "primary_metrics" jsonb,
        "extended_metrics" jsonb,
        "outcome" text DEFAULT 'PENDING',
        "ai_analysis" jsonb,
        "estimated_impact" numeric,
        "status" text DEFAULT 'PENDING_PRIMARY',
        "chronic_flag" boolean DEFAULT false,
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- bidding_recommendations table ---
    await safeQuery("bidding_recommendations", `
      CREATE TABLE IF NOT EXISTS "bidding_recommendations" (
        "id" serial PRIMARY KEY NOT NULL,
        "campaign_id" text NOT NULL,
        "ad_group_id" text,
        "client_id" text NOT NULL,
        "campaign_name" text NOT NULL,
        "ad_group_name" text,
        "current_strategy" text NOT NULL,
        "recommended_strategy" text NOT NULL,
        "current_bid_limit" numeric,
        "recommended_bid_limit" numeric,
        "current_tcpa" numeric,
        "recommended_tcpa" numeric,
        "avg_cpc" numeric NOT NULL,
        "ctr" numeric NOT NULL,
        "cvr" numeric NOT NULL,
        "cost_per_conversion" numeric NOT NULL,
        "search_impression_share" numeric,
        "lost_is_rank" numeric,
        "lost_is_budget" numeric,
        "conversions" numeric NOT NULL,
        "clicks" numeric NOT NULL,
        "confidence_level" text NOT NULL,
        "reason" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "strategic_rationale" text,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now()
      );
    `);

    // --- session table ---
    await safeQuery("session", `
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" text PRIMARY KEY NOT NULL,
        "sess" jsonb NOT NULL,
        "expire" timestamp(6) NOT NULL
      );
    `);

    console.log("[DB] Migrations applied (bootstrap)");
  } catch (err) {
    console.error("[DB] Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
