/**
 * Outcome Analyzer — Mojo AdCortex 
 * 
 * Orchestrates the 3-stage Smart Outcomes Engine:
 * Stage 1: Smart Measurement Windows (deterministic)
 * Stage 2: AI-Powered Outcome Analysis (Claude)
 * Stage 3: Cross-Cutting Pattern Synthesis
 */

import { db } from "./db";
import { executionLearnings, executionLogs, type ExecutionLearning } from "@shared/schema";
import { eq, and, lte, or, desc, inArray } from "drizzle-orm";
import { OUTCOME_ANALYSIS_SYSTEM_PROMPT } from "./outcome-prompt";
import { callAi as callClaude } from "./ai-provider";

// ─── Stage 1: Measurement Window Registry ───────────────────────────

interface WindowConfig {
  minHours: number;
  primaryDays: number;
  extendedDays: number;
}

const ACTION_WINDOWS: Record<string, WindowConfig> = {
  "PAUSE": { minHours: 48, primaryDays: 3, extendedDays: 7 },
  "SCALE": { minHours: 72, primaryDays: 7, extendedDays: 14 },
  "UNPAUSE": { minHours: 48, primaryDays: 5, extendedDays: 10 },
  "ENABLE": { minHours: 48, primaryDays: 5, extendedDays: 10 },
  "BID_CHANGE": { minHours: 48, primaryDays: 5, extendedDays: 7 },
  "CREATIVE_REFRESH": { minHours: 72, primaryDays: 5, extendedDays: 10 },
  "DEFAULT": { minHours: 72, primaryDays: 5, extendedDays: 10 },
};

function getWindow(action: string): WindowConfig {
  const baseAction = action.split("_")[0]; // e.g. "PAUSE_ADSET" -> "PAUSE"
  return ACTION_WINDOWS[baseAction] || ACTION_WINDOWS["DEFAULT"];
}

// ─── Stage 2: AI Outcome Analysis ───────────────────────────────────

/**
 * Gather confounding factors (concurrent actions) for a learning entry.
 */
async function buildCausalContext(entry: ExecutionLearning): Promise<string[]> {
  const window = getWindow(entry.action);
  const startDate = new Date(entry.executedAt!);
  const endDate = new Date(startDate.getTime() + window.primaryDays * 24 * 60 * 60 * 1000);

  const concurrentActions = await db.select()
    .from(executionLogs)
    .where(and(
      eq(executionLogs.clientId, entry.clientId),
      lte(executionLogs.createdAt, endDate),
      // We look for actions taken AFTER this one but during the evaluation window
      desc(executionLogs.createdAt)
    ))
    .limit(10);

  return concurrentActions
    .filter(log => log.id !== entry.id.toString()) // Don't include itself
    .map(log => `${log.actionType} on ${log.campaignIds} (${new Date(log.createdAt!).toLocaleDateString()})`);
}

/**
 * Perform AI analysis on a single ready-to-evaluate entry.
 */
