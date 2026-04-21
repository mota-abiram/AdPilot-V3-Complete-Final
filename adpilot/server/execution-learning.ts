/**
 * Execution Learning Engine
 *
 * Tracks the outcomes of executed actions (pause, scale, etc.) by capturing
 * "before" metrics at execution time and "after" metrics on subsequent checks.
 * Determines whether each action had a POSITIVE, NEGATIVE, or NEUTRAL outcome.
 *
 * Storage: /home/user/workspace/ads_agent/data/execution_learning.json
 */

import fs from "fs";
import path from "path";
import { db } from "./db";
import { executionLearnings, type ExecutionLearning } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { updateSmartOutcomes } from "./outcome-analyzer";

/**
 * Helper to extract metrics for a specific entity from analysis data.
 */
function findEntityMetrics(
  analysisData: any,
  entityId: string,
  entityType: string
): any | null {
  if (!analysisData) return null;
  
  if (entityType === "campaign") {
    const match = (analysisData.campaign_audit || analysisData.campaign_analysis || []).find(
      (c: any) => c.campaign_id === entityId || c.id === entityId
    );
    if (match) return { spend: match.spend, leads: match.leads || match.conversions, cpl: match.cpl, ctr: match.ctr, impressions: match.impressions };
  }
  
  if (entityType === "adset" || entityType === "ad_group") {
     const adsets = analysisData.adset_analysis || analysisData.ad_group_analysis || [];
     const match = adsets.find((a: any) => a.adset_id === entityId || a.ad_group_id === entityId || a.id === entityId);
     if (match) return { spend: match.spend, leads: match.leads || match.conversions, cpl: match.cpl, ctr: match.ctr, impressions: match.impressions };
  }

  if (entityType === "ad") {
    const match = (analysisData.creative_health || analysisData.ad_analysis || []).find((a: any) => a.ad_id === entityId || a.id === entityId);
    if (match) return { spend: match.spend, leads: match.leads || match.conversions, cpl: match.cpl, ctr: match.ctr, impressions: match.impressions };
  }
  
  return null;
}

// ─── Configuration ────────────────────────────────────────────────

const DATA_BASE = path.resolve(import.meta.dirname, "../../ads_agent/data");
const LEARNING_PATH = path.join(DATA_BASE, "execution_learning.json");
const META_LEARNING_HISTORY_PATH = path.join(DATA_BASE, "learning_history.json");
const GOOGLE_LEARNING_HISTORY_PATH = path.join(DATA_BASE, "google_learning_history.json");

// ─── Types ────────────────────────────────────────────────────────

export interface LearningEntry {
  executionId: string;
  clientId?: string;
  platform?: "meta" | "google";
  entityId: string;
  entityName: string;
  entityType: string;
  action: string;
  executedAt: string;
  requestedByName?: string;
  reason?: string;
  strategicCall?: string;
  beforeMetrics: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    impressions: number;
  };
  afterMetrics?: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    impressions: number;
    measuredAt: string;
  };
  outcome?: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "PENDING";
  outcomeReason?: string;
  daysElapsed?: number;
}

interface StrategicLearningInput {
  id: string;
  executionId: string;
  clientId: string;
  platform: "meta" | "google";
  entityId: string;
  entityName: string;
  entityType: string;
  action: string;
  requestedByName?: string;
  reason?: string;
  strategicCall?: string;
  recordedAt: string;
  source: "user_strategy";
}

export interface LearningSummary {
  totalActions: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  pendingCount: number;
  positiveRate: number;
  patterns: string[];
}

// ─── Storage ──────────────────────────────────────────────────────

