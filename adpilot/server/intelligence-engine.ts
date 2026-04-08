/**
 * Intelligence Engine — Mojo AdCortex Orchestrator
 *
 * Core function: processQuery()
 *
 * Pipeline:
 *   1. Assemble 4-layer context
 *   2. Route to appropriate Claude model (Opus for strategic, Sonnet for commands)
 *   3. Build structured prompt
 *   4. Call Claude
 *   5. Parse JSON safely
 *   6. Apply guardrails (fallback if parsing fails)
 *   7. Return structured response
 */

import { assembleContext, type QueryType } from "./context-assembler";
import { callClaude, isClaudeAvailable, type ClaudeModelTier, type ClaudeResponse } from "./claude-provider";
import {
  buildStrategicPrompt,
  buildRecommendationPrompt,
  buildTerminalPrompt,
  type AdCortexRecommendation,
  type AdCortexResponse,
} from "./prompt-templates";

// ─── Types ────────────────────────────────────────────────────────

export interface IntelligenceQuery {
  type: QueryType;
  clientId: string;
  platform: "meta" | "google" | "all";
  message: string;
  analysisData?: any;
  conversationHistory?: string[];
}

export interface IntelligenceResult {
  recommendations: AdCortexRecommendation[];
  layer_contributions: Record<string, any>;
  conflicts: string[];
  humanResponse: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
}

// ─── Model Routing ────────────────────────────────────────────────

function routeModel(queryType: QueryType): ClaudeModelTier {
  switch (queryType) {
    case "strategic_analysis":
      return "opus";
    case "command":
    case "recommendation":
    case "insight":
    default:
      return "sonnet";
  }
}

// ─── Prompt Routing ───────────────────────────────────────────────

function buildPromptForQuery(
  query: IntelligenceQuery,
  ctx: Awaited<ReturnType<typeof assembleContext>>
): { system: string; user: string } {
  switch (query.type) {
    case "strategic_analysis":
      return buildStrategicPrompt(ctx);
    case "recommendation":
      return buildRecommendationPrompt(ctx);
    case "command":
    default:
      return buildTerminalPrompt(ctx, query.message, query.conversationHistory);
  }
}

// ─── JSON Parser with Guardrails ──────────────────────────────────

function parseAdCortexResponse(rawContent: string): AdCortexResponse {
  // Try direct JSON parse first
  let parsed: any = null;

  try {
    parsed = JSON.parse(rawContent.trim());
  } catch {
    // Try extracting JSON from code block (```json ... ```)
    const jsonBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonBlockMatch) {
      try {
        parsed = JSON.parse(jsonBlockMatch[1].trim());
      } catch {}
    }
  }

  // If still not parsed, try finding first { ... } block
  if (!parsed) {
    const braceMatch = rawContent.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        parsed = JSON.parse(braceMatch[0]);
      } catch {}
    }
  }

  // Validate structure
  if (parsed && Array.isArray(parsed.recommendations)) {
    return {
      recommendations: parsed.recommendations.map(sanitizeRecommendation),
      layer_contributions: parsed.layer_contributions || {},
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  }

  // Complete parse failure — return safe empty
  console.warn("[AdCortex] Failed to parse Claude response as structured JSON. Falling back to raw text extraction.");
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
  // Extract what we can from non-JSON response
  const isClarity = rawContent.toLowerCase().includes("clarif") || rawContent.toLowerCase().includes("could you");

  return {
    recommendations: [
      {
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
      },
    ],
    layer_contributions: {
      note: "Response was not in expected JSON format. Raw text was preserved in reasoning.",
    },
    conflicts: ["Claude response was not valid JSON — human review recommended"],
  };
}

// ─── Human Response Formatter ─────────────────────────────────────

function formatHumanResponse(result: AdCortexResponse): string {
  if (result.recommendations.length === 0) {
    return "I analysed your request but couldn't generate specific recommendations. Please try rephrasing your command.";
  }

  const primary = result.recommendations[0];

  // Build response
  let response = primary.reasoning;

  // Add action summary
  if (primary.action_payload.action?.type && primary.action_payload.action.type !== "clarify") {
    const actionType = primary.action_payload.action.type;
    const planSteps = primary.action_payload.execution_plan || [];
    if (planSteps.length > 0) {
      response += "\n\n📋 Execution Plan:\n" + planSteps.map((s) => `• ${s}`).join("\n");
    }
    if (primary.action_payload.strategic_rationale) {
      response += `\n\n💡 ${primary.action_payload.strategic_rationale}`;
    }
  }

  // Add layer conflict warnings
  if (result.conflicts.length > 0) {
    response += "\n\n⚠️ Layer Conflicts:\n" + result.conflicts.map((c) => `• ${c}`).join("\n");
  }

  // Note additional recommendations
  if (result.recommendations.length > 1) {
    response += `\n\n📊 ${result.recommendations.length - 1} additional recommendation${result.recommendations.length > 2 ? "s" : ""} available.`;
  }

  return response;
}

// ─── Main Export ───────────────────────────────────────────────────

/**
 * Process an intelligence query through the full AdCortex pipeline.
 *
 * Pipeline: Assemble Context → Route Model → Build Prompt → Call Claude → Parse → Guardrail
 */
export async function processQuery(query: IntelligenceQuery): Promise<IntelligenceResult> {
  // Pre-flight check
  if (!isClaudeAvailable()) {
    return {
      recommendations: [],
      layer_contributions: {},
      conflicts: [],
      humanResponse: "Mojo AdCortex requires a valid ANTHROPIC_API_KEY. Please configure it in Settings → AI Configuration.",
      modelUsed: "none",
      inputTokens: 0,
      outputTokens: 0,
      costEstimate: 0,
    };
  }

  // 1. Assemble context
  console.log(`[AdCortex] Assembling 4-layer context for ${query.clientId}/${query.platform}...`);
  const ctx = await assembleContext(query.clientId, query.platform, query.type, query.analysisData);

  // 2. Route model
  const modelTier = routeModel(query.type);
  console.log(`[AdCortex] Model route: ${query.type} → ${modelTier}`);

  // 3. Build prompt
  const prompt = buildPromptForQuery(query, ctx);

  // 4. Call Claude
  console.log(`[AdCortex] Calling Claude (${modelTier})...`);
  let claudeResponse: ClaudeResponse;
  try {
    claudeResponse = await callClaude({
      systemPrompt: prompt.system,
      userMessage: prompt.user,
      modelTier,
    });
  } catch (err: any) {
    console.error(`[AdCortex] Claude call failed:`, err.message);
    return {
      recommendations: [],
      layer_contributions: {},
      conflicts: [],
      humanResponse: `AdCortex error: ${err.message}. Please check your API key and try again.`,
      modelUsed: modelTier,
      inputTokens: 0,
      outputTokens: 0,
      costEstimate: 0,
    };
  }

  console.log(`[AdCortex] Claude response received. Tokens: ${claudeResponse.inputTokens}in / ${claudeResponse.outputTokens}out. Cost: $${claudeResponse.costEstimate.toFixed(4)}`);

  // 5. Parse JSON safely
  const parsed = parseAdCortexResponse(claudeResponse.content);

  // 6. Build human response
  const humanResponse = formatHumanResponse(parsed);

  // 7. Return structured result
  return {
    recommendations: parsed.recommendations,
    layer_contributions: parsed.layer_contributions,
    conflicts: parsed.conflicts,
    humanResponse,
    modelUsed: claudeResponse.model,
    inputTokens: claudeResponse.inputTokens,
    outputTokens: claudeResponse.outputTokens,
    costEstimate: claudeResponse.costEstimate,
  };
}
