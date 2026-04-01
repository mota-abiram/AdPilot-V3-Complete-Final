import cron from "node-cron";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { log } from "./index";
import { saveAnalysisSnapshot } from "./analysis-persistence";
import { db } from "./db";
import { clients as clientTable } from "@shared/schema";

const execFileAsync = promisify(execFile);

const ADS_AGENT_DIR = path.resolve(import.meta.dirname, "../../ads_agent");
const DATA_BASE = path.resolve(ADS_AGENT_DIR, "data");
const STATUS_FILE = path.join(DATA_BASE, "scheduler_status.json");
const PLATFORM_SYNC_STATE_FILE = path.join(DATA_BASE, "platform_sync_state.json");

export type PlatformSyncStatus = "idle" | "loading" | "success" | "failed";

export interface PlatformSyncState {
  last_synced_at: string | null;
  last_successful_fetch: string | null;
  sync_status: PlatformSyncStatus;
}

type PlatformSyncStore = Record<string, Record<string, PlatformSyncState>>;

export interface SchedulerStatus {
  lastRun: string | null;
  lastRunSuccess: boolean;
  lastRunDuration: number;
  lastError: string | null;
  nextRun: string | null;
  isRunning: boolean;
  runHistory: Array<{
    timestamp: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;
}

let schedulerStatus: SchedulerStatus = {
  lastRun: null,
  lastRunSuccess: false,
  lastRunDuration: 0,
  lastError: null,
  nextRun: null,
  isRunning: false,
  runHistory: [],
};

let platformSyncState: PlatformSyncStore = {};

// SSE clients for live updates
const sseClients: Set<import("http").ServerResponse> = new Set();

export function addSSEClient(res: import("http").ServerResponse) {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

export function broadcastSSE(event: string, data: any) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  });
}

function loadStatus(): void {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      schedulerStatus = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
    }
  } catch {
    // use defaults
  }
}

function loadPlatformSyncState(): void {
  try {
    if (fs.existsSync(PLATFORM_SYNC_STATE_FILE)) {
      platformSyncState = JSON.parse(fs.readFileSync(PLATFORM_SYNC_STATE_FILE, "utf-8"));
    }
  } catch {
    platformSyncState = {};
  }
}

function saveStatus(): void {
  const dir = path.dirname(STATUS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(schedulerStatus, null, 2));
}

function savePlatformSyncState(): void {
  const dir = path.dirname(PLATFORM_SYNC_STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PLATFORM_SYNC_STATE_FILE, JSON.stringify(platformSyncState, null, 2));
}

export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function extractAnalysisTimestamp(payload: any): string | null {
  return (
    normalizeTimestamp(payload?.last_successful_fetch) ||
    normalizeTimestamp(payload?.generated_at) ||
    normalizeTimestamp(payload?.timestamp) ||
    normalizeTimestamp(payload?.run_metadata?.timestamp)
  );
}

function getLatestAnalysisTimestamp(clientId: string, platform: string): string | null {
  const platformDir = path.join(DATA_BASE, "clients", clientId, platform);
  const candidateFiles = fs.existsSync(platformDir)
    ? fs.readdirSync(platformDir)
        .filter((name) => /^analysis(?:_.+)?\.json$/.test(name))
        .map((name) => path.join(platformDir, name))
    : [];

  const timestamps = candidateFiles
    .map((filePath) => {
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return extractAnalysisTimestamp(payload);
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return timestamps[0] || null;
}

function getDefaultPlatformSyncState(clientId: string, platform: string): PlatformSyncState {
  const inferredFetch = getLatestAnalysisTimestamp(clientId, platform);
  return {
    last_synced_at: inferredFetch,
    last_successful_fetch: inferredFetch,
    sync_status: inferredFetch ? "success" : "idle",
  };
}

function setPlatformSyncState(clientId: string, platform: string, next: Partial<PlatformSyncState>): PlatformSyncState {
  const current = getPlatformSyncState(clientId, platform);
  const updated: PlatformSyncState = {
    ...current,
    ...next,
  };

  if (!platformSyncState[clientId]) {
    platformSyncState[clientId] = {};
  }
  platformSyncState[clientId][platform] = updated;
  savePlatformSyncState();
  return updated;
}

export function getPlatformSyncState(clientId: string, platform: string): PlatformSyncState {
  const stored = platformSyncState[clientId]?.[platform];
  if (stored) {
    const inferredFetch = getLatestAnalysisTimestamp(clientId, platform);
    return {
      last_synced_at: stored.last_synced_at || inferredFetch,
      last_successful_fetch: stored.last_successful_fetch || inferredFetch,
      sync_status: stored.sync_status || (inferredFetch ? "success" : "idle"),
    };
  }
  return getDefaultPlatformSyncState(clientId, platform);
}

function loadEnabledClients(platform: string): string[] {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(DATA_BASE, "clients_registry.json"), "utf-8")) as any[];
    return registry
      .filter((client) => client.platforms?.[platform]?.enabled)
      .map((client) => client.id);
  } catch {
    return [];
  }
}