export async function performAIOutcomeAnalysis(entry: ExecutionLearning, currentAnalysisData: any) {
  const confoundingFactors = await buildCausalContext(entry);
  
  const userPrompt = `
  EVALUATE THIS ACTION:
  Action: ${entry.action}
  Entity: ${entry.entityName} (${entry.entityType})
  Executed At: ${entry.executedAt?.toISOString()}
  Strategic Rationale: ${entry.strategicRationale || "None provided"}

  METRIC SNAPSHOTS:
  Before (T-0): ${JSON.stringify(entry.beforeMetrics)}
  Primary (T+Window): ${JSON.stringify(entry.primaryMetrics)}
  ${entry.extendedMetrics ? `Extended (T+Extended): ${JSON.stringify(entry.extendedMetrics)}` : ""}

  ACCOUNT CONTEXT:
  Current Account CPL: ${currentAnalysisData?.account_pulse?.overall_cpl}
  Current Account Spend: ${currentAnalysisData?.account_pulse?.total_spend}
  Concurrent Actions (Causal Isolation):
  ${confoundingFactors.length > 0 ? confoundingFactors.map(f => `- ${f}`).join("\n") : "No other major actions detected in this window."}

  Provide a detailed evaluation based on the Action-Specific Verdict Scorecard.
  `;

  try {
    const response = await callClaude({
      systemPrompt: OUTCOME_ANALYSIS_SYSTEM_PROMPT,
      userMessage: userPrompt,
      modelTier: "sonnet"
    });

    const analysis = JSON.parse(response.content);
    
    // Update the record with Claude's findings
    await db.update(executionLearnings)
      .set({
        outcome: analysis.outcome,
        aiAnalysis: {
          reasoning: analysis.reasoning,
          confidence: analysis.confidence,
          confoundingFactors: analysis.confoundingFactors,
          counterfactualImpact: analysis.counterfactualImpact
        },
        estimatedImpact: analysis.estimatedImpactValue,
        chronicFlag: analysis.chronicFlag,
        status: entry.status === "PENDING_PRIMARY" ? "PENDING_EXTENDED" : "COMPLETED",
        updatedAt: new Date()
      })
      .where(eq(executionLearnings.id, entry.id));

    return analysis;
  } catch (err) {
    console.error(`[Outcome Analyzer] Analysis failed for entry #${entry.id}:`, err);
    return null;
  }
}

/**
 * Stage 1 Orchestrator: Identifies entries ready for evaluation.
 */
export async function updateSmartOutcomes(analysisData: any) {
  const now = new Date();

  // 1. Find entries ready for PRIMARY evaluation
  const pendingPrimary = await db.select()
    .from(executionLearnings)
    .where(eq(executionLearnings.status, "PENDING_PRIMARY"));

  for (const entry of pendingPrimary) {
    const config = getWindow(entry.action);
    const msElapsed = now.getTime() - new Date(entry.executedAt!).getTime();
    
    if (msElapsed >= config.minHours * 60 * 60 * 1000) {
      // Capture primary metrics from analysisData if available
      const metrics = findEntityMetrics(analysisData, entry.entityId, entry.entityType);
      if (metrics) {
        await db.update(executionLearnings)
          .set({ 
            primaryMetrics: metrics,
            status: "PENDING_EXTENDED" // Move to next stage immediately after capturing
          })
          .where(eq(executionLearnings.id, entry.id));
        
        // Trigger Stage 2 Analysis
        const updatedEntry = { ...entry, primaryMetrics: metrics, status: "PENDING_EXTENDED" };
        await performAIOutcomeAnalysis(updatedEntry as ExecutionLearning, analysisData);
      }
    }
  }

  // 2. Find entries ready for EXTENDED evaluation
  const pendingExtended = await db.select()
    .from(executionLearnings)
    .where(eq(executionLearnings.status, "PENDING_EXTENDED"));

  for (const entry of pendingExtended) {
    const config = getWindow(entry.action);
    const msSincePrimary = now.getTime() - new Date(entry.executedAt!).getTime();
    
    if (msSincePrimary >= config.extendedDays * 24 * 60 * 60 * 1000) {
       const metrics = findEntityMetrics(analysisData, entry.entityId, entry.entityType);
       if (metrics) {
         await db.update(executionLearnings)
           .set({ 
             extendedMetrics: metrics,
             status: "PENDING_30D" // We keep track for the high-level strategic 30d re-eval
           })
           .where(eq(executionLearnings.id, entry.id));
         
         // Trigger re-analysis with extended data
         const updatedEntry = { ...entry, extendedMetrics: metrics, status: "PENDING_30D" };
         await performAIOutcomeAnalysis(updatedEntry as ExecutionLearning, analysisData);
       }
    }
  }
}

// ─── Helper function replicated from execution-learning ─────────────

function findEntityMetrics(
  analysisData: any,
  entityId: string,
  entityType: string
): any | null {
  if (!analysisData) return null;
  // Replicating findEntityMetrics logic for the new orchestrator
  // In production, we'd refactor this into a shared utils file.
  
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
