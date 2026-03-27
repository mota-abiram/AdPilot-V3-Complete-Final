import cron from "node-cron";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { log } from "./index";

const execFileAsync = promisify(execFile);

const ADS_AGENT_DIR = path.resolve(import.meta.dirname, "../../ads_agent");
const DATA_BASE = path.resolve(ADS_AGENT_DIR, "data");
const STATUS_FILE = path.join(DATA_BASE, "scheduler_status.json");

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

function saveStatus(): void {
  const dir = path.dirname(STATUS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(schedulerStatus, null, 2));
}

export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
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

    // Check for Meta and Google V2 agents first
    const metaAgent = path.join(ADS_AGENT_DIR, "meta_ads_agent_v2.py");
    const googleAgent = path.join(ADS_AGENT_DIR, "google_ads_agent_v2.py");

    if (fs.existsSync(metaAgent)) {
      log("Scheduler: Running Meta Ads Agent v2...", "scheduler");
      await execFileAsync("python3", [metaAgent], {
        cwd: ADS_AGENT_DIR,
        timeout: 600000, // 10 min
      });
    }

    if (fs.existsSync(googleAgent)) {
      log("Scheduler: Running Google Ads Agent v2...", "scheduler");
      await execFileAsync("python3", [googleAgent], {
        cwd: ADS_AGENT_DIR,
        timeout: 600000, // 10 min
      });
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
    const duration = Date.now() - startTime;
    schedulerStatus.lastRun = new Date().toISOString();
    schedulerStatus.lastRunSuccess = false;
    schedulerStatus.lastRunDuration = duration;
    schedulerStatus.lastError = err.message || "Unknown error";
    schedulerStatus.isRunning = false;

    schedulerStatus.runHistory.unshift({
      timestamp: schedulerStatus.lastRun,
      success: false,
      duration,
      error: err.message,
    });
    if (schedulerStatus.runHistory.length > 30) {
      schedulerStatus.runHistory = schedulerStatus.runHistory.slice(0, 30);
    }

    saveStatus();
    log(`Scheduler: Agent run failed: ${err.message}`, "scheduler");

    broadcastSSE("agent-run-failed", {
      timestamp: new Date().toISOString(),
      error: err.message,
    });
  }
}

export function triggerManualRun(): void {
  runAgent().catch((err) => log(`Manual run error: ${err.message}`, "scheduler"));
}

export function initScheduler(): void {
  loadStatus();

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