function readLearningData(): LearningEntry[] {
  if (!fs.existsSync(LEARNING_PATH)) return [];
  try {
    const raw = fs.readFileSync(LEARNING_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLearningData(entries: LearningEntry[]): void {
  const dir = path.dirname(LEARNING_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEARNING_PATH, JSON.stringify(entries, null, 2));
}

function readAgentLearningHistory(platform: "meta" | "google"): any {
  const targetPath = platform === "google" ? GOOGLE_LEARNING_HISTORY_PATH : META_LEARNING_HISTORY_PATH;
  if (!fs.existsSync(targetPath)) {
    return platform === "google"
      ? { runs: [], patterns: [], actions: [], strategic_inputs: [] }
      : { runs: [], patterns: [], fatigue_timelines: {}, audience_saturation: {}, strategic_inputs: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
  } catch {
    return platform === "google"
      ? { runs: [], patterns: [], actions: [], strategic_inputs: [] }
      : { runs: [], patterns: [], fatigue_timelines: {}, audience_saturation: {}, strategic_inputs: [] };
  }
}

function writeAgentLearningHistory(platform: "meta" | "google", payload: any): void {
  const targetPath = platform === "google" ? GOOGLE_LEARNING_HISTORY_PATH : META_LEARNING_HISTORY_PATH;
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2));
}

function appendStrategicInputToAgentHistory(entry: LearningEntry): void {
  if (!entry.clientId || !entry.platform) return;
  if (!entry.reason && !entry.strategicCall) return;

  const learningHistory = readAgentLearningHistory(entry.platform);
  const strategicInputs: StrategicLearningInput[] = Array.isArray(learningHistory.strategic_inputs)
    ? learningHistory.strategic_inputs
    : [];

  strategicInputs.unshift({
    id: `${entry.executionId}:strategy`,
    executionId: entry.executionId,
    clientId: entry.clientId,
    platform: entry.platform,
    entityId: entry.entityId,
    entityName: entry.entityName,
    entityType: entry.entityType,
    action: entry.action,
    requestedByName: entry.requestedByName,
    reason: entry.reason,
    strategicCall: entry.strategicCall,
    recordedAt: entry.executedAt,
    source: "user_strategy",
  });

  learningHistory.strategic_inputs = strategicInputs.slice(0, 250);
  writeAgentLearningHistory(entry.platform, learningHistory);
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Record an execution with "before" metrics captured from current analysis data.
 * Redirected to PostgreSQL-backed ExecutionLearnings table.
 */
export async function recordExecution(
  executionId: string,
  clientId: string,
  platform: "meta" | "google",
  entityId: string,
  entityName: string,
  entityType: string,
  action: string,
  reason: string | undefined,
  analysisData: any,
  strategicCall?: string,
  requestedByName?: string
) {
  const beforeMetrics = findEntityMetrics(analysisData, entityId, entityType) || {
    spend: 0,
    leads: 0,
    cpl: 0,
    ctr: 0,
    impressions: 0,
  };

  const [entry] = await db.insert(executionLearnings).values({
    clientId,
    platform,
    entityId,
    entityName,
    entityType,
    action,
    executedAt: new Date(),
    strategicRationale: strategicCall || reason,
    beforeMetrics,
    status: "PENDING_PRIMARY",
    outcome: "PENDING"
  }).returning();

  console.log(`[Smart Engine] Recorded execution for ${entityName} (${action})`);
  return entry;
}

/**
 * Update outcomes for pending entries using fresh analysis data.
 * Redirected to Stage 1 Outcome Analyzer.
 */
export async function updateOutcomes(analysisData: any): Promise<void> {
  await updateSmartOutcomes(analysisData);
}

/**
 * Trigger an outcome update and return the count of entries that were updated.
 */
export async function triggerOutcomeUpdate(analysisData: any): Promise<number> {
  const before = await db.select({ count: sql<number>`count(*)` })
    .from(executionLearnings)
    .where(eq(executionLearnings.outcome, "PENDING"));
    
  await updateOutcomes(analysisData);

  const after = await db.select({ count: sql<number>`count(*)` })
    .from(executionLearnings)
    .where(eq(executionLearnings.outcome, "PENDING"));

  return (before[0]?.count || 0) - (after[0]?.count || 0);
}

/**
 * Get all learning entries from DB.
 */
export async function getLearningData(): Promise<any[]> {
  return await db.select()
    .from(executionLearnings)
    .orderBy(desc(executionLearnings.executedAt))
    .limit(500);
}

/**
 * Get aggregate summary of learning outcomes.
 * Pulls from DB and computes patterns based on AI analysis.
 */
export async function getLearningSummary(): Promise<any> {
  const entries = await db.select().from(executionLearnings);
  const total = entries.length;
  const positive = entries.filter((e) => e.outcome === "POSITIVE").length;
  const negative = entries.filter((e) => e.outcome === "NEGATIVE").length;
  const neutral = entries.filter((e) => e.outcome === "NEUTRAL").length;
  const pending = entries.filter((e) => e.outcome?.startsWith("PENDING")).length;

  const patterns: string[] = [];
  
  // Extract patterns from AI analysis reasoning if possible
  const successfulAnalyses = entries.filter(e => e.aiAnalysis?.reasoning);
  // Simple extraction for now, usually Stage 3 Synthesis would build this more elegantly
  if (successfulAnalyses.length > 0) {
    patterns.push(`Detected ${positive} high-confidence positive outcomes across ${total} automated actions.`);
  }

  return {
    totalEntries: total,
    outcomes: {
      POSITIVE: positive,
      NEGATIVE: negative,
      NEUTRAL: neutral,
      PENDING: pending,
    },
    patterns,
    totalActions: total,
    positiveCount: positive,
    negativeCount: negative,
    neutralCount: neutral,
    pendingCount: pending,
    positiveRate: total > 0 ? positive / total : 0,
  };
}
