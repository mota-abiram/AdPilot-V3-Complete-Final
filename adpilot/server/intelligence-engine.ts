import { assembleContext, type QueryType } from "./context-assembler";
import { callClaude, isClaudeAvailable, type ClaudeModelTier, type ClaudeResponse } from "./claude-provider";
import { analyzeSop, type SopInsight } from "./sop-engine";
import {
  buildStrategicPrompt,
  buildRecommendationPrompt,
  type AdCortexRecommendation,
  type AdCortexResponse,
} from "./prompt-templates";

// ─── Types ────────────────────────────────────────────────────────

export interface IntelligenceQuery {
  type: QueryType;
  clientId: string;
  platform: "meta" | "google" | "all";
  message?: string;
  analysisData?: any;
  conversationHistory?: string[];
  /** Alert context: when the pipeline is triggered by a specific alert, pass the problem
   *  statement and live metrics so the prompt is tailored to that exact issue. */
  alertContext?: {
    problem: string;
    metric?: string;
    metrics?: Record<string, string | number>;
  };
}

export interface StandardizedInsight {
  issue: string;
  impact: string;
  recommendation: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  entityId?: string;
  entityName?: string;
  entityType?: string;
  confidence: number;
  source: "SOP" | "AI" | "MIXED";
}

export interface IntelligenceResult {
  insights: StandardizedInsight[];
  recommendations: AdCortexRecommendation[];
  layer_contributions: Record<string, any>;
  conflicts: string[];
  humanResponse: string;
  modelUsed: string;
  trace: {
    layer1: any;
    layer2: any;
    layer3: any;
    layer4: any;
  };
}

// ─── Main Pipeline Service ──────────────────────────────────────────

/**
 * 4-Layer Intelligence Pipeline
 * 1. Layer 1: Data Preparation
 * 2. Layer 2: SOP Deterministic Analysis
 * 3. Layer 3: Claude AI Strategic Reasoning
 * 4. Layer 4: Final Output Formatter & Validation
 */
