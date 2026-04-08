/**
 * Prompt Templates — Mojo AdCortex Structured Prompt Builder
 *
 * Builds Claude prompts that include all 4 intelligence layers.
 * Each prompt forces strict JSON output format with ranked recommendations.
 *
 * Three prompt types:
 *  - Strategic:      Deep analysis for strategic decisions (Opus)
 *  - Recommendation: Generate actionable recommendations (Sonnet)
 *  - Terminal:        Command interpretation + execution plan (model depends on query)
 */

import type { AssembledContext } from "./context-assembler";

// ─── Output Schema ────────────────────────────────────────────────

export interface AdCortexRecommendation {
  rank: number;
  action: string;
  confidence: number;
  source_layers: string[];
  sop_alignment: "agrees" | "disagrees" | "extends";
  reasoning: string;
  execution_type: "auto" | "manual" | "confirm";
  risk_level: "low" | "medium" | "high";
  action_payload: {
    intent?: string;
    platform?: string;
    filters?: Array<{ metric: string; operator: string; value: number; unit?: string }>;
    action?: { type: string; parameters: Record<string, any> };
    execution_plan?: string[];
    strategic_rationale?: string;
    risk_checks?: string[];
  };
}

export interface AdCortexResponse {
  recommendations: AdCortexRecommendation[];
  layer_contributions: Record<string, any>;
  conflicts: string[];
}

// ─── Helper: Serialize Context Layers ─────────────────────────────

function serializeLayer1(ctx: AssembledContext): string {
  const { sopRules, clientTargets, scoringConfig } = ctx.layer1;
  return `## LAYER 1: SOP RULES & CLIENT TARGETS

### Operating Rules
- Min conversions before action: ${sopRules.minConversionsBeforeAction}
- Min impressions (learning phase): ${sopRules.minImpressionsLearning}
- Max budget increase without confirmation: ${sopRules.maxBudgetIncreaseWithoutConfirm}%
- Cooldown between actions on same entity: ${sopRules.cooldownHours} hours
- Default budget scale: ${sopRules.defaultScalePercent}%
- Active cooldowns: ${Object.keys(sopRules.activeCooldowns).length} entities

### Client Targets
- Target CPL: ₹${clientTargets.cpl || "not set"}
- Monthly Budget: ₹${clientTargets.budget || "not set"}
- Monthly Leads Target: ${clientTargets.leads || "not set"}
- CPM Max: ₹${clientTargets.cpm_max || "not set"}

### Scoring Configuration
- CPL Target: ₹${scoringConfig.cpl_target || "not set"}
- CPL Critical: ₹${scoringConfig.cpl_critical || "not set"}
- CTR Benchmark: ${scoringConfig.ctr_benchmark || 1.0}%`;
}

function serializeLayer2(ctx: AssembledContext): string {
  const { intellect_insights, platformContext, analysisData } = ctx.layer2;

  // Campaign summary (top 20)
  const campaigns = analysisData?.campaign_audit || analysisData?.campaign_performance || analysisData?.campaigns || [];
  const campaignSummary = campaigns.slice(0, 20).map((c: any) => {
    const spend = c.spend || c.cost || c.amount_spent || 0;
    const leads = c.leads || c.conversions || c.results || 0;
    const cpl = c.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
    const ctr = c.ctr ?? 0;
    return {
      id: c.campaign_id || c.id,
      name: c.campaign_name || c.name,
      status: c.status || c.effective_status || c.delivery_status,
      classification: c.classification,
      health_score: c.health_score,
      spend: `₹${Number(spend).toFixed(0)}`,
      leads,
      cpl: cpl > 99990 ? "∞" : `₹${Number(cpl).toFixed(0)}`,
      ctr: `${Number(ctr).toFixed(2)}%`,
      impressions: c.impressions || 0,
      daily_budget: c.daily_budget ? `₹${c.daily_budget}` : null,
      learning_status: c.learning_status,
    };
  });

  return `## LAYER 2: CURRENT ANALYSIS DATA

### Account Overview
- Health Score: ${intellect_insights.healthScore ?? "N/A"}
- Overall CPL: ₹${intellect_insights.overallCpl?.toFixed(0) || "N/A"}
- Total Spend: ₹${intellect_insights.totalSpend?.toFixed(0) || "N/A"}
- Total Leads: ${intellect_insights.totalLeads || 0}
- Active Campaigns: ${intellect_insights.campaignCount || 0}
- Winners: ${intellect_insights.winnerCount || 0}
- Losers/Underperformers: ${intellect_insights.loserCount || 0}
- Active Alerts: ${intellect_insights.alertCount || 0}

### Platform Context
- Platform: ${platformContext.platform}
- Days Elapsed in Month: ${platformContext.daysElapsed ?? "N/A"}
- Days Remaining: ${platformContext.daysRemaining ?? "N/A"}

### Campaign Data (Top 20)
${JSON.stringify(campaignSummary, null, 2)}`;
}

