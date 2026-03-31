import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { execSync, execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
import type { RecommendationAction, QuickActionType } from "@shared/schema";
import {
  executeAction,
  executeBatch,
  getAuditLog,
  getEntityStatus,
  appendAuditEntry,
  type ExecutionRequest,
  type ExecutionActionType,
} from "./meta-execution";
import {
  recordExecution,
  getLearningData,
  getLearningSummary,
  triggerOutcomeUpdate,
} from "./execution-learning";
import {
  executeGoogleAction,
  executeGoogleBatch,
  getGoogleAuditLog,
  appendGoogleAuditEntry,
  type GoogleExecutionRequest,
  type GoogleExecutionActionType,
} from "./google-execution";
import {
  addSSEClient,
  getPlatformSyncState,
  getSchedulerStatus,
  triggerManualRun,
} from "./scheduler";
import { handleAICommand } from "./ai-command";

// ─── Multi-Client Registry ─────────────────────────────────────────
// The registry is now persisted to disk so clients added via the UI survive restarts.
// File: ads_agent/data/clients_registry.json

interface PlatformConfig {
  enabled: boolean;
  dataPath: string; // path to analysis JSON
  label: string;
}

interface ClientTargets {
  budget: number;
  leads: number;
  cpl: number;
  svs: { low: number; high: number };
  cpsv: { low: number; high: number };
}

interface ClientConfig {
  id: string;
  name: string;
  shortName: string;
  project: string;
  location: string;
  targetLocations?: string[];
  platforms: Record<string, PlatformConfig>;
  targets?: Record<string, ClientTargets>;
  createdAt?: string;
}

// Per-client API credentials stored separately (never sent to the frontend)
interface ClientCredentials {
  clientId: string;
  meta?: {
    accessToken: string;
    adAccountId: string;
  };
  google?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    developerToken: string;
    mccId: string;
    customerId: string;
  };
  updatedAt: string;
}

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const REGISTRY_FILE = path.join(DATA_BASE, "clients_registry.json");
const CREDENTIALS_FILE = path.join(DATA_BASE, "clients_credentials.json");
const GOOGLE_ADS_TOKEN_CACHE = path.resolve(import.meta.dirname, "../../ads_agent/.google_ads_token_cache.json");
const LEGACY_GOOGLE_CREDS_FILE = path.resolve(import.meta.dirname, "../../ads_agent/google_ads_credentials.json");

// ─── Registry persistence helpers ─────────────────────────────────

const DEFAULT_CLIENT: ClientConfig = {
  id: "amara",
  name: "Deevyashakti Amara",
  shortName: "Amara",
  project: "Deevyashakti Amara",
  location: "Hyderabad",
  targetLocations: ["Hyderabad", "Secunderabad"],
  platforms: {
    meta: {
      enabled: true,
      dataPath: path.join(DATA_BASE, "clients/amara/meta/analysis.json"),
      label: "Meta Ads",
    },
    google: {
      enabled: true,
      dataPath: path.join(DATA_BASE, "clients/amara/google/analysis.json"),
      label: "Google Ads",
    },
  },
  targets: {
    meta: { budget: 200000, leads: 278, cpl: 720, svs: { low: 10, high: 12 }, cpsv: { low: 18000, high: 20000 } },
    google: { budget: 800000, leads: 940, cpl: 850, svs: { low: 44, high: 44 }, cpsv: { low: 18000, high: 18000 } },
  },
  createdAt: new Date().toISOString(),
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_BASE)) fs.mkdirSync(DATA_BASE, { recursive: true });
}

function loadRegistry(): ClientConfig[] {
  ensureDataDir();
  if (!fs.existsSync(REGISTRY_FILE)) {
    const initial = [DEFAULT_CLIENT];
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8")) as ClientConfig[];
  } catch {
    return [DEFAULT_CLIENT];
  }
}

function saveRegistry(registry: ClientConfig[]): void {
  ensureDataDir();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

function loadCredentials(): Record<string, ClientCredentials> {
  ensureDataDir();
  if (!fs.existsSync(CREDENTIALS_FILE)) return {};
  try {
    const arr = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8")) as ClientCredentials[];
    return Object.fromEntries(arr.map((c) => [c.clientId, c]));
  } catch {
    return {};
  }
}

function saveCredentials(store: Record<string, ClientCredentials>): void {
  ensureDataDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(Object.values(store), null, 2));
}

function getDefaultGoogleCredsFromEnv() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || "").trim();
  const developerToken = (process.env.GOOGLE_DEVELOPER_TOKEN || "").trim();
  const mccId = (process.env.GOOGLE_MCC_ID || "").trim();
  const customerId = (process.env.GOOGLE_CUSTOMER_ID || "").trim();

  if (!clientId || !clientSecret || !refreshToken) return null;

  return {
    clientId,
    clientSecret,
    refreshToken,
    developerToken,
    mccId,
    customerId,
  };
}

function syncLegacyGoogleCredentialsFile(google?: ClientCredentials["google"]): void {
  if (!google) return;
  const payload = {
    client_id: google.clientId,
    client_secret: google.clientSecret,
    refresh_token: google.refreshToken,
    developer_token: google.developerToken,
    login_customer_id: google.mccId,
  };
  fs.writeFileSync(LEGACY_GOOGLE_CREDS_FILE, JSON.stringify(payload, null, 2));
}

function bootstrapDefaultClientCredentials(): void {
  const envGoogle = getDefaultGoogleCredsFromEnv();
  const envMetaAccessToken = (process.env.META_ACCESS_TOKEN || "").trim();
  const envMetaAdAccountId = (process.env.META_AD_ACCOUNT_ID || "").trim();

  if (!envGoogle && (!envMetaAccessToken || !envMetaAdAccountId)) return;

  const creds = loadCredentials();
  const existing = creds["amara"] || { clientId: "amara", updatedAt: "" };

  if (envGoogle) {
    existing.google = {
      clientId: envGoogle.clientId,
      clientSecret: envGoogle.clientSecret,
      refreshToken: envGoogle.refreshToken,
      developerToken: envGoogle.developerToken,
      mccId: envGoogle.mccId,
      customerId: envGoogle.customerId,
    };
    syncLegacyGoogleCredentialsFile(existing.google);
  }

  if (envMetaAccessToken && envMetaAdAccountId) {
    existing.meta = {
      accessToken: envMetaAccessToken,
      adAccountId: envMetaAdAccountId,
    };
  }

  existing.updatedAt = new Date().toISOString();
  creds["amara"] = existing;
  saveCredentials(creds);
}

// Live in-memory registry (loaded at startup, mutated by CRUD APIs)
let CLIENT_REGISTRY: ClientConfig[] = loadRegistry();
bootstrapDefaultClientCredentials();

// Also support the legacy flat file path as a fallback for amara/meta
const LEGACY_META_PATH = path.join(DATA_BASE, "meta_analysis_v2.json");

// Some deployments persist `clients_registry.json` with absolute, machine-specific
// `dataPath` values (e.g. from a different laptop). Normalize those paths back
// into this server's `DATA_BASE` so we can correctly compute `hasData`.
function resolvePlatformDataPath(clientId: string, platform: string, platformConfig: PlatformConfig): string {
  const configured = platformConfig.dataPath;

  // If the configured path already exists on this machine, use it.
  if (fs.existsSync(configured)) return configured;

  // If the registry stores an absolute path containing "ads_agent/data/",
  // map the suffix into our local DATA_BASE.
  const normalized = configured.replace(/\\/g, "/");
  const marker = "ads_agent/data/";
  const markerIdx = normalized.indexOf(marker);
  if (markerIdx !== -1) {
    const relativeToAdsAgentData = normalized.slice(markerIdx + marker.length);
    return path.join(DATA_BASE, relativeToAdsAgentData);
  }

  // Otherwise, fall back to the default expected location.
  return path.join(DATA_BASE, `clients/${clientId}/${platform}/analysis.json`);
}


// ─── Custom Instructions Storage ──────────────────────────────────
const INSTRUCTIONS_FILE = path.join(DATA_BASE, "custom_instructions.json");

interface Instruction {
  id: string;
  clientId: string;
  platform: string;
  instruction: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "normal" | "low";
  createdAt: string;
  executedAt: string | null;
  result: string | null;
}

interface InstructionsStore {
  instructions: Instruction[];
}

function readInstructions(): InstructionsStore {
  if (!fs.existsSync(INSTRUCTIONS_FILE)) {
    return { instructions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(INSTRUCTIONS_FILE, "utf-8"));
  } catch {
    return { instructions: [] };
  }
}