export async function insightsEngine(query: IntelligenceQuery): Promise<IntelligenceResult> {
  const { clientId, platform } = query;
  console.log(`\x1b[35m[AdCortex Pipeline] Initializing for ${clientId}/${platform}...\x1b[0m`);

  // --- LAYER 1: DATA PREPARATION ---
  const ctx = await assembleContext(clientId, platform, query.type || "recommendation", query.analysisData);
  const layer1Data = {
    clientTargets: ctx.layer1.clientTargets,
    platform: ctx.layer2.platformContext,
    recordCount: (ctx.layer2.analysisData.campaign_audit || []).length
  };
  console.log(`[Layer 1: Data] Cleaned. Targets: ₹${layer1Data.clientTargets.cpl || 'N/A'} CPL`);

  // --- LAYER 2: SOP ANALYSIS (Deterministic) ---
  const sopInsights = analyzeSop(ctx.layer2.analysisData, ctx.layer1.clientTargets, platform);
  console.log(`[Layer 2: SOP] Generated ${sopInsights.length} rule-based insights.`);

  // --- LAYER 3: CLAUDE AI REASONING ---
  let aiResponse: AdCortexResponse | null = null;
  let modelUsed = "none";
  let humanResponse = "";
  
  if (isClaudeAvailable()) {
    const modelTier: ClaudeModelTier = query.type === "strategic_analysis" ? "opus" : "sonnet";
    const prompt = buildPromptForQuery(query, ctx, sopInsights);
    
    try {
      const claude = await callClaude({
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        modelTier,
      });
      modelUsed = claude.model;
      aiResponse = parseAdCortexResponse(claude.content);
      humanResponse = formatHumanResponse(aiResponse);
      console.log(`[Layer 3: AI] Reasoning complete via ${modelUsed}.`);
    } catch (err: any) {
      console.error(`[Layer 3: AI] Failed: ${err.message}. Falling back to SOP.`);
      humanResponse = `Strategic AI layer encountered an error: ${err.message}. Displaying SOP-based deterministic insights instead.`;
    }
  } else {
    console.log(`[Layer 3: AI] Claude unavailable. Skipping reasoning layer.`);
    humanResponse = "AI Reasoning layer skipped (No API Key). Displaying SOP-based insights.";
  }

  // --- LAYER 4: FINAL FORMATTER & VALIDATION ---
  const finalInsights: StandardizedInsight[] = [];
  const hasValidAiResponse = aiResponse && aiResponse.recommendations.length > 0 && !aiResponse.conflicts.includes("Claude response parsing failed");

  // If AI succeeded, populate primary insights
  if (hasValidAiResponse) {
    aiResponse!.recommendations.forEach(rec => {
      // Skip generic fallback messages
      if (rec.action === "Clarification needed" && rec.confidence < 0.5) return;

      finalInsights.push({
        issue: rec.action_payload.intent || "AI Recommendation",
        impact: rec.action_payload.strategic_rationale || rec.reasoning,
        recommendation: rec.action,
        priority: rec.risk_level === "high" ? "CRITICAL" : rec.risk_level === "medium" ? "HIGH" : "MEDIUM",
        entityName: rec.action_payload.filters?.[0]?.value ? String(rec.action_payload.filters[0].value) : undefined,
        confidence: rec.confidence,
        source: "AI"
      });
    });
  }

  // Always augment with SOP insights if they don't overlap significantly or if AI failed
  sopInsights.forEach(sop => {
    const isDuplicate = finalInsights.some(fi => 
      fi.recommendation.toLowerCase().includes(sop.recommendation.toLowerCase().substring(0, 20)) ||
      sop.recommendation.toLowerCase().includes(fi.recommendation.toLowerCase().substring(0, 20))
    );

    if (!isDuplicate || !hasValidAiResponse) {
      finalInsights.push({
        issue: sop.issue,
        impact: sop.impact,
        recommendation: sop.recommendation,
        priority: sop.priority,
        entityId: sop.entityId,
        entityName: sop.entityName,
        entityType: sop.entityType,
        confidence: 0.9,
        source: "SOP"
      });
    }
  });

  // Sort by priority and then confidence
  const priorityMap = { "CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1 };
  finalInsights.sort((a, b) => {
    const pDiff = (priorityMap[b.priority] || 0) - (priorityMap[a.priority] || 0);
    if (pDiff !== 0) return pDiff;
    return b.confidence - a.confidence;
  });

  console.log(`[Layer 4: Output] Pipeline complete. Returning ${finalInsights.length} validated insights (AI: ${hasValidAiResponse ? 'YES' : 'FALLBACK'}).`);

  return {
    insights: finalInsights,
    recommendations: aiResponse?.recommendations || [],
    layer_contributions: aiResponse?.layer_contributions || { sop_fallback: true },
    conflicts: aiResponse?.conflicts || [],
    humanResponse,
    modelUsed,
    trace: {
      layer1: layer1Data,
      layer2: sopInsights,
      layer3: aiResponse ? "Claude reasoning executed" : "AI layer failed or skipped",
      layer4: finalInsights
    }
  };
}

function buildPromptForQuery(query: IntelligenceQuery, ctx: any, sopInsights: SopInsight[]) {
  const base = query.type === "strategic_analysis"
    ? buildStrategicPrompt(ctx)
    : buildRecommendationPrompt(ctx, query.alertContext);

  // Inject SOP deterministic findings as the "available SOPs" for Layer 2 filtering.
  // Each entry shows the issue, its impact, and the raw SOP recommendation so Claude
  // can select only relevant ones and enhance them — rather than accepting them blindly.
  const sopBlock = sopInsights.length > 0
    ? `\n\n--------------------------------------------------\n📋 AVAILABLE SOPs (deterministic Layer 2 findings — use ONLY what is relevant to the problem above):\n--------------------------------------------------\n${sopInsights.map((s, i) => `${i + 1}. [${s.priority}] Issue: "${s.issue}"${s.entityName ? ` → Entity: "${s.entityName}"` : ""}\n   Impact: ${s.impact}\n   Raw SOP Action: ${s.recommendation}`).join("\n\n")}\n\nNow apply the 4-layer pipeline strictly. Reject SOPs unrelated to the problem. Enhance the relevant ones with account-specific data.`
    : "";

  return {
    system: base.system,
    user: base.user + sopBlock,
  };
}

export async function processQuery(query: IntelligenceQuery): Promise<IntelligenceResult> {
  return insightsEngine(query);
}

function parseAdCortexResponse(rawContent: string): AdCortexResponse {
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawContent.trim());
  } catch {
    const jsonBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonBlockMatch) {
      try { parsed = JSON.parse(jsonBlockMatch[1].trim()); } catch {}
    }
  }

  if (!parsed) {
    const braceMatch = rawContent.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { parsed = JSON.parse(braceMatch[0]); } catch {}
    }
  }

  if (parsed && Array.isArray(parsed.recommendations)) {
    return {
      recommendations: parsed.recommendations.map(sanitizeRecommendation),
      layer_contributions: parsed.layer_contributions || {},
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  }
  return buildFallbackResponse(rawContent);
}

