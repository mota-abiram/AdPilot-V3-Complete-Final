import { db } from "../server/db";
import { creativeHubs, analysisSnapshots, clients } from "../shared/schema";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const DATA_BASE = path.resolve(__dirname, "../../../ads_agent/data");

async function syncLocalToDb() {
  console.log("🚀 Starting One-Time Data Sync to PostgreSQL...");

  // 1. Sync Clients Registry
  console.log("  Syncing Clients...");
  const registryFile = path.join(DATA_BASE, "clients_registry.json");
  if (fs.existsSync(registryFile)) {
    const clientsData = JSON.parse(fs.readFileSync(registryFile, "utf-8"));
    for (const c of clientsData) {
      await db.insert(clients).values({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        project: c.project,
        location: c.location,
        targetLocations: c.targetLocations || [],
        platforms: c.platforms || {},
        targets: c.targets || {},
      }).onConflictDoUpdate({ target: clients.id, set: { updatedAt: new Date() } });
    }
  }

  // 2. Sync Creative Hub (SOPs & Threads)
  console.log("  Syncing Creative Hub (SOPs & Threads)...");
  const hubFile = path.join(DATA_BASE, "creative_hub.json");
  if (fs.existsSync(hubFile)) {
    const hubData = JSON.parse(fs.readFileSync(hubFile, "utf-8"));
    for (const [clientId, data] of Object.entries(hubData)) {
      await db.insert(creativeHubs).values({
        clientId,
        setup: (data as any).setup || null,
        threads: (data as any).threads || [],
      }).onConflictDoUpdate({ target: creativeHubs.clientId, set: { updatedAt: new Date() } });
    }
  }

  // 3. Sync Latest Analysis (Dashboard Data)
  console.log("  Syncing Dashboard Snapshots...");
  if (fs.existsSync(DATA_BASE)) {
    const clientDirs = fs.readdirSync(DATA_BASE).filter(f => fs.lstatSync(path.join(DATA_BASE, f)).isDirectory());
    
    for (const clientId of clientDirs) {
      const metaPath = path.join(DATA_BASE, clientId, "meta", "analysis.json");
      if (fs.existsSync(metaPath)) {
        const data = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        await db.insert(analysisSnapshots).values({
          clientId,
          platform: "meta",
          data,
        });
      }

      const googlePath = path.join(DATA_BASE, clientId, "google", "analysis.json");
      if (fs.existsSync(googlePath)) {
        const data = JSON.parse(fs.readFileSync(googlePath, "utf-8"));
        await db.insert(analysisSnapshots).values({
          clientId,
          platform: "google",
          data,
        });
      }
    }
  }

  console.log("✅ Sync Complete! Your database is now populated with all local data.");
  process.exit(0);
}

syncLocalToDb().catch(err => {
  console.error("❌ Sync Failed:", err);
  process.exit(1);
});