function serializeLayer3(ctx: AssembledContext): string {
  const { recentActions, patterns, successRates } = ctx.layer3;

  const recentSummary = recentActions.slice(0, 10).map((a) => ({
    action: a.action,
    entity: a.entityName,
    outcome: a.outcome,
    reason: a.outcomeReason?.substring(0, 80),
    daysAgo: a.daysElapsed,
  }));

  return `## LAYER 3: EXECUTION LEARNING HISTORY

### Historical Success Rates
- Total Past Actions: ${successRates.totalActions}
- Overall Positive Rate: ${(successRates.positiveRate * 100).toFixed(0)}%
- Pause Success Rate: ${(successRates.pauseSuccessRate * 100).toFixed(0)}%
- Scale Success Rate: ${(successRates.scaleSuccessRate * 100).toFixed(0)}%

### Discovered Patterns
${patterns.length > 0 ? patterns.map((p) => `- ${p}`).join("\n") : "- No patterns discovered yet (insufficient data)"}

### Recent Actions (Last 10)
${recentSummary.length > 0 ? JSON.stringify(recentSummary, null, 2) : "No recent actions recorded."}`;
}

function serializeLayer4(ctx: AssembledContext): string {
  const { strategicInputs, overrideHistory } = ctx.layer4;

  const inputsSummary = strategicInputs.slice(0, 10).map((si) => ({
    action: si.action,
    entity: si.entityName,
    rationale: si.strategicCall || si.reason,
  }));

  const overrideSummary = overrideHistory.slice(0, 10).map((o) => ({
    recommendation: o.recommendationId,
    decision: o.action,
    rationale: o.strategicCall,
  }));

  return `## LAYER 4: STRATEGIC INPUTS & USER OVERRIDES

### User Strategic Decisions (Last 10)
${inputsSummary.length > 0 ? JSON.stringify(inputsSummary, null, 2) : "No strategic inputs recorded yet."}

### Recommendation Overrides
${overrideSummary.length > 0 ? JSON.stringify(overrideSummary, null, 2) : "No recommendation overrides recorded."}`;
}

// ─── Shared Output Format Instructions ────────────────────────────

const OUTPUT_FORMAT_INSTRUCTION = `
## OUTPUT FORMAT — STRICT JSON

You MUST respond with ONLY valid JSON (no markdown, no explanation before or after). The response must match this exact schema:

{
  "recommendations": [
    {
      "rank": 1,
      "action": "Brief action description (e.g., 'Pause campaign X')",
      "confidence": 0.87,
      "source_layers": ["layer1", "layer2"],
      "sop_alignment": "agrees",
      "reasoning": "Detailed multi-sentence reasoning explaining WHY this action should be taken, citing specific data points from the layers above.",
      "execution_type": "auto",
      "risk_level": "low",
      "action_payload": {
        "intent": "Brief intent description",
        "platform": "meta",
        "filters": [
          { "metric": "cpl", "operator": ">", "value": 800, "unit": "INR" }
        ],
        "action": {
          "type": "pause",
          "parameters": {
            "reason": "CPL exceeds target threshold"
          }
        },
        "execution_plan": ["Step 1: ...", "Step 2: ..."],
        "strategic_rationale": "One sentence strategic reasoning.",
        "risk_checks": ["Check 1", "Check 2"]
      }
    }
  ],
  "layer_contributions": {
    "layer1_sop": "Brief summary of what Layer 1 contributed to the decision",
    "layer2_data": "Brief summary of what Layer 2 contributed",
    "layer3_learning": "Brief summary of what Layer 3 contributed",
    "layer4_strategy": "Brief summary of what Layer 4 contributed"
  },
  "conflicts": ["Any conflicts between layers (empty array if none)"]
}

RULES:
- Provide 1 to 5 recommendations, ranked by confidence
- confidence must be between 0.0 and 1.0
- sop_alignment: "agrees" if the recommendation follows SOP rules, "disagrees" if it challenges them (explain why), "extends" if it goes beyond existing rules
- execution_type: "auto" for safe actions, "confirm" for risky ones, "manual" for suggestions that need human judgment
- risk_level: "low" for reversible safe changes, "medium" for significant budget changes, "high" for large-scale pauses or budget increases > 50%
- action.type MUST be one of: "pause", "scale", "adjust_budget", "unpause", "clarify"
- Always fill action_payload with the full execution structure
- If the user's request is ambiguous, set action.type = "clarify" and explain what you need in the reasoning field`;

// ─── Prompt Builders ──────────────────────────────────────────────

/**
 * Strategic analysis prompt — used for deep analysis queries.
 * Routes to Opus for maximum reasoning quality.
 */