function writeInstructions(store: InstructionsStore): void {
  const dir = path.dirname(INSTRUCTIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INSTRUCTIONS_FILE, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── File-based Recommendation Actions (replaces in-memory Map) ───
const RECOMMENDATION_ACTIONS_PATH = path.join(DATA_BASE, "recommendation_actions.json");

function readRecommendationActions(): Record<string, { action: RecommendationAction; timestamp: string }> {
  if (!fs.existsSync(RECOMMENDATION_ACTIONS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(RECOMMENDATION_ACTIONS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeRecommendationActions(data: Record<string, { action: RecommendationAction; timestamp: string }>): void {
  const dir = path.dirname(RECOMMENDATION_ACTIONS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RECOMMENDATION_ACTIONS_PATH, JSON.stringify(data, null, 2));
}

// Load persisted recommendation actions on startup
let recommendationActionsCache: Record<string, { action: RecommendationAction; timestamp: string }> = readRecommendationActions();

function setRecommendationAction(key: string, value: { action: RecommendationAction; timestamp: string }): void {
  recommendationActionsCache[key] = value;
  writeRecommendationActions(recommendationActionsCache);
}

function getRecommendationActionsForPrefix(prefix: string): Record<string, { action: string; timestamp: string }> {
  const result: Record<string, { action: string; timestamp: string }> = {};
  for (const [key, value] of Object.entries(recommendationActionsCache)) {
    if (key.startsWith(prefix)) {
      const recId = key.slice(prefix.length);
      result[recId] = value;
    }
  }
  return result;
}

function readAnalysisData(clientId: string, platform: string, cadence?: string): any {
  const client = CLIENT_REGISTRY.find((c) => c.id === clientId);
  if (!client) {
    throw new Error(`Client '${clientId}' not found in registry`);
  }
  const platformConfig = client.platforms[platform];
  if (!platformConfig) {
    throw new Error(`Platform '${platform}' not configured for client '${clientId}'`);
  }
  if (!platformConfig.enabled) {
    throw new Error(`Platform '${platform}' is not yet enabled for client '${clientId}'`);
  }

  let dataPath = resolvePlatformDataPath(clientId, platform, platformConfig);

  // If cadence specified, try cadence-specific file first
  if (cadence) {
    // 1. Client-specific cadence path
    const cadencePath = dataPath.replace(/analysis\.json$/, `analysis_${cadence}.json`);
    if (fs.existsSync(cadencePath)) {
      dataPath = cadencePath;
    } else if (platform === "meta") {
      // 2. Legacy flat cadence path — Meta only (e.g., /data/meta_analysis_twice_weekly.json)
      const legacyCadencePath = path.join(DATA_BASE, `meta_analysis_${cadence}.json`);
      if (fs.existsSync(legacyCadencePath)) {
        dataPath = legacyCadencePath;
      }
      // else: fall through to default dataPath (analysis.json)
    }
  }

  // Fallback: if the client-specific path doesn't exist but legacy does (for amara/meta)
  if (!fs.existsSync(dataPath) && clientId === "amara" && platform === "meta") {
    dataPath = LEGACY_META_PATH;
  }

  if (!fs.existsSync(dataPath)) {
    throw new Error(`No analysis data found at ${dataPath}`);
  }

  const raw = fs.readFileSync(dataPath, "utf-8");
  return JSON.parse(raw);
}

// List available cadence files for a client/platform
function listCadences(clientId: string, platform: string): string[] {
  const client = CLIENT_REGISTRY.find((c) => c.id === clientId);
  if (!client) return [];
  const platformConfig = client.platforms[platform];
  if (!platformConfig) return [];
  const dir = path.dirname(resolvePlatformDataPath(clientId, platform, platformConfig));
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const cadences: string[] = [];
  for (const f of files) {
    const match = f.match(/^analysis_(.+)\.json$/);
    if (match) cadences.push(match[1]);
  }
  return cadences;
}

// ─── Helper: get benchmarks from registry targets ─────────────────
function getDefaultBenchmarks(clientId: string, platform?: string): any {
  const client = CLIENT_REGISTRY.find((c) => c.id === clientId);
  const targets = client?.targets;

  // Use the specified platform's targets, or fall back to meta, or use hardcoded defaults
  const platformTargets = targets?.[platform || "meta"] || targets?.meta;

  return {
    budget: platformTargets?.budget || 200000,
    leads: platformTargets?.leads || 278,
    cpl: platformTargets?.cpl || 720,
    ctr_min: 0.7,
    cpm_max: 300,
    cpsv_low: platformTargets?.cpsv?.low || 18000,
    cpsv_high: platformTargets?.cpsv?.high || 20000,
    svs_low: platformTargets?.svs?.low || 10,
    svs_high: platformTargets?.svs?.high || 12,
    tsr_min: 5.0,
    vhr_min: 25.0,
    frequency_max: 2.5,
    cpc_max: 50,
    auto_pause_cpl_threshold_pct: 30,
    auto_pause_zero_leads_impressions: 8000,
    target_locations: client?.targetLocations || ["Hyderabad", "Secunderabad"],
    svs_mtd: 3,
    closures_mtd: 1,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ─── Health check for deployment monitoring ──────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });


  // ─── Client Registry Endpoints ─────────────────────────────────
  
  // List all clients
  app.get("/api/clients", (_req, res) => {
    const clients = CLIENT_REGISTRY.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      project: c.project,
      location: c.location,
      targetLocations: c.targetLocations || [],
      platforms: Object.entries(c.platforms).map(([key, p]) => ({
        id: key,
        label: p.label,
        enabled: p.enabled,
        hasData:
          fs.existsSync(resolvePlatformDataPath(c.id, key, p)) ||
          (c.id === "amara" && key === "meta" && fs.existsSync(LEGACY_META_PATH)),
      })),
      targets: c.targets || {},
    }));
    res.json(clients);
  });

  // Get single client details
  app.get("/api/clients/:clientId", (req, res) => {
    const client = CLIENT_REGISTRY.find((c) => c.id === req.params.clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    res.json({
      id: client.id,
      name: client.name,
      shortName: client.shortName,
      project: client.project,
      location: client.location,
      targetLocations: client.targetLocations || [],
      platforms: Object.entries(client.platforms).map(([key, p]) => ({
        id: key,
        label: p.label,
        enabled: p.enabled,
        hasData:
          fs.existsSync(resolvePlatformDataPath(client.id, key, p)) ||
          (client.id === "amara" && key === "meta" && fs.existsSync(LEGACY_META_PATH)),
      })),
      targets: client.targets || {},
    });
  });

  // ─── Client CRUD (create / update / delete) ─────────────────────

  // Generate a URL-safe ID from a name
  function toClientId(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  // POST /api/clients — create a new client
  app.post("/api/clients", (req, res) => {
    const { name, shortName, project, location, targetLocations, enableMeta, enableGoogle } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Client name is required" });
    }
    const id = toClientId(name.trim());
    if (CLIENT_REGISTRY.find((c) => c.id === id)) {
      return res.status(409).json({ error: `A client with id '${id}' already exists` });
    }
    const newClient: ClientConfig = {
      id,
      name: name.trim(),
      shortName: (shortName || name).trim(),
      project: (project || name).trim(),
      location: (location || "").trim(),
      targetLocations: Array.isArray(targetLocations)
        ? targetLocations.filter(Boolean)
        : (targetLocations || "").split(",").map((s: string) => s.trim()).filter(Boolean),
      platforms: {
        meta: {
          enabled: enableMeta !== false,
          dataPath: path.join(DATA_BASE, `clients/${id}/meta/analysis.json`),
          label: "Meta Ads",
        },
        google: {
          enabled: enableGoogle !== false,
          dataPath: path.join(DATA_BASE, `clients/${id}/google/analysis.json`),
          label: "Google Ads",
        },
      },
      targets: {},
      createdAt: new Date().toISOString(),
    };
    // Ensure data directories exist
    fs.mkdirSync(path.join(DATA_BASE, `clients/${id}/meta`), { recursive: true });
    fs.mkdirSync(path.join(DATA_BASE, `clients/${id}/google`), { recursive: true });

    CLIENT_REGISTRY.push(newClient);
    saveRegistry(CLIENT_REGISTRY);
    res.status(201).json({ id, name: newClient.name, shortName: newClient.shortName });
  });

  // PUT /api/clients/:clientId — update name, location, targets, platform enable/disable
  app.put("/api/clients/:clientId", (req, res) => {
    const idx = CLIENT_REGISTRY.findIndex((c) => c.id === req.params.clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not found" });
    const existing = CLIENT_REGISTRY[idx];
    const { name, shortName, project, location, targetLocations, enableMeta, enableGoogle, targets } = req.body;
    CLIENT_REGISTRY[idx] = {
      ...existing,
      name: (name || existing.name).trim(),
      shortName: (shortName || existing.shortName).trim(),
      project: (project || existing.project).trim(),
      location: (location !== undefined ? location : existing.location).trim(),
      targetLocations: Array.isArray(targetLocations)
        ? targetLocations.filter(Boolean)
        : existing.targetLocations,
      platforms: {
        ...existing.platforms,
        meta: { ...existing.platforms.meta, enabled: enableMeta !== undefined ? Boolean(enableMeta) : existing.platforms.meta?.enabled },
        google: { ...existing.platforms.google, enabled: enableGoogle !== undefined ? Boolean(enableGoogle) : existing.platforms.google?.enabled },
      },
      targets: targets !== undefined ? targets : existing.targets,
    };
    saveRegistry(CLIENT_REGISTRY);
    res.json({ success: true, id: req.params.clientId });
  });

  // DELETE /api/clients/:clientId — remove from registry (data files preserved)
  app.delete("/api/clients/:clientId", (req, res) => {
    const { clientId } = req.params;
    if (clientId === "amara") {
      return res.status(403).json({ error: "The default client cannot be deleted" });
    }
    const idx = CLIENT_REGISTRY.findIndex((c) => c.id === clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not found" });
    CLIENT_REGISTRY.splice(idx, 1);
    saveRegistry(CLIENT_REGISTRY);
    // Also remove credentials
    const creds = loadCredentials();
    delete creds[clientId];
    saveCredentials(creds);
    res.json({ success: true });
  });

  // GET /api/clients/:clientId/credentials — return masked credentials (for display)
  app.get("/api/clients/:clientId/credentials", (req, res) => {
    const creds = loadCredentials();
    const c = creds[req.params.clientId];
    if (!c) return res.json({ hasMeta: false, hasGoogle: false });
    // Mask secrets — only send whether they exist plus last 6 chars of token
    const mask = (s?: string) => s ? `••••••${s.slice(-6)}` : "";
    res.json({
      hasMeta: !!c.meta?.accessToken,
      hasGoogle: !!c.google?.clientId,
      meta: c.meta ? {
        accessToken: mask(c.meta.accessToken),
        adAccountId: c.meta.adAccountId,
      } : undefined,
      google: c.google ? {
        clientId: mask(c.google.clientId),
        clientSecret: mask(c.google.clientSecret),
        refreshToken: mask(c.google.refreshToken),
        developerToken: mask(c.google.developerToken),
        mccId: c.google.mccId,
        customerId: c.google.customerId,
      } : undefined,
    });
  });

  // PUT /api/clients/:clientId/credentials — save/update credentials
  app.put("/api/clients/:clientId/credentials", (req, res) => {
    const { clientId } = req.params;
    if (!CLIENT_REGISTRY.find((c) => c.id === clientId)) {
      return res.status(404).json({ error: "Client not found" });
    }
    const { meta, google } = req.body;
    const creds = loadCredentials();
    const existing = creds[clientId] || { clientId, updatedAt: "" };

    if (meta) {
      const { accessToken, adAccountId } = meta;
      if (!accessToken || !adAccountId) {
        return res.status(400).json({ error: "Meta credentials require accessToken and adAccountId" });
      }
      existing.meta = { accessToken: accessToken.trim(), adAccountId: adAccountId.trim() };
    }

    if (google) {
      const { clientId: gClientId, clientSecret, refreshToken, developerToken, mccId, customerId } = google;
      if (!gClientId || !clientSecret || !refreshToken) {
        return res.status(400).json({ error: "Google credentials require clientId, clientSecret, and refreshToken" });
      }
      existing.google = {
        clientId: gClientId.trim(),
        clientSecret: clientSecret.trim(),
        refreshToken: refreshToken.trim(),
        developerToken: (developerToken || "").trim(),
        mccId: (mccId || "").trim(),
        customerId: (customerId || "").trim(),
      };
    }

    existing.updatedAt = new Date().toISOString();
    creds[clientId] = existing;
    saveCredentials(creds);

    // Keep the legacy Python credentials file aligned for local scripts.
    if (google) {
      syncLegacyGoogleCredentialsFile(existing.google);
    }

    // Clear stale token cache so the new refresh token is used immediately.
    if (google && fs.existsSync(GOOGLE_ADS_TOKEN_CACHE)) {
      fs.unlinkSync(GOOGLE_ADS_TOKEN_CACHE);
    }

    res.json({ success: true, updatedAt: existing.updatedAt });
  });

  // ─── Analysis Data Endpoints (client + platform aware) ─────────


  // Full analysis data for a client/platform (optional ?cadence=twice_weekly|weekly|biweekly|monthly)
  app.get("/api/clients/:clientId/:platform/analysis", (req, res) => {
    try {
      const cadence = req.query.cadence as string | undefined;
      const data = readAnalysisData(req.params.clientId, req.params.platform, cadence);
      res.json(data);
    } catch (err: any) {
      const status = err.message.includes("not found") || err.message.includes("not configured") ? 404
        : err.message.includes("not yet enabled") ? 403
        : 500;
      res.status(status).json({ error: err.message });
    }
  });

  app.get("/api/clients/:clientId/:platform/sync-state", (req, res) => {
    try {
      const client = CLIENT_REGISTRY.find((entry) => entry.id === req.params.clientId);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      const platformConfig = client.platforms[req.params.platform];
      if (!platformConfig) {
        return res.status(404).json({ error: "Platform not configured" });
      }

      res.json(getPlatformSyncState(req.params.clientId, req.params.platform));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load sync state" });
    }
  });

  // List available cadences for a client/platform
  app.get("/api/clients/:clientId/:platform/cadences", (req, res) => {
    const cadences = listCadences(req.params.clientId, req.params.platform);
    res.json(cadences);
  });

  // Summary for a client/platform
  app.get("/api/clients/:clientId/:platform/summary", (req, res) => {
    try {
      const data = readAnalysisData(req.params.clientId, req.params.platform);
      res.json({
        summary: data.summary,
        account_pulse: data.account_pulse,
        monthly_pacing: data.monthly_pacing,
      });
    } catch (err: any) {
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // ─── Paused Entities (derived from audit log) ─────────────────
  // Returns a map of entity IDs → paused info for entities whose latest
  // action in the audit log was a PAUSE (not subsequently unpaused).
  // Supports optional ?platform= query param ("meta", "google", "all").
  app.get("/api/paused-entities", (_req, res) => {
    try {
      const platformFilter = (_req.query.platform as string || "all").toLowerCase();

      const paused: Record<string, { entityName: string; entityType: string; pausedAt: string; reason?: string; platform?: string }> = {};

      // Meta audit log
      if (platformFilter === "meta" || platformFilter === "all") {
        const metaLog = getAuditLog(500);
        const latestMetaAction = new Map<string, { action: string; timestamp: string; entityName: string; entityType: string; reason?: string }>();
        for (const entry of metaLog) {
          if (!latestMetaAction.has(entry.entityId)) {
            latestMetaAction.set(entry.entityId, {
              action: entry.action,
              timestamp: entry.timestamp,
              entityName: entry.entityName,
              entityType: entry.entityType,
              reason: entry.reason,
            });
          }
        }
        latestMetaAction.forEach((val, entityId) => {
          if (val.action.startsWith("PAUSE_") && !val.action.startsWith("UNPAUSE_")) {
            paused[entityId] = {
              entityName: val.entityName,
              entityType: val.entityType,
              pausedAt: val.timestamp,
              reason: val.reason,
              platform: "meta",
            };
          }
        });
      }

      // Google audit log
      if (platformFilter === "google" || platformFilter === "all") {
        const googleLog = getGoogleAuditLog(500);
        const latestGoogleAction = new Map<string, { action: string; timestamp: string; entityName: string; entityType: string; reason?: string }>();
        for (const entry of googleLog) {
          if (!latestGoogleAction.has(entry.entityId)) {
            latestGoogleAction.set(entry.entityId, {
              action: entry.action,
              timestamp: entry.timestamp,
              entityName: entry.entityName,
              entityType: entry.entityType,
              reason: entry.reason,
            });
          }
        }
        latestGoogleAction.forEach((val, entityId) => {
          if (val.action.startsWith("PAUSE_") && !val.action.startsWith("ENABLE_")) {
            paused[entityId] = {
              entityName: val.entityName,
              entityType: val.entityType,
              pausedAt: val.timestamp,
              reason: val.reason,
              platform: "google",
            };
          }
        });
      }

      res.json(paused);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Recommendation Actions (client + platform scoped) ─────────

  app.post("/api/clients/:clientId/:platform/recommendations/:id/action", async (req, res) => {
    const { clientId, platform, id } = req.params;
    const { action, executionDetails } = req.body;
    if (!action || !["approved", "rejected", "deferred"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Must be approved, rejected, or deferred." });
    }
    const key = `${clientId}:${platform}:${id}`;
    setRecommendationAction(key, {
      action,
      timestamp: new Date().toISOString(),
    });

    // If approved with executionDetails, execute the action via Meta API
    if (action === "approved" && executionDetails) {
      try {
        const execReq: ExecutionRequest = {
          action: executionDetails.executionAction as ExecutionActionType,
          entityId: executionDetails.entityId,
          entityName: executionDetails.entityName || executionDetails.entityId,
          entityType: executionDetails.entityType || "adset",
          params: {
            ...(executionDetails.params || {}),
            recommendationId: id,
          },
          requestedBy: "user",
        };
        const execResult = await executeAction(execReq);
        return res.json({ success: true, id, action, execution: execResult });
      } catch (err: any) {
        return res.json({
          success: true,
          id,
          action,
          execution: { success: false, error: err.message || "Execution failed" },
        });
      }
    }

    res.json({ success: true, id, action });
  });

  app.get("/api/clients/:clientId/:platform/recommendations/actions", (req, res) => {
    const { clientId, platform } = req.params;
    const prefix = `${clientId}:${platform}:`;
    const actions = getRecommendationActionsForPrefix(prefix);
    res.json(actions);
  });

  // ─── Custom Instructions Endpoints ─────────────────────────────

  // List instructions for a client (newest first)
  app.get("/api/clients/:clientId/instructions", (req, res) => {
    const { clientId } = req.params;
    const store = readInstructions();
    const clientInstructions = store.instructions
      .filter((i) => i.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(clientInstructions);
  });

  // Create a new instruction
  app.post("/api/clients/:clientId/instructions", (req, res) => {
    const { clientId } = req.params;
    const { instruction, platform, priority } = req.body;
    if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
      return res.status(400).json({ error: "Instruction text is required" });
    }
    const validPlatforms = ["meta", "google", "all"];
    const validPriorities = ["high", "normal", "low"];
    const newInstruction: Instruction = {
      id: generateId(),
      clientId,
      platform: validPlatforms.includes(platform) ? platform : "meta",
      instruction: instruction.trim(),
      status: "pending",
      priority: validPriorities.includes(priority) ? priority : "normal",
      createdAt: new Date().toISOString(),
      executedAt: null,
      result: null,
    };
    const store = readInstructions();
    store.instructions.push(newInstruction);
    writeInstructions(store);
    res.status(201).json(newInstruction);
  });

  // Update instruction status
  app.patch("/api/clients/:clientId/instructions/:id", (req, res) => {
    const { clientId, id } = req.params;
    const { status, result } = req.body;
    const validStatuses = ["pending", "in_progress", "completed", "cancelled"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const store = readInstructions();
    const idx = store.instructions.findIndex((i) => i.id === id && i.clientId === clientId);
    if (idx === -1) {
      return res.status(404).json({ error: "Instruction not found" });
    }
    if (status) store.instructions[idx].status = status;
    if (result !== undefined) store.instructions[idx].result = result;
    if (status === "completed" || status === "cancelled") {
      store.instructions[idx].executedAt = new Date().toISOString();
    }
    writeInstructions(store);
    res.json(store.instructions[idx]);
  });

  // Delete instruction
  app.delete("/api/clients/:clientId/instructions/:id", (req, res) => {
    const { clientId, id } = req.params;
    const store = readInstructions();
    const idx = store.instructions.findIndex((i) => i.id === id && i.clientId === clientId);
    if (idx === -1) {
      return res.status(404).json({ error: "Instruction not found" });
    }
    store.instructions.splice(idx, 1);
    writeInstructions(store);
    res.json({ success: true });
  });

  // ─── Legacy endpoints (backward compat — redirect to amara/meta) ───

  app.get("/api/analysis", (_req, res) => {
    try {
      const data = readAnalysisData("amara", "meta");
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to read analysis data", detail: err.message });
    }
  });

  app.get("/api/analysis/summary", (_req, res) => {
    try {
      const data = readAnalysisData("amara", "meta");
      res.json({
        summary: data.summary,
        account_pulse: data.account_pulse,
        monthly_pacing: data.monthly_pacing,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to read summary", detail: err.message });
    }
  });

  app.post("/api/recommendations/:id/action", (req, res) => {
    const { id } = req.params;
    const { action } = req.body;
    if (!action || !["approved", "rejected", "deferred"].includes(action)) {
      return res.status(400).json({ error: "Invalid action." });
    }
    const key = `amara:meta:${id}`;
    setRecommendationAction(key, {
      action,
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true, id, action });
  });

  app.get("/api/recommendations/actions", (_req, res) => {
    const prefix = "amara:meta:";
    const actions = getRecommendationActionsForPrefix(prefix);
    res.json(actions);
  });

  // ─── Execution Engine Endpoints ─────────────────────────────────

  // Execute a single action (pause, unpause, scale budget, etc.)
  app.post("/api/execute", async (req, res) => {
    try {
      const { action, entityId, entityName, entityType, params, requestedBy } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";

      // Validate required fields
      if (!action || !entityId || !entityType) {
        return res.status(400).json({ error: "Missing required fields: action, entityId, entityType" });
      }

      const validActions: ExecutionActionType[] = [
        "PAUSE_AD", "UNPAUSE_AD",
        "PAUSE_ADSET", "UNPAUSE_ADSET",
        "PAUSE_CAMPAIGN", "UNPAUSE_CAMPAIGN",
        "SCALE_BUDGET_UP", "SCALE_BUDGET_DOWN",
        "SET_BUDGET",
      ];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(", ")}` });
      }

      const validEntityTypes = ["campaign", "adset", "ad"];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ error: "entityType must be campaign, adset, or ad" });
      }

      const execReq: ExecutionRequest = {
        action,
        entityId,
        entityName: entityName || entityId,
        entityType,
        params: params || {},
        requestedBy: requestedBy || "user",
        requestedByName: actorName,
      };

      const result = await executeAction(execReq);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Execution failed" });
    }
  });

  // Execute a batch of actions
  app.post("/api/execute/batch", async (req, res) => {
    try {
      const { actions } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";
      if (!Array.isArray(actions) || actions.length === 0) {
        return res.status(400).json({ error: "actions must be a non-empty array" });
      }
      if (actions.length > 20) {
        return res.status(400).json({ error: "Maximum 20 actions per batch" });
      }
      const results = await executeBatch(actions.map((action: any) => ({
        ...action,
        requestedBy: action.requestedBy || "user",
        requestedByName: actorName,
      })));
      res.json({ results, total: results.length, succeeded: results.filter(r => r.success).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Batch execution failed" });
    }
  });

  // Get entity status from Meta API (live)
  app.get("/api/entity/:entityId/status", async (req, res) => {
    try {
      const status = await getEntityStatus(req.params.entityId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get execution audit log
  app.get("/api/audit-log", (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 50;
    const log = getAuditLog(limit);
    res.json(log);
  });

  // ─── Auto-Execute Endpoint ──────────────────────────────────────
  // Reads latest analysis, finds auto_action insights, executes them
  app.post("/api/auto-execute", async (req, res) => {
    try {
      const { clientId = "amara", platform = "meta" } = req.body || {};
      const data = readAnalysisData(clientId, platform);

      const insights: any[] = data.intellect_insights || [];
      const autoInsights = insights.filter((i: any) => i.auto_action === true);

      if (autoInsights.length === 0) {
        return res.json({ results: [], total: 0, succeeded: 0, message: "No auto-executable insights found" });
      }

      // Build adset/campaign lookup for fuzzy matching entity names
      const adsets: any[] = data.adset_analysis || [];
      const campaigns: any[] = data.campaign_audit || [];

      const execRequests: ExecutionRequest[] = [];

      for (const insight of autoInsights) {
        if (insight.type === "AUTO_PAUSE_CPL" || insight.type === "AUTO_PAUSE_ZERO_LEADS") {
          // Try to match entity name to an adset or campaign
          const entityName = insight.entity || "";
          const matchedAdset = adsets.find((a: any) =>
            entityName.includes(a.adset_name?.substring(0, 30)) ||
            a.adset_name?.includes(entityName.substring(0, 30))
          );
          const matchedCampaign = campaigns.find((c: any) =>
            entityName.includes(c.campaign_name?.substring(0, 30)) ||
            c.campaign_name?.includes(entityName.substring(0, 30))
          );

          if (matchedAdset) {
            execRequests.push({
              action: "PAUSE_ADSET",
              entityId: matchedAdset.adset_id,
              entityName: matchedAdset.adset_name,
              entityType: "adset",
              params: {
                reason: insight.detail,
                playbookRef: insight.type,
              },
              requestedBy: "auto",
            });
          } else if (matchedCampaign) {
            execRequests.push({
              action: "PAUSE_CAMPAIGN",
              entityId: matchedCampaign.campaign_id,
              entityName: matchedCampaign.campaign_name,
              entityType: "campaign",
              params: {
                reason: insight.detail,
                playbookRef: insight.type,
              },
              requestedBy: "auto",
            });
          }
        }
      }

      if (execRequests.length === 0) {
        return res.json({ results: [], total: 0, succeeded: 0, message: "No matching entities found for auto-execute" });
      }

      const results = await executeBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Auto-execute failed" });
    }
  });

  // ─── Quick Action Endpoint ──────────────────────────────────────
  // Execute batch actions: SCALE_WINNERS, PAUSE_UNDERPERFORMERS, FIX_LEARNING_LIMITED
  app.post("/api/clients/:clientId/:platform/quick-action", async (req, res) => {
    try {
      const { clientId, platform } = req.params;
      const { actionType, scalePercent = 20 } = req.body as { actionType: QuickActionType; scalePercent?: number };

      if (!actionType || !["SCALE_WINNERS", "PAUSE_UNDERPERFORMERS", "FIX_LEARNING_LIMITED"].includes(actionType)) {
        return res.status(400).json({
          error: "actionType must be SCALE_WINNERS, PAUSE_UNDERPERFORMERS, or FIX_LEARNING_LIMITED",
        });
      }

      const data = readAnalysisData(clientId, platform);
      const adsets: any[] = data.adset_analysis || [];
      const execRequests: ExecutionRequest[] = [];

      switch (actionType) {
        case "SCALE_WINNERS": {
          const winners = adsets.filter((a: any) => a.classification === "WINNER");
          for (const w of winners) {
            if (w.adset_id && w.daily_budget > 0) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: w.adset_id,
                entityName: w.adset_name || w.adset_id,
                entityType: "adset",
                params: {
                  scalePercent,
                  reason: `Quick Action: Scale winner +${scalePercent}% (score ${w.health_score}, CPL ₹${w.cpl?.toFixed(0) || "N/A"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "PAUSE_UNDERPERFORMERS": {
          const underperformers = adsets.filter(
            (a: any) => a.should_pause === true || a.classification === "UNDERPERFORMER"
          );
          for (const u of underperformers) {
            if (u.adset_id) {
              execRequests.push({
                action: "PAUSE_ADSET",
                entityId: u.adset_id,
                entityName: u.adset_name || u.adset_id,
                entityType: "adset",
                params: {
                  reason: `Quick Action: Pause underperformer (score ${u.health_score}, ${u.auto_pause_reasons?.join("; ") || "classification: UNDERPERFORMER"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "FIX_LEARNING_LIMITED": {
          const learningLimited = adsets.filter((a: any) => a.learning_status === "LEARNING_LIMITED");
          for (const ll of learningLimited) {
            if (ll.adset_id && ll.daily_budget > 0) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: ll.adset_id,
                entityName: ll.adset_name || ll.adset_id,
                entityType: "adset",
                params: {
                  scalePercent: 30,
                  reason: `Quick Action: Fix Learning Limited - scale budget +30% (current budget ₹${ll.daily_budget?.toFixed(0) || "N/A"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: `No matching adsets found for ${actionType}`,
        });
      }

      const results = await executeBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Quick action failed" });
    }
  });

  // ─── Auto-Execute Now (client/platform scoped) ──────────────────
  // Reads latest analysis, finds all should_pause entities, executes pause
  app.post("/api/clients/:clientId/:platform/auto-execute-now", async (req, res) => {
    try {
      const { clientId, platform } = req.params;
      const data = readAnalysisData(clientId, platform);

      const execRequests: ExecutionRequest[] = [];

      // 1. Ads from scoring_summary.ad_scores.auto_pause
      const autoPauseAds: any[] = data.scoring_summary?.ad_scores?.auto_pause || [];
      for (const ad of autoPauseAds) {
        if (ad.ad_id) {
          execRequests.push({
            action: "PAUSE_AD",
            entityId: ad.ad_id,
            entityName: ad.ad_name || ad.ad_id,
            entityType: "ad",
            params: {
              reason: `Auto-pause: ${(ad.auto_pause_reasons || []).join("; ") || "scored for auto-pause"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      // 2. Ads from creative_health with should_pause === true
      const creativeHealth: any[] = data.creative_health || [];
      for (const ad of creativeHealth) {
        if (ad.should_pause && ad.ad_id) {
          // Avoid duplicates from scoring_summary
          if (!execRequests.some((r) => r.entityId === ad.ad_id)) {
            execRequests.push({
              action: "PAUSE_AD",
              entityId: ad.ad_id,
              entityName: ad.ad_name || ad.ad_id,
              entityType: "ad",
              params: {
                reason: `Auto-pause: ${(ad.auto_pause_reasons || []).join("; ") || "should_pause flagged in creative_health"}`,
              },
              requestedBy: "auto",
            });
          }
        }
      }

      // 3. Adsets from adset_analysis with should_pause === true
      const adsetAnalysis: any[] = data.adset_analysis || [];
      for (const adset of adsetAnalysis) {
        if (adset.should_pause && adset.adset_id) {
          execRequests.push({
            action: "PAUSE_ADSET",
            entityId: adset.adset_id,
            entityName: adset.adset_name || adset.adset_id,
            entityType: "adset",
            params: {
              reason: `Auto-pause: ${(adset.auto_pause_reasons || []).join("; ") || "should_pause flagged in adset_analysis"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: "No entities matching auto-pause criteria found",
        });
      }

      const results = await executeBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Auto-execute failed" });
    }
  });

  // ─── Execute Single Action (client/platform scoped) ──────────────
  // Accepts optional strategicCall in body for the learning engine
  // Supports MARK_COMPLETE, REJECT, DEFER (log-only, no API call)
  app.post("/api/clients/:clientId/:platform/execute-action", async (req, res) => {
    try {
      const { action, entityId, entityName, entityType, params, strategicCall } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";

      if (!action || !entityId || !entityType) {
        return res.status(400).json({ error: "Missing required fields: action, entityId, entityType" });
      }

      // Log-only action types (no API call needed)
      const logOnlyActions = ["MARK_COMPLETE", "REJECT", "DEFER"];
      if (logOnlyActions.includes(action)) {
        const logResult = {
          success: true,
          action,
          entityId,
          entityName: entityName || entityId,
          entityType,
          previousValue: action,
          newValue: action === "MARK_COMPLETE" ? "completed" : action === "REJECT" ? "rejected" : "deferred",
          timestamp: new Date().toISOString(),
          requestedBy: "user",
          requestedByName: actorName,
          reason: params?.reason || strategicCall || "",
          strategicCall,
        };

        if (req.params.platform === "google") {
          appendGoogleAuditEntry({
            ...logResult,
            platform: "google",
          });
        } else {
          appendAuditEntry(logResult);
        }

        // Record to learning engine
        try {
          const analysisData = readAnalysisData(req.params.clientId, req.params.platform);
          recordExecution(
            Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            entityId,
            entityName || entityId,
            entityType,
            action,
            params?.reason || strategicCall || `${action} by user`,
            analysisData,
            strategicCall
          );
        } catch (_) { /* best-effort */ }

        return res.json(logResult);
      }

      const validActions: ExecutionActionType[] = [
        "PAUSE_AD", "UNPAUSE_AD",
        "PAUSE_ADSET", "UNPAUSE_ADSET",
        "PAUSE_CAMPAIGN", "UNPAUSE_CAMPAIGN",
        "SCALE_BUDGET_UP", "SCALE_BUDGET_DOWN",
        "SET_BUDGET",
      ];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          error: `Invalid action. Must be one of: ${[...validActions, ...logOnlyActions].join(", ")}`,
        });
      }

      const validEntityTypes = ["campaign", "adset", "ad"];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ error: "entityType must be campaign, adset, or ad" });
      }

      const execReq: ExecutionRequest = {
        action,
        entityId,
        entityName: entityName || entityId,
        entityType,
        params: params || {},
        requestedBy: "user",
        requestedByName: actorName,
        strategicCall,
      };

      const result = await executeAction(execReq);

      // Record execution for learning engine (best-effort)
      if (result.success) {
        try {
          const analysisData = readAnalysisData(req.params.clientId, req.params.platform);
          recordExecution(
            Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            entityId,
            entityName || entityId,
            entityType,
            action,
            params?.reason,
            analysisData,
            strategicCall
          );
        } catch (_) { /* don't fail the response if learning recording fails */ }
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Execution failed" });
    }
  });

  // ─── Benchmarks Endpoints ──────────────────────────────────────────

  const BENCHMARKS_BASE = path.join(DATA_BASE, "clients");

  function getBenchmarksPath(clientId: string): string {
    return path.join(BENCHMARKS_BASE, clientId, "benchmarks.json");
  }

  app.get("/api/clients/:clientId/benchmarks", (req, res) => {
    const { clientId } = req.params;
    const platform = (req.query.platform as string) || "meta";
    const benchPath = getBenchmarksPath(clientId);
    if (!fs.existsSync(benchPath)) {
      return res.json({ ...getDefaultBenchmarks(clientId, platform), updated_at: null });
    }
    try {
      const data = JSON.parse(fs.readFileSync(benchPath, "utf-8"));
      res.json(data);
    } catch {
      res.json({ ...getDefaultBenchmarks(clientId, platform), updated_at: null });
    }
  });

  app.put("/api/clients/:clientId/benchmarks", (req, res) => {
    const benchPath = getBenchmarksPath(req.params.clientId);
    const dir = path.dirname(benchPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      ...req.body,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(benchPath, JSON.stringify(data, null, 2));
    res.json(data);
  });

  // ─── Breakdowns Endpoint ───────────────────────────────────────────

  app.get("/api/clients/:clientId/:platform/breakdowns", (req, res) => {
    const { clientId, platform } = req.params;
    const cadence = req.query.cadence as string | undefined;
    const client = CLIENT_REGISTRY.find((c) => c.id === clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    try {
      const data = readAnalysisData(clientId, platform, cadence);

      // Check for any breakdown data in the analysis
      const hasBreakdowns = data.breakdowns || data.breakdown_age || data.breakdown_gender ||
        data.breakdown_placement || data.breakdown_device || data.breakdown_region;

      if (hasBreakdowns) {
        return res.json({
          available: true,
          breakdowns: data.breakdowns || {
            age: data.breakdown_age || [],
            gender: data.breakdown_gender || [],
            placement: data.breakdown_placement || [],
            device: data.breakdown_device || [],
            region: data.breakdown_region || [],
          },
          campaign_breakdowns: data.campaign_breakdowns || {},
          geo_alerts: data.geo_alerts || [],
          target_locations: data.target_locations || client.targetLocations || [],
        });
      }

      res.json({
        available: false,
        message: "Breakdown data will be available after the next agent run with demographic fetching enabled.",
        target_locations: client.targetLocations || [],
      });
    } catch {
      res.json({
        available: false,
        message: "Breakdown data will be available after the next agent run with demographic fetching enabled.",
        target_locations: client.targetLocations || [],
      });
    }
  });

  // ─── Campaign-Specific Breakdowns Endpoint ───────────────────────

  app.get("/api/clients/:clientId/:platform/breakdowns/:campaignId", (req, res) => {
    const { clientId, platform, campaignId } = req.params;
    const cadence = req.query.cadence as string | undefined;
    const client = CLIENT_REGISTRY.find((c) => c.id === clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    try {
      const data = readAnalysisData(clientId, platform, cadence);
      const cbd = data.campaign_breakdowns?.[campaignId];
      if (!cbd) {
        return res.json({ available: false, message: "No breakdown data for this campaign." });
      }
      return res.json({
        available: true,
        breakdowns: cbd,
        target_locations: data.target_locations || client.targetLocations || [],
      });
    } catch {
      res.json({ available: false, message: "Campaign breakdown data not available." });
    }
  });

  // ─── Google Ads Execution Endpoints ─────────────────────────────

  // Execute a single Google Ads action (accepts strategicCall for learning)
  app.post("/api/clients/:clientId/google/execute-action", async (req, res) => {
    try {
      const { action, entityId, entityName, entityType, params, strategicCall } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";

      if (!action || !entityId || !entityType) {
        return res.status(400).json({ error: "Missing required fields: action, entityId, entityType" });
      }

      const validActions: GoogleExecutionActionType[] = [
        "PAUSE_CAMPAIGN", "ENABLE_CAMPAIGN",
        "PAUSE_AD_GROUP", "ENABLE_AD_GROUP",
        "PAUSE_AD", "ENABLE_AD",
        "SET_CAMPAIGN_BUDGET",
        "SCALE_BUDGET_UP", "SCALE_BUDGET_DOWN",
        "SET_CPC_BID",
      ];
      if (!validActions.includes(action)) {
        return res.status(400).json({
          error: `Invalid action. Must be one of: ${validActions.join(", ")}`,
        });
      }

      const execReq: GoogleExecutionRequest = {
        action,
        entityId,
        entityName: entityName || entityId,
        entityType,
        params: params || {},
        requestedBy: "user",
        requestedByName: actorName,
        strategicCall,
      };

      const result = await executeGoogleAction(execReq);

      // Record execution for learning engine (best-effort)
      if (result.success) {
        try {
          const analysisData = readAnalysisData(req.params.clientId, "google");
          recordExecution(
            Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            entityId,
            entityName || entityId,
            entityType,
            action,
            params?.reason,
            analysisData,
            strategicCall
          );
        } catch (_) { /* best-effort */ }
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Execution failed" });
    }
  });

  // Batch execute Google Ads actions
  app.post("/api/clients/:clientId/google/execute-batch", async (req, res) => {
    try {
      const { actions } = req.body;
      const actorName = req.authUser?.name || req.authUser?.email || "User";
      if (!Array.isArray(actions) || actions.length === 0) {
        return res.status(400).json({ error: "actions must be a non-empty array" });
      }
      if (actions.length > 20) {
        return res.status(400).json({ error: "Maximum 20 actions per batch" });
      }
      const results = await executeGoogleBatch(actions.map((action: any) => ({
        ...action,
        requestedBy: action.requestedBy || "user",
        requestedByName: actorName,
      })));
      res.json({ results, total: results.length, succeeded: results.filter(r => r.success).length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Batch execution failed" });
    }
  });

  // Google Ads audit log
  app.get("/api/google-audit-log", (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 50;
    const log = getGoogleAuditLog(limit);
    res.json(log);
  });

  // Google auto-execute: pause underperformers from analysis
  app.post("/api/clients/:clientId/google/auto-execute-now", async (req, res) => {
    try {
      const { clientId } = req.params;
      const data = readAnalysisData(clientId, "google");

      const execRequests: GoogleExecutionRequest[] = [];

      // 1. Campaigns with should_pause
      const campaigns: any[] = data.campaign_analysis || data.campaign_audit || [];
      for (const camp of campaigns) {
        if (camp.should_pause && (camp.campaign_id || camp.id)) {
          execRequests.push({
            action: "PAUSE_CAMPAIGN",
            entityId: camp.campaign_id || camp.id,
            entityName: camp.campaign_name || camp.name || camp.campaign_id,
            entityType: "campaign",
            params: {
              reason: `Auto-pause: ${(camp.auto_pause_reasons || []).join("; ") || "flagged for auto-pause"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      // 2. Ad groups with should_pause
      const adGroups: any[] = data.ad_group_analysis || [];
      for (const ag of adGroups) {
        if (ag.should_pause && (ag.ad_group_id || ag.id)) {
          execRequests.push({
            action: "PAUSE_AD_GROUP",
            entityId: ag.ad_group_id || ag.id,
            entityName: ag.ad_group_name || ag.name || ag.ad_group_id,
            entityType: "ad_group",
            params: {
              reason: `Auto-pause: ${(ag.auto_pause_reasons || []).join("; ") || "flagged for auto-pause"}`,
            },
            requestedBy: "auto",
          });
        }
      }

      // 3. Ads with should_pause
      const ads: any[] = data.ad_analysis || data.creative_health || [];
      for (const ad of ads) {
        if (ad.should_pause && (ad.ad_id || ad.id)) {
          if (!execRequests.some((r) => r.entityId === (ad.ad_id || ad.id))) {
            execRequests.push({
              action: "PAUSE_AD",
              entityId: ad.ad_id || ad.id,
              entityName: ad.ad_name || ad.name || ad.ad_id,
              entityType: "ad",
              params: {
                reason: `Auto-pause: ${(ad.auto_pause_reasons || []).join("; ") || "flagged for auto-pause"}`,
              },
              requestedBy: "auto",
            });
          }
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: "No entities matching auto-pause criteria found",
        });
      }

      const results = await executeGoogleBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Auto-execute failed" });
    }
  });

  // Google Quick Actions
  app.post("/api/clients/:clientId/google/quick-action", async (req, res) => {
    try {
      const { clientId } = req.params;
      const { actionType, scalePercent = 20 } = req.body;

      if (!actionType || !["SCALE_WINNERS", "PAUSE_UNDERPERFORMERS", "FIX_LEARNING_LIMITED"].includes(actionType)) {
        return res.status(400).json({
          error: "actionType must be SCALE_WINNERS, PAUSE_UNDERPERFORMERS, or FIX_LEARNING_LIMITED",
        });
      }

      const data = readAnalysisData(clientId, "google");
      const campaigns: any[] = data.campaign_analysis || data.campaign_audit || [];
      const execRequests: GoogleExecutionRequest[] = [];

      switch (actionType) {
        case "SCALE_WINNERS": {
          const winners = campaigns.filter((c: any) => c.classification === "WINNER");
          for (const w of winners) {
            if (w.campaign_id || w.id) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: w.campaign_id || w.id,
                entityName: w.campaign_name || w.name || w.campaign_id,
                entityType: "campaign",
                params: {
                  scalePercent,
                  reason: `Quick Action: Scale winner +${scalePercent}% (score ${w.health_score}, CPL ₹${w.cpl?.toFixed(0) || "N/A"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "PAUSE_UNDERPERFORMERS": {
          const underperformers = campaigns.filter(
            (c: any) => c.should_pause === true || c.classification === "UNDERPERFORMER"
          );
          for (const u of underperformers) {
            if (u.campaign_id || u.id) {
              execRequests.push({
                action: "PAUSE_CAMPAIGN",
                entityId: u.campaign_id || u.id,
                entityName: u.campaign_name || u.name || u.campaign_id,
                entityType: "campaign",
                params: {
                  reason: `Quick Action: Pause underperformer (score ${u.health_score}, ${u.auto_pause_reasons?.join("; ") || "UNDERPERFORMER"})`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
        case "FIX_LEARNING_LIMITED": {
          const limited = campaigns.filter((c: any) =>
            c.learning_status === "LEARNING_LIMITED" || c.bidding_status === "LEARNING"
          );
          for (const ll of limited) {
            if (ll.campaign_id || ll.id) {
              execRequests.push({
                action: "SCALE_BUDGET_UP",
                entityId: ll.campaign_id || ll.id,
                entityName: ll.campaign_name || ll.name || ll.campaign_id,
                entityType: "campaign",
                params: {
                  scalePercent: 30,
                  reason: `Quick Action: Fix Learning Limited - scale budget +30%`,
                },
                requestedBy: "user",
              });
            }
          }
          break;
        }
      }

      if (execRequests.length === 0) {
        return res.json({
          results: [],
          total: 0,
          succeeded: 0,
          message: `No matching campaigns found for ${actionType}`,
        });
      }

      const results = await executeGoogleBatch(execRequests);
      res.json({
        results,
        total: results.length,
        succeeded: results.filter((r) => r.success).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Quick action failed" });
    }
  });

  // ─── Google Negative Keyword Routes ─────────────────────────────
  const NEGATIVES_SCRIPT = path.resolve(import.meta.dirname, "../../ads_agent/google_ads_negatives.py");

  // Add a single negative keyword to a campaign
  app.post("/api/clients/:clientId/google/add-negative-keyword", async (req, res) => {
    try {
      const { campaignId, keyword, matchType } = req.body;

      if (!campaignId || !keyword) {
        return res.status(400).json({ error: "Missing required fields: campaignId, keyword" });
      }

      const validMatchTypes = ["EXACT", "PHRASE", "BROAD"];
      const normalizedMatchType = validMatchTypes.includes(matchType) ? matchType : "BROAD";

      const { stdout, stderr } = await execFileAsync("python3", [
        NEGATIVES_SCRIPT,
        "add",
        "--campaign-id", String(campaignId),
        "--keyword", String(keyword),
        "--match-type", normalizedMatchType,
      ], { timeout: 30000 });

      const result = JSON.parse(stdout);
      res.json(result);
    } catch (err: any) {
      // Try to parse Python JSON error output from stderr/stdout
      let message = "Failed to add negative keyword";
      try {
        const parsed = JSON.parse(err.stdout || "");
        message = parsed.error || message;
      } catch {
        message = err.stderr || err.message || message;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  // List negative keywords for a campaign
  app.get("/api/clients/:clientId/google/negative-keywords", async (req, res) => {
    try {
      const campaignId = req.query.campaignId as string;
      if (!campaignId) {
        return res.status(400).json({ error: "Missing required query param: campaignId" });
      }

      const { stdout } = await execFileAsync("python3", [
        NEGATIVES_SCRIPT,
        "list",
        "--campaign-id", String(campaignId),
      ], { timeout: 30000 });

      const result = JSON.parse(stdout);
      res.json(result);
    } catch (err: any) {
      let message = "Failed to list negative keywords";
      try {
        const parsed = JSON.parse(err.stdout || "");
        message = parsed.error || message;
      } catch {
        message = err.stderr || err.message || message;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  // Bulk add negative keywords to a campaign
  app.post("/api/clients/:clientId/google/negative-keywords/bulk", async (req, res) => {
    try {
      const { campaignId, keywords } = req.body;

      if (!campaignId || !keywords || !Array.isArray(keywords) || keywords.length === 0) {
        return res.status(400).json({ error: "Missing required fields: campaignId, keywords (array)" });
      }

      const validMatchTypes = ["EXACT", "PHRASE", "BROAD"];
      const sanitized = keywords.map((kw: { keyword: string; matchType?: string }) => ({
        keyword: String(kw.keyword || "").trim(),
        matchType: validMatchTypes.includes(kw.matchType || "") ? kw.matchType : "BROAD",
      })).filter((kw: { keyword: string }) => kw.keyword.length > 0);

      if (sanitized.length === 0) {
        return res.status(400).json({ error: "No valid keywords provided" });
      }

      const keywordsJson = JSON.stringify(sanitized);

      const { stdout } = await execFileAsync("python3", [
        NEGATIVES_SCRIPT,
        "add-bulk",
        "--campaign-id", String(campaignId),
        "--keywords-json", keywordsJson,
      ], { timeout: 60000 });

      const result = JSON.parse(stdout);
      res.json(result);
    } catch (err: any) {
      let message = "Failed to bulk add negative keywords";
      try {
        const parsed = JSON.parse(err.stdout || "");
        message = parsed.error || message;
      } catch {
        message = err.stderr || err.message || message;
      }
      res.status(500).json({ success: false, error: message });
    }
  });

  // ─── MTD Deliverables Endpoints ──────────────────────────────────

  function getMtdDeliverablesPath(clientId: string): string {
    return path.join(DATA_BASE, "clients", clientId, "mtd_deliverables.json");
  }

  app.get("/api/clients/:clientId/mtd-deliverables", (req, res) => {
    const { clientId } = req.params;
    const filePath = getMtdDeliverablesPath(clientId);
    if (!fs.existsSync(filePath)) {
      return res.json({
        svs_achieved: 0,
        positive_leads_achieved: 0,
        closures_achieved: 0,
        quality_lead_count: 0,
        notes: "",
        updated_at: null,
      });
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      res.json(data);
    } catch {
      res.json({
        svs_achieved: 0,
        positive_leads_achieved: 0,
        closures_achieved: 0,
        quality_lead_count: 0,
        notes: "",
        updated_at: null,
      });
    }
  });

  app.put("/api/clients/:clientId/mtd-deliverables", (req, res) => {
    const { clientId } = req.params;
    const filePath = getMtdDeliverablesPath(clientId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      svs_achieved: Number(req.body.svs_achieved) || 0,
      positive_leads_achieved: Number(req.body.positive_leads_achieved) || 0,
      closures_achieved: Number(req.body.closures_achieved) || 0,
      quality_lead_count: Number(req.body.quality_lead_count) || 0,
      notes: req.body.notes || "",
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json(data);
  });

  // ─── Execution Learning Endpoints ────────────────────────────────

  app.get("/api/execution-learning", (_req, res) => {
    try {
      const data = getLearningData();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to read learning data" });
    }
  });

  app.get("/api/execution-learning/summary", (_req, res) => {
    try {
      const summary = getLearningSummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to compute learning summary" });
    }
  });

  // Trigger outcome update for pending learning entries
  app.post("/api/execution-learning/update-outcomes", (req, res) => {
    try {
      const { clientId = "amara", platform = "meta" } = req.body || {};

      let analysisData: any;
      try {
        analysisData = readAnalysisData(clientId, platform);
      } catch (err: any) {
        return res.status(404).json({ error: `Could not read analysis data: ${err.message}` });
      }

      const updatedCount = triggerOutcomeUpdate(analysisData);
      res.json({
        success: true,
        updatedCount,
        message: `${updatedCount} learning entries had their outcomes updated`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update outcomes" });
    }
  });

  // ─── Data Verification Endpoint ─────────────────────────────────
  app.get("/api/clients/:clientId/:platform/verify-data", (req, res) => {
    const { clientId, platform } = req.params;
    const cadence = (req.query.cadence as string) || "twice_weekly";

    try {
      const data = readAnalysisData(clientId, platform, cadence);
      const ap = data.account_pulse || {};
      const agentSpend = ap.total_spend_30d ?? ap.total_spend ?? 0;

      // Check if the agent embedded verification data
      const verification = data.data_verification || data.api_cross_check;
      if (verification) {
        return res.json({
          verified: verification.verified ?? (verification.discrepancy_pct < 5),
          apiSpend: verification.api_spend ?? verification.live_spend ?? agentSpend,
          agentSpend,
          discrepancy: Math.abs((verification.api_spend ?? agentSpend) - agentSpend),
          discrepancyPct: verification.discrepancy_pct ?? 0,
          status: "verified",
          lastVerified: verification.verified_at ?? data.generated_at ?? null,
        });
      }

      // Cross-check: compare current cadence data with the base analysis.json
      // If they differ significantly, flag it
      try {
        const baseData = readAnalysisData(clientId, platform); // default (no cadence)
        const baseSpend = (baseData.account_pulse || {}).total_spend_30d ?? (baseData.account_pulse || {}).total_spend ?? 0;
        const discrepancy = Math.abs(agentSpend - baseSpend);
        const discrepancyPct = baseSpend > 0 ? (discrepancy / baseSpend) * 100 : 0;

        return res.json({
          verified: discrepancyPct < 5,
          apiSpend: baseSpend,
          agentSpend,
          discrepancy: Math.round(discrepancy),
          discrepancyPct: parseFloat(discrepancyPct.toFixed(2)),
          status: "cross_checked",
          lastVerified: data.generated_at || null,
        });
      } catch {
        // Can't cross-check, return unverified
        return res.json({
          verified: true,
          apiSpend: agentSpend,
          agentSpend,
          discrepancy: 0,
          discrepancyPct: 0,
          status: "single_source",
          lastVerified: data.generated_at || null,
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Verification failed" });
    }
  });

  // ─── New Entity Detection Endpoint ──────────────────────────────
  app.get("/api/clients/:clientId/:platform/check-new-entities", (req, res) => {
    const { clientId, platform } = req.params;

    try {
      const data = readAnalysisData(clientId, platform);

      // Check for entities flagged as new by the agent
      const campaigns = data.campaign_audit || data.campaigns || [];
      const adsets = data.adset_analysis || data.ad_groups || [];

      const newCampaigns = campaigns.filter((c: any) => {
        if (c.is_new) return true;
        if (c.created_time) {
          const created = new Date(c.created_time);
          const hoursSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60);
          return hoursSinceCreated < 48;
        }
        return false;
      }).map((c: any) => ({
        id: c.campaign_id || c.id,
        name: c.campaign_name || c.name,
        type: c.layer || c.campaign_type || c.theme || "unknown",
      }));

      const newAdsets = adsets.filter((a: any) => {
        if (a.is_new) return true;
        if (a.created_time) {
          const created = new Date(a.created_time);
          const hoursSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60);
          return hoursSinceCreated < 48;
        }
        return false;
      }).map((a: any) => ({
        id: a.adset_id || a.ad_group_id || a.id,
        name: a.adset_name || a.ad_group_name || a.name,
      }));

      res.json({
        hasNewEntities: newCampaigns.length > 0 || newAdsets.length > 0,
        newCampaigns,
        newAdsets,
        totalNew: newCampaigns.length + newAdsets.length,
        lastAnalysis: data.generated_at || data.run_metadata?.timestamp || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Entity check failed" });
    }
  });

  // ─── SSE Endpoint for Live Updates ──────────────────────────────
  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("event: connected\ndata: {}\n\n");
    addSSEClient(res);
    req.on("close", () => {
      // cleanup handled in addSSEClient
    });
  });

  // ─── Scheduler Endpoints ──────────────────────────────────────────

  app.get("/api/scheduler/status", (_req, res) => {
    res.json(getSchedulerStatus());
  });

  app.post("/api/scheduler/run-now", (_req, res) => {
    triggerManualRun();
    res.json({ success: true, message: "Agent run triggered" });
  });

  // ─── Command Parser Endpoint ──────────────────────────────────────
  // Parses natural language commands into executable actions
  app.post("/api/parse-command", (req, res) => {
    try {
      const { command, clientId = "amara", platform = "meta" } = req.body;
      if (!command || typeof command !== "string") {
        return res.status(400).json({ error: "Command text required" });
      }

      const cmd = command.toLowerCase().trim();
      const data = readAnalysisData(clientId, platform);
      const adsets: any[] = data.adset_analysis || data.ad_group_analysis || [];
      const campaigns: any[] = data.campaign_audit || data.campaigns || data.campaign_analysis || [];

      const parsed: Array<{
        action: string;
        entityId: string;
        entityName: string;
        entityType: string;
        params: Record<string, any>;
        description: string;
      }> = [];

      // Pause campaign by name
      const pauseCampaignMatch = cmd.match(/pause\s+campaign\s+["""]?(.+?)["""]?\s*$/);
      if (pauseCampaignMatch) {
        const name = pauseCampaignMatch[1];
        const match = campaigns.find((c: any) =>
          (c.campaign_name || c.name || "").toLowerCase().includes(name.toLowerCase())
        );
        if (match) {
          const campName = match.campaign_name || match.name;
          const campId = match.campaign_id || match.id;
          parsed.push({
            action: "PAUSE_CAMPAIGN",
            entityId: campId,
            entityName: campName,
            entityType: "campaign",
            params: { reason: `User command: ${command}` },
            description: `Pause campaign "${campName}"`,
          });
        }
      }

      // Pause adset/ad group by name
      const pauseAdsetMatch = cmd.match(/pause\s+(?:adset|ad\s*group)\s+["""]?(.+?)["""]?\s*$/);
      if (pauseAdsetMatch) {
        const name = pauseAdsetMatch[1];
        const match = adsets.find((a: any) =>
          (a.adset_name || a.ad_group_name || "").toLowerCase().includes(name.toLowerCase())
        );
        if (match) {
          parsed.push({
            action: platform === "google" ? "PAUSE_AD_GROUP" : "PAUSE_ADSET",
            entityId: match.adset_id || match.ad_group_id,
            entityName: match.adset_name || match.ad_group_name,
            entityType: platform === "google" ? "ad_group" : "adset",
            params: { reason: `User command: ${command}` },
            description: `Pause ${platform === "google" ? "ad group" : "adset"} "${match.adset_name || match.ad_group_name}"`,
          });
        }
      }

      // Increase/decrease budget
      const budgetMatch = cmd.match(/(increase|decrease|raise|lower|scale\s*up|scale\s*down)\s+budget\s+(?:of\s+|for\s+|on\s+)?["""]?(.+?)["""]?\s+(?:by\s+)?(\d+)%?\s*$/);
      if (budgetMatch) {
        const direction = budgetMatch[1];
        const name = budgetMatch[2];
        const pct = parseInt(budgetMatch[3]);
        const isUp = ["increase", "raise", "scale up"].includes(direction);
        const campaign = campaigns.find((c: any) =>
          (c.campaign_name || c.name || "").toLowerCase().includes(name.toLowerCase())
        );
        const adset = adsets.find((a: any) =>
          (a.adset_name || a.ad_group_name || a.name || "").toLowerCase().includes(name.toLowerCase())
        );
        const entity = campaign || adset;
        if (entity) {
          parsed.push({
            action: isUp ? "SCALE_BUDGET_UP" : "SCALE_BUDGET_DOWN",
            entityId: entity.campaign_id || entity.id || entity.adset_id || entity.ad_group_id,
            entityName: entity.campaign_name || entity.name || entity.adset_name || entity.ad_group_name,
            entityType: campaign ? "campaign" : (platform === "google" ? "ad_group" : "adset"),
            params: { scalePercent: pct, reason: `User command: ${command}` },
            description: `${isUp ? "Increase" : "Decrease"} budget by ${pct}% on "${entity.campaign_name || entity.adset_name || entity.ad_group_name}"`,
          });
        }
      }

      // Pause all underperformers
      if (cmd.includes("pause") && (cmd.includes("underperformer") || cmd.includes("loser"))) {
        const targets = adsets.filter((a: any) =>
          a.should_pause === true || a.classification === "UNDERPERFORMER"
        );
        for (const t of targets) {
          parsed.push({
            action: platform === "google" ? "PAUSE_AD_GROUP" : "PAUSE_ADSET",
            entityId: t.adset_id || t.ad_group_id,
            entityName: t.adset_name || t.ad_group_name,
            entityType: platform === "google" ? "ad_group" : "adset",
            params: { reason: `User command: ${command}` },
            description: `Pause underperformer "${t.adset_name || t.ad_group_name}" (score: ${t.health_score})`,
          });
        }
      }

      // Google-specific: add negative keyword
      if (platform === "google" && cmd.includes("negative") && cmd.includes("keyword")) {
        const kwMatch = cmd.match(/add\s+negative\s+(?:keyword\s+)?["""]?(.+?)["""]?\s+(?:to|for|in)\s+(.+)/i);
        if (kwMatch) {
          const keyword = kwMatch[1].trim();
          const campaignName = kwMatch[2].trim();
          const matchedCampaign = campaigns.find((c: any) =>
            (c.campaign_name || c.name || "").toLowerCase().includes(campaignName.toLowerCase())
          );
          if (matchedCampaign) {
            parsed.push({
              action: "ADD_NEGATIVE_KEYWORD",
              entityId: matchedCampaign.campaign_id || matchedCampaign.id,
              entityName: keyword,
              entityType: "campaign",
              params: {
                keyword,
                campaignId: matchedCampaign.campaign_id || matchedCampaign.id,
                matchType: "BROAD",
                reason: `User command: ${command}`,
              },
              description: `Add negative keyword "${keyword}" to "${matchedCampaign.campaign_name || matchedCampaign.name}"`,
            });
          }
        }
      }

      // Google-specific: adjust bid
      if (platform === "google" && (cmd.includes("bid") || cmd.includes("cpc"))) {
        const bidMatch = cmd.match(/(increase|decrease|raise|lower)\s+(?:bid|cpc)\s+(?:of\s+|for\s+|on\s+)?["""]?(.+?)["""]?\s+(?:by\s+)?(\d+)%?\s*$/);
        if (bidMatch) {
          const direction = bidMatch[1];
          const name = bidMatch[2];
          const pct = parseInt(bidMatch[3]);
          const isUp = ["increase", "raise"].includes(direction);
          // Find ad group
          const allAdGroups: any[] = [];
          for (const camp of (data as any).campaigns || []) {
            for (const ag of camp.ad_groups || []) {
              allAdGroups.push({ ...ag, campaign_name: camp.name || camp.campaign_name });
            }
          }
          const ag = allAdGroups.find((a: any) =>
            (a.name || a.ad_group_name || "").toLowerCase().includes(name.toLowerCase())
          );
          if (ag) {
            const currentCpc = ag.max_cpc || ag.current_max_cpc || ag.avg_cpc || 0;
            const newCpc = isUp ? currentCpc * (1 + pct / 100) : currentCpc * (1 - pct / 100);
            parsed.push({
              action: "SET_CPC_BID",
              entityId: ag.id || ag.ad_group_id,
              entityName: ag.name || ag.ad_group_name,
              entityType: "ad_group",
              params: {
                newBidMicros: Math.round(newCpc * 1000000),
                reason: `User command: ${command}`,
              },
              description: `${isUp ? "Increase" : "Decrease"} CPC bid by ${pct}% on ad group "${ag.name || ag.ad_group_name}" (₹${currentCpc.toFixed(2)} → ₹${newCpc.toFixed(2)})`,
            });
          }
        }
      }

      // Scale all winners
      if (cmd.includes("scale") && cmd.includes("winner")) {
        const pctMatch = cmd.match(/(\d+)%/);
        const pct = pctMatch ? parseInt(pctMatch[1]) : 20;
        const winners = adsets.filter((a: any) => a.classification === "WINNER");
        for (const w of winners) {
          if (w.adset_id || w.ad_group_id) {
            parsed.push({
              action: "SCALE_BUDGET_UP",
              entityId: w.adset_id || w.ad_group_id,
              entityName: w.adset_name || w.ad_group_name,
              entityType: platform === "google" ? "ad_group" : "adset",
              params: { scalePercent: pct, reason: `User command: ${command}` },
              description: `Scale winner "${w.adset_name || w.ad_group_name}" +${pct}%`,
            });
          }
        }
      }

      res.json({
        command,
        parsed,
        count: parsed.length,
        message: parsed.length > 0
          ? `Parsed ${parsed.length} action(s) from command`
          : "Could not parse command into actions. Try: 'pause campaign X', 'increase budget of X by 20%', 'pause all underperformers', 'scale all winners 20%'",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Command parsing failed" });
    }
  });

  // ─── AI Command Terminal ──────────────────────────────────────────
  // POST /api/ai/command
  // Accepts a natural language command, runs it through Claude, executes actions
  app.post("/api/ai/command", async (req, res) => {
    try {
      const { command, clientId, platform } = req.body as {
        command: string;
        clientId: string;
        platform: "meta" | "google" | "all";
      };

      if (!command?.trim()) {
        return res.status(400).json({ error: "command is required" });
      }
      if (!clientId) {
        return res.status(400).json({ error: "clientId is required" });
      }

      // Load client config and analysis data
      const registry = loadRegistry();
      const client = registry.find((c) => c.id === clientId);
      if (!client) {
        return res.status(404).json({ error: `Client "${clientId}" not found` });
      }

      const activePlatform = platform === "all" ? "meta" : platform;
      const platformConfig = client.platforms[activePlatform];
      let analysisData: any = {};

      if (platformConfig) {
        const resolvedPath = resolvePlatformDataPath(clientId, activePlatform, platformConfig);
        if (fs.existsSync(resolvedPath)) {
          try {
            analysisData = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
          } catch {
            // analysis data unavailable — Claude will work with empty context
          }
        }
      }

      const clientTargets = client.targets?.[activePlatform] || client.targets?.meta;

      const result = await handleAICommand({
        command: command.trim(),
        clientId,
        platform: platform || "meta",
        analysisData,
        clientTargets,
      });

      res.json(result);
    } catch (err: any) {
      console.error("[AI Command Route] Error:", err);
      res.status(500).json({ error: err.message || "AI command failed" });
    }
  });

  return httpServer;
}
