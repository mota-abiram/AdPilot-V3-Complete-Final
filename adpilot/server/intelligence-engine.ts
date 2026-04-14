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
  reasoning?: string;        // Full Claude multi-paragraph analysis (root cause + layer breakdown)
  execution_plan?: string[]; // Step-by-step action plan from Claude
  execution_type?: string;   // "auto" | "confirm" | "manual"
  action_type?: string;      // "pause" | "creative_refresh" | "audience_shift" | etc.
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

  // If AI succeeded, populate primary insights from Claude's structured response
  if (hasValidAiResponse) {
    aiResponse!.recommendations.forEach(rec => {
      // Skip generic fallback messages
      if (rec.action === "Clarification needed" && rec.confidence < 0.5) return;

      // Use the action text as the issue title (it's specific, e.g. "Kill Scroll-Ignored Creatives")
      // Use the full reasoning as impact (the GPT-quality analysis)
      // Use the brief action as the recommendation (one-liner the user acts on)
      finalInsights.push({
        issue: rec.action_payload.intent || rec.action || "AI Recommendation",
        impact: rec.action_payload.strategic_rationale || "",
        reasoning: rec.reasoning,                                    // FULL multi-paragraph analysis
        recommendation: rec.action,                                  // brief action one-liner
        execution_plan: rec.action_payload.execution_plan || [],     // step-by-step
        execution_type: rec.execution_type,
        action_type: rec.action_payload.action?.type,
        priority: rec.risk_level === "high" ? "CRITICAL" : rec.risk_level === "medium" ? "HIGH" : "MEDIUM",
        entityId: rec.action_payload.entity_ids?.[0] || undefined,
        entityName: rec.action_payload.filters?.[0]?.value
          ? String(rec.action_payload.filters[0].value)
          : undefined,
        entityType: rec.action_payload.entity_type as any || undefined,
        confidence: rec.confidence,
        source: rec.sop_alignment === "disagrees" ? "MIXED" : "AI"
      });
    });
  }

  // Always augment with SOP insights if they don't overlap significantly or if AI failed
  // FIXED: Duplicate detection now uses entity ID matching instead of fragile substring
  sopInsights.forEach(sop => {
    const isDuplicate = finalInsights.some(fi => {
      // If both have entity IDs, match on entity — much more reliable than string matching
      if (fi.entityId && sop.entityId && fi.entityId === sop.entityId) {
        // Same entity — check if roughly same type of recommendation
        const fiAction = fi.recommendation.toLowerCase();
        const sopAction = sop.recommendation.toLowerCase();
        const bothPause = fiAction.includes("pause") && sopAction.includes("pause");
        const bothScale = fiAction.includes("scale") && sopAction.includes("scale");
        const bothBudget = fiAction.includes("budget") && sopAction.includes("budget");
        return bothPause || bothScale || bothBudget;
      }
      // Fallback: only match if both are account-level AND have similar issue type
      if (!fi.entityId && !sop.entityId && fi.issue && sop.issue) {
        return fi.issue.toLowerCase() === sop.issue.toLowerCase();
      }
      return false;
    });

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
  // ── Step 1: Strip markdown code fences ──────────────────────────────────────
  // Claude-Sonnet wraps JSON in ```json ... ``` despite instructions not to.
  let clean = rawContent.trim();
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    clean = fenceMatch[1].trim();
  } else if (clean.startsWith("```")) {
    // Opening fence present but response was truncated before closing fence
    clean = clean.replace(/^```(?:json)?\s*/i, "").trim();
  }

  // ── Step 2: Clean JSON.parse of the full response ────────────────────────────
  let parsed: any = null;
  try {
    parsed = JSON.parse(clean);
  } catch { /* truncated or malformed — fall through to recovery */ }

  if (parsed && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
    console.log(`[Layer 3: Parser] Clean parse OK. ${parsed.recommendations.length} recommendations.`);
    return {
      recommendations: parsed.recommendations.map(sanitizeRecommendation),
      layer_contributions: parsed.layer_contributions || {},
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  }

  // ── Step 3: Bracket-counting recovery for truncated responses ────────────────
  // When the response is cut off mid-JSON, each recommendation object that was
  // FULLY written before the cut is still valid. Extract them individually.
  const recoveredRecs: any[] = [];
  try {
    const arrayStart = clean.indexOf('"recommendations"');
    if (arrayStart !== -1) {
      const bracketOpen = clean.indexOf('[', arrayStart);
      if (bracketOpen !== -1) {
        let i = bracketOpen + 1;
        const len = clean.length;
        while (i < len) {
          // Skip whitespace and commas between objects
          while (i < len && (',\n\r \t'.includes(clean[i]))) i++;
          if (i >= len || clean[i] === ']') break;
          if (clean[i] !== '{') break;

          // Walk to the matching closing brace
          let depth = 0;
          let inString = false;
          let escape = false;
          const objStart = i;

          for (; i < len; i++) {
            const ch = clean[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) {
                const objStr = clean.slice(objStart, i + 1);
                try { recoveredRecs.push(JSON.parse(objStr)); } catch { /* malformed, skip */ }
                i++;
                break;
              }
            }
          }
          if (depth !== 0) break; // remaining object was truncated — stop
        }
      }
    }
  } catch (e: any) {
    console.warn(`[Layer 3: Parser] Bracket recovery error: ${e.message}`);
  }

  if (recoveredRecs.length > 0) {
    console.warn(`[Layer 3: Parser] Truncation recovery: salvaged ${recoveredRecs.length} complete recommendation(s).`);
    return {
      recommendations: recoveredRecs.map(sanitizeRecommendation),
      layer_contributions: {},
      conflicts: [`Response truncated by token limit. ${recoveredRecs.length} of 5 recommendations recovered.`],
    };
  }

  // ── Step 4: Force-close heuristic ───────────────────────────────────────────
  let forceAttempt = clean;
  for (let i = 0; i < 5; i++) {
    try {
      parsed = JSON.parse(forceAttempt);
      if (parsed && Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
        console.warn(`[Layer 3: Parser] Force-close succeeded on attempt ${i + 1}.`);
        return {
          recommendations: parsed.recommendations.map(sanitizeRecommendation),
          layer_contributions: parsed.layer_contributions || {},
          conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        };
      }
    } catch { /* keep trying */ }
    forceAttempt += "]}";
  }

  // ── Step 5: True fallback — nothing parseable ────────────────────────────────
  console.error(`[Layer 3: Parser] All recovery strategies failed. Raw preview: "${rawContent.substring(0, 300)}..."`);
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
