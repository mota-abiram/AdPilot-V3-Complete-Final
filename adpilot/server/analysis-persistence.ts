import { db } from "./db";
import { analysisSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import fs from "fs";
import path from "path";

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");

// ─── In-memory analysis cache ────────────────────────────────────────
// Shared here so both routes.ts (reads) and this module (writes) can
// invalidate it without a circular dependency.
export const ANALYSIS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export const analysisCache = new Map<string, { data: any; ts: number }>();

export function getCacheKey(clientId: string, platform: string, cadence?: string) {
  return `${clientId}:${platform}:${cadence ?? "default"}`;
}

export function invalidateAnalysisCache(clientId: string, platform: string) {
  Array.from(analysisCache.keys()).forEach((key) => {
    if (key.startsWith(`${clientId}:${platform}:`)) analysisCache.delete(key);
  });
}

/**
 * Saves analysis data to both PostgreSQL (upsert) and the local filesystem.
 * Invalidates the in-memory cache so the next read reflects fresh data.
 */
export async function saveAnalysisSnapshot(clientId: string, platform: string, data: any) {
  try {
    // Upsert into DB — unique index on (client_id, platform) ensures one row per client/platform
    await db
      .insert(analysisSnapshots)
      .values({ clientId, platform, data, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [analysisSnapshots.clientId, analysisSnapshots.platform],
        set: { data, createdAt: new Date() },
      });

    // Sync to local file for backward compatibility
    const platformDir = platform === "google" ? "google" : "meta";
    const targetFile = path.join(DATA_BASE, "clients", clientId, platformDir, "analysis.json");
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetFile, JSON.stringify(data, null, 2));

    // Bust cache so the next dashboard load fetches fresh data
    invalidateAnalysisCache(clientId, platform);

    console.log(`[Analysis] Persisted ${platform} snapshot for client ${clientId} to DB & file.`);
  } catch (err) {
    console.error("[Analysis] Error persisting snapshot:", err);
  }
}

/**
 * Loads the latest analysis snapshot — DB first, then falls back to file.
 */
export async function loadAnalysisSnapshot(clientId: string, platform: string): Promise<any | null> {
  try {
    const [dbResult] = await db
      .select()
      .from(analysisSnapshots)
      .where(and(
        eq(analysisSnapshots.clientId, clientId),
        eq(analysisSnapshots.platform, platform),
      ))
      .orderBy(desc(analysisSnapshots.createdAt))
      .limit(1);

    if (dbResult?.data) return dbResult.data;

    // Fallback to file (local dev / legacy)
    const platformDir = platform === "google" ? "google" : "meta";
    const targetFile = path.join(DATA_BASE, "clients", clientId, platformDir, "analysis.json");
    if (fs.existsSync(targetFile)) {
      return JSON.parse(fs.readFileSync(targetFile, "utf-8"));
    }

    return null;
  } catch (err) {
    console.error(`[Analysis] Error loading snapshot for ${clientId}/${platform}:`, err);
    return null;
  }
}
