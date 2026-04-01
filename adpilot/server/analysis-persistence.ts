import { db } from "./db";
import { analysisSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import fs from "fs";
import path from "path";

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");

/**
 * Saves analysis data to BOTH the PostgreSQL database (for persistence)
 * and the local filesystem (for backward compatibility with the existing code).
 */
export async function saveAnalysisSnapshot(clientId: string, platform: string, data: any) {
  try {
    // 1. Save to Database
    await db.insert(analysisSnapshots).values({
      clientId,
      platform, // "meta" or "google"
      data,
      createdAt: new Date(),
    });

    // 2. Clear old snapshots (keep last 5 for this client/platform to save space)
    // Optional: add a cleanup job later.

    // 3. Update the local file JSON for immediate access by existing functions
    const platformDir = platform === "google" ? "google" : "meta";
    const targetFile = path.join(DATA_BASE, clientId, platformDir, "analysis.json");
    
    // Ensure dir exists
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(targetFile, JSON.stringify(data, null, 2));

    console.log(`[Analysis] Persisted ${platform} snapshot for client ${clientId} to DB & File.`);
  } catch (err) {
    console.error(`[Analysis] Error persisting snapshot:`, err);
  }
}

/**
 * Loads the latest analysis snapshot. It tries the DB first, then falls back to File.
 */
export async function loadAnalysisSnapshot(clientId: string, platform: string): Promise<any | null> {
  try {
    // Try Database First (Most reliable on Render)
    const [dbResult] = await db
      .select()
      .from(analysisSnapshots)
      .where(and(
        eq(analysisSnapshots.clientId, clientId),
        eq(analysisSnapshots.platform, platform)
      ))
      .orderBy(desc(analysisSnapshots.createdAt))
      .limit(1);

    if (dbResult?.data) {
      return dbResult.data;
    }

    // Fallback to File (Local dev / Legacy)
    const platformDir = platform === "google" ? "google" : "meta";
    const targetFile = path.join(DATA_BASE, clientId, platformDir, "analysis.json");
    
    if (fs.existsSync(targetFile)) {
      return JSON.parse(fs.readFileSync(targetFile, "utf-8"));
    }

    return null;
  } catch (err) {
    console.error(`[Analysis] Error loading snapshot for ${clientId}:`, err);
    return null;
  }
}