function sanitizeRecommendation(rec: any, index: number): AdCortexRecommendation {
  return {
    rank: rec.rank ?? index + 1,
    action: rec.action || "Unknown action",
    confidence: typeof rec.confidence === "number" ? Math.max(0, Math.min(1, rec.confidence)) : 0.5,
    source_layers: Array.isArray(rec.source_layers) ? rec.source_layers : ["layer2"],
    sop_alignment: ["agrees", "disagrees", "extends"].includes(rec.sop_alignment) ? rec.sop_alignment : "agrees",
    reasoning: rec.reasoning || "No reasoning provided",
    execution_type: ["auto", "manual", "confirm"].includes(rec.execution_type) ? rec.execution_type : "manual",
    risk_level: ["low", "medium", "high"].includes(rec.risk_level) ? rec.risk_level : "medium",
    action_payload: sanitizeActionPayload(rec.action_payload),
  };
}

function sanitizeActionPayload(payload: any): AdCortexRecommendation["action_payload"] {
  if (!payload || typeof payload !== "object") {
    return {
      intent: "Unknown intent",
      action: { type: "clarify", parameters: { reason: "Could not parse action payload" } },
    };
  }
  return {
    intent: payload.intent || "Interpreted action",
    platform: payload.platform,
    filters: Array.isArray(payload.filters) ? payload.filters : [],
    action: payload.action || { type: "clarify", parameters: {} },
    execution_plan: Array.isArray(payload.execution_plan) ? payload.execution_plan : [],
    strategic_rationale: payload.strategic_rationale || "",
    risk_checks: Array.isArray(payload.risk_checks) ? payload.risk_checks : [],
  };
}

function buildFallbackResponse(rawContent: string): AdCortexResponse {
  const isClarity = rawContent.toLowerCase().includes("clarif");
  return {
    recommendations: [{
      rank: 1,
      action: isClarity ? "Clarification needed" : "Review analysis",
      confidence: 0.3,
      source_layers: ["layer2"],
      sop_alignment: "agrees",
      reasoning: rawContent.substring(0, 500),
      execution_type: "manual",
      risk_level: "low",
      action_payload: {
        intent: "Fallback — Claude response was not structured JSON",
        action: { type: "clarify", parameters: { reason: "Response could not be parsed into action format" } },
      },
    }],
    layer_contributions: { note: "Parse failure. Check reasoning." },
    conflicts: ["Claude response parsing failed"],
  };
}

function formatHumanResponse(result: AdCortexResponse): string {
  if (result.recommendations.length === 0) return "No specific recommendations generated.";
  const primary = result.recommendations[0];
  let response = primary.reasoning;
  if (primary.action_payload.action?.type && primary.action_payload.action.type !== "clarify") {
    const planSteps = primary.action_payload.execution_plan || [];
    if (planSteps.length > 0) response += "\n\n📋 Execution Plan:\n" + planSteps.map((s) => `• ${s}`).join("\n");
  }
  return response;
}