// Load clients registry and credentials for multi-client runs
function loadClientsWithCredentials(): Array<{ id: string; googleCreds?: Record<string, string> }> {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(DATA_BASE, "clients_registry.json"), "utf-8")) as any[];
    const credsPath = path.join(DATA_BASE, "clients_credentials.json");
    const credsArr: any[] = fs.existsSync(credsPath)
      ? JSON.parse(fs.readFileSync(credsPath, "utf-8"))
      : [];
    const credsMap: Record<string, any> = Object.fromEntries(credsArr.map((c) => [c.clientId, c]));

    return registry
      .filter((c) => c.platforms?.google?.enabled)
      .map((c) => {
        const g = credsMap[c.id]?.google;
        const hasValidClientGoogleCreds = Boolean(
          g?.clientId &&
          g?.clientSecret &&
          g?.refreshToken &&
          !String(g.clientId).startsWith("YOUR_") &&
          !String(g.clientSecret).startsWith("YOUR_") &&
          !String(g.refreshToken).startsWith("YOUR_")
        );

        const mergedGoogleCreds = hasValidClientGoogleCreds ? {
          GOOGLE_CLIENT_ID: g.clientId || process.env.GOOGLE_CLIENT_ID || "",
          GOOGLE_CLIENT_SECRET: g.clientSecret || process.env.GOOGLE_CLIENT_SECRET || "",
          GOOGLE_REFRESH_TOKEN: g.refreshToken || process.env.GOOGLE_REFRESH_TOKEN || "",
          GOOGLE_DEVELOPER_TOKEN: g.developerToken || process.env.GOOGLE_DEVELOPER_TOKEN || "",
          GOOGLE_MCC_ID: g.mccId || process.env.GOOGLE_MCC_ID || "",
          GOOGLE_CUSTOMER_ID: g.customerId || process.env.GOOGLE_CUSTOMER_ID || "",
        } : (process.env.GOOGLE_REFRESH_TOKEN ? {
          GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
          GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
          GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || "",
          GOOGLE_DEVELOPER_TOKEN: process.env.GOOGLE_DEVELOPER_TOKEN || "",
          GOOGLE_MCC_ID: process.env.GOOGLE_MCC_ID || "",
          GOOGLE_CUSTOMER_ID: process.env.GOOGLE_CUSTOMER_ID || "",
        } : undefined);

        return {
          id: c.id,
          googleCreds: mergedGoogleCreds,
        };
      });
  } catch {
    return [];
  }
}