export function buildStrategicPrompt(ctx: AssembledContext): { system: string; user: string } {
  const system = `You are Mojo AdCortex, an elite AI performance marketing strategist for AdPilot.

Your role: Analyse advertising campaign data across all 4 intelligence layers and produce actionable strategic recommendations.

You must evaluate ALL layers, identify conflicts between them, and produce ranked recommendations. When SOP rules conflict with data patterns, note the conflict and recommend the data-driven approach with explanation.

${OUTPUT_FORMAT_INSTRUCTION}`;

  const user = `${serializeLayer1(ctx)}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}

---

Analyse the full context across all 4 layers. Identify the most impactful opportunities so that the account health improves. Prioritize by expected impact on CPL and lead volume.`;

  return { system, user };
}

/**
 * Recommendation prompt — used for generating specific actionable recommendations.
 * Routes to Sonnet for fast, cost-effective responses.
 */
export function buildRecommendationPrompt(ctx: AssembledContext): { system: string; user: string } {
  const system = `You are Mojo AdCortex, an AI performance marketing engine for AdPilot.

Your role: Generate specific, executable recommendations based on the 4-layer intelligence context provided.

Focus on:
- Campaigns that need immediate action (losers draining budget)
- Winners that should be scaled
- Budget reallocation opportunities
- Learning phase entities that need protection

${OUTPUT_FORMAT_INSTRUCTION}`;

  const user = `${serializeLayer1(ctx)}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}

---

Generate ranked recommendations. Focus on actions that can be executed immediately via the AdPilot platform. Each recommendation must reference specific campaigns by name.`;

  return { system, user };
}

/**
 * Terminal prompt — used for interpreting natural language commands.
 * Model routing decided by intelligence-engine based on command complexity.
 */
export function buildTerminalPrompt(
  ctx: AssembledContext,
  userCommand: string,
  conversationHistory?: string[]
): { system: string; user: string } {
  const targetCPL = ctx.layer1.clientTargets.cpl || 800;

  const system = `You are Mojo AdCortex, an elite AI performance marketing agent for AdPilot.

Your role: Interpret natural language commands from media buyers and convert them into precise, safe campaign actions — informed by a 4-layer intelligence system.

## INTELLIGENCE RULES

Map vague language to precise metrics:
- "losers" / "bad campaigns" / "underperformers" → CPL > ${targetCPL} OR CTR < 1.0% OR CVR < 1.0% OR (spend > 500 AND leads == 0)
- "winners" / "good campaigns" / "top performers" → CPL < ${Math.round(targetCPL * 0.8)} AND conversions >= 3
- "spending money but no leads" → spend > 500 AND leads == 0
- "scale" → increase budget by 25% (default, range 20-30%)
- "pause" → set campaign status to PAUSED
- "high CPL" → CPL > ${targetCPL}
- "low CTR" → CTR < 1.0%
- Default time range → current cadence window

## PLATFORM RULES
- If user says "meta" or "facebook" → platform: "meta"
- If user says "google" → platform: "google"
- If unclear, use: "${ctx.layer2.platformContext.platform}"

## MULTI-LAYER REASONING
You have access to 4 intelligence layers. You MUST cross-reference layers before recommending actions:
- Layer 1 (SOP): Check if the action follows operational rules
- Layer 2 (Data): Verify the recommendation against current campaign data
- Layer 3 (Learning): Check if similar past actions had positive or negative outcomes
- Layer 4 (Strategy): Respect user's previous strategic decisions

If Layer 3 shows that a similar action previously had negative outcomes, WARN the user and adjust confidence accordingly.
If Layer 4 shows the user previously rejected a similar recommendation, note this conflict.

## SAFETY RULES
1. Never act on campaigns with < ${ctx.layer1.sopRules.minConversionsBeforeAction} conversions (insufficient data)
2. Never act on campaigns in learning phase (< ${ctx.layer1.sopRules.minImpressionsLearning} impressions)
3. Never pause campaigns with active leads in the last 24 hours unless explicitly asked
4. For budget increases > ${ctx.layer1.sopRules.maxBudgetIncreaseWithoutConfirm}%, require confirmation
5. Respect cooldown period of ${ctx.layer1.sopRules.cooldownHours} hours between actions on same entity

${OUTPUT_FORMAT_INSTRUCTION}`;

  const historyBlock = conversationHistory?.length
    ? `\n\n### Conversation History\n${conversationHistory.map((h, i) => `[${i + 1}] ${h}`).join("\n")}\n`
    : "";

  const user = `${serializeLayer1(ctx)}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}
${historyBlock}
---

## USER COMMAND
"${userCommand}"

Analyse the command against all 4 layers. Produce ranked recommendations with full action payloads. Reference specific campaign names where applicable.`;

  return { system, user };
}