async function runAgent(): Promise<void> {
  if (schedulerStatus.isRunning) {
    log("Scheduler: Agent already running, skipping", "scheduler");
    return;
  }

  schedulerStatus.isRunning = true;
  const startTime = Date.now();
  broadcastSSE("agent-run-started", { timestamp: new Date().toISOString() });

  try {
    log("Scheduler: Starting agent run...", "scheduler");

    const metaAgent = path.join(ADS_AGENT_DIR, "meta_ads_agent_v2.py");
    const googleAgent = path.join(ADS_AGENT_DIR, "google_ads_agent_v2.py");
    const metaClients = loadEnabledClients("meta");
    const clients = loadClientsWithCredentials();

    if (fs.existsSync(metaAgent)) {
      log("Scheduler: Running Meta Ads Agent v2...", "scheduler");
      const syncStartedAt = new Date().toISOString();
      metaClients.forEach((clientId) => {
        setPlatformSyncState(clientId, "meta", {
          last_synced_at: syncStartedAt,
          sync_status: "loading",
        });
      });
      try {
        await execFileAsync("python3", [metaAgent], {
          cwd: ADS_AGENT_DIR,
          timeout: 600000,
        });
      } catch (error) {
        metaClients.forEach((clientId) => {
          setPlatformSyncState(clientId, "meta", {
            last_synced_at: new Date().toISOString(),
            sync_status: "failed",
          });
        });
        throw error;
      }
      const syncCompletedAt = new Date().toISOString();
      for (const clientId of metaClients) {
        setPlatformSyncState(clientId, "meta", {
          last_synced_at: syncCompletedAt,
          last_successful_fetch: getLatestAnalysisTimestamp(clientId, "meta"),
          sync_status: "success",
        });

        // PERSIST TO DB: Capture the newly generated JSON file and push to Postgres
        const metaPath = path.join(ADS_AGENT_DIR, "data", clientId, "meta", "analysis.json");
        if (fs.existsSync(metaPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            await saveAnalysisSnapshot(clientId, "meta", data);
          } catch (e) {
            log(`[DB Push] Failed to persist Meta snapshot for ${clientId}: ${e}`, "scheduler");
          }
        }
      }
    }

    if (fs.existsSync(googleAgent)) {
      const googleClients = clients.filter((c) => c.googleCreds?.GOOGLE_REFRESH_TOKEN);
      if (googleClients.length === 0) {
        log("Scheduler: No Google clients with credentials configured — skipping Google agent", "scheduler");
      }
      for (const client of googleClients) {
        log(`Scheduler: Running Google Ads Agent for client '${client.id}'...`, "scheduler");
        const syncStartedAt = new Date().toISOString();
        setPlatformSyncState(client.id, "google", {
          last_synced_at: syncStartedAt,
          sync_status: "loading",
        });
        try {
          await execFileAsync("python3", [googleAgent, "--client", client.id, "--multi-cadence"], {
            cwd: ADS_AGENT_DIR,
            timeout: 600000,
            env: { ...process.env, ...client.googleCreds },
          });
        } catch (error) {
          setPlatformSyncState(client.id, "google", {
            last_synced_at: new Date().toISOString(),
            sync_status: "failed",
          });
          throw error;
        }
        setPlatformSyncState(client.id, "google", {
          last_synced_at: new Date().toISOString(),
          last_successful_fetch: getLatestAnalysisTimestamp(client.id, "google"),
          sync_status: "success",
        });

        // PERSIST TO DB: Capture the newly generated JSON file and push to Postgres
        const googlePath = path.join(ADS_AGENT_DIR, "data", client.id, "google", "analysis.json");
        if (fs.existsSync(googlePath)) {
          try {
            const data = JSON.parse(fs.readFileSync(googlePath, "utf-8"));
            await saveAnalysisSnapshot(client.id, "google", data);
          } catch (e) {
            log(`[DB Push] Failed to persist Google snapshot for ${client.id}: ${e}`, "scheduler");
          }
        }
        log(`Scheduler: Google agent completed for client '${client.id}'`, "scheduler");
      }
    }

    const duration = Date.now() - startTime;
    schedulerStatus.lastRun = new Date().toISOString();
    schedulerStatus.lastRunSuccess = true;
    schedulerStatus.lastRunDuration = duration;
    schedulerStatus.lastError = null;
    schedulerStatus.isRunning = false;

    schedulerStatus.runHistory.unshift({
      timestamp: schedulerStatus.lastRun,
      success: true,
      duration,
    });
    // Keep last 30 runs
    if (schedulerStatus.runHistory.length > 30) {
      schedulerStatus.runHistory = schedulerStatus.runHistory.slice(0, 30);
    }

    saveStatus();
    log(`Scheduler: Agent run completed in ${(duration / 1000).toFixed(1)}s`, "scheduler");

    // Notify all connected clients to refresh data
    broadcastSSE("data-refreshed", {
      timestamp: new Date().toISOString(),
      duration,
    });
  } catch (err: any) {
    const errorMessage = err.message || "Unknown error";
    const duration = Date.now() - startTime;
    schedulerStatus.lastRun = new Date().toISOString();
    schedulerStatus.lastRunSuccess = false;
    schedulerStatus.lastRunDuration = duration;
    schedulerStatus.lastError = errorMessage;
    schedulerStatus.isRunning = false;

    schedulerStatus.runHistory.unshift({
      timestamp: schedulerStatus.lastRun,
      success: false,
      duration,
      error: errorMessage,
    });
    if (schedulerStatus.runHistory.length > 30) {
      schedulerStatus.runHistory = schedulerStatus.runHistory.slice(0, 30);
    }

    saveStatus();
    log(`Scheduler: Agent run failed: ${errorMessage}`, "scheduler");

    broadcastSSE("agent-run-failed", {
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }
}

export function triggerManualRun(): void {
  runAgent().catch((err) => log(`Manual run error: ${err.message}`, "scheduler"));
}

export function initScheduler(): void {
  loadStatus();
  loadPlatformSyncState();

  // Schedule daily at 9:00 AM IST (03:30 UTC)
  // IST is UTC+5:30, so 9:00 AM IST = 3:30 AM UTC
  const task = cron.schedule("30 3 * * *", () => {
    log("Scheduler: 9 AM IST trigger — starting agent run", "scheduler");
    runAgent();
  }, {
    timezone: "Asia/Kolkata",
  });

  // Compute next run time
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(9, 0, 0, 0);
  // Adjust for IST — but cron handles timezone, so we store the display time
  if (now.getHours() >= 9 || (now.getHours() === 9 && now.getMinutes() >= 0)) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  schedulerStatus.nextRun = nextRun.toISOString();
  saveStatus();

  log("Scheduler: Initialized — daily run at 9:00 AM IST", "scheduler");
}
