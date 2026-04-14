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
 *
 * ─── CHANGELOG (Fix Guide v1) ────────────────────────────────────
 * 1. serializeLayer2() now includes adset/ad-group data, ad/creative data,
 *    Python agent intellect_insights, and 12+ missing campaign fields.
 * 2. Campaign cap raised from 20 → 40, smart overflow summary added.
 * 3. Recommendation prompt layer labels aligned with 4-layer architecture.
 * 4. Conflict handling: Claude must show ALL strong opinions, not pick one.
 * 5. Strategic prompt strengthened for entity-specific recommendations.
 */

import type { AssembledContext } from "./context-assembler";

// ─── Output Schema ────────────────────────────────────────────────

export interface AdCortexRecommendation {
  rank: number;
  action: string;
  confidence: number;
  source_layers: string[];
  sop_alignment: "agrees" | "disagrees" | "extends";
  sop_position?: string;
  reasoning: string;
  execution_type: "auto" | "manual" | "confirm";
  risk_level: "low" | "medium" | "high";
  action_payload: {
    intent?: string;
    platform?: string;
    entity_type?: string;
    entity_ids?: string[];
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
- Target CPL: ${clientTargets.cpl || "not set"}
- Monthly Budget: ${clientTargets.budget || "not set"}
- Monthly Leads Target: ${clientTargets.leads || "not set"}
- CPM Max: ${clientTargets.cpm_max || "not set"}

### Scoring Configuration
- CPL Target: ${scoringConfig.cpl_target || "not set"}
- CPL Critical: ${scoringConfig.cpl_critical || "not set"}
- CTR Benchmark: ${scoringConfig.ctr_benchmark || 1.0}%`;
}

function serializeLayer2(ctx: AssembledContext): string {
  const { intellect_insights, platformContext, analysisData } = ctx.layer2;

  // ─── Campaign summary (expanded fields, cap raised to 40) ──────
  const campaigns = analysisData?.campaign_audit || analysisData?.campaign_performance || analysisData?.campaigns || [];
  const campaignSummary = campaigns.slice(0, 40).map((c: any) => {
    const spend = c.spend || c.cost || c.amount_spent || 0;
    const leads = c.leads || c.conversions || c.results || 0;
    const cpl = c.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
    const clicks = c.clicks || 0;
    const imps = c.impressions || 0;
    const ctr = c.ctr ?? (imps > 0 ? (clicks / imps) * 100 : 0);
    const cvr = c.cvr ?? (clicks > 0 ? (leads / clicks) * 100 : 0);
    return {
      id: c.campaign_id || c.id,
      name: c.campaign_name || c.name,
      status: c.status || c.effective_status || c.delivery_status,
      classification: c.classification,
      health_score: c.health_score,
      spend: Math.round(spend),
      leads,
      cpl: cpl > 99990 ? "no_leads" : Math.round(cpl),
      ctr: `${Number(ctr).toFixed(2)}%`,
      cvr: `${Number(cvr).toFixed(2)}%`,
      cpm: c.cpm ? Math.round(c.cpm) : null,
      frequency: c.frequency ? Number(c.frequency).toFixed(1) : null,
      impressions: imps,
      clicks,
      daily_budget: c.daily_budget || null,
      days_active: c.days_active || c.age_days || null,
      learning_status: c.learning_status || null,
      // Google-specific fields
      quality_score: c.quality_score || null,
      search_impression_share: c.search_is || c.search_impression_share || null,
      search_budget_lost_is: c.search_budget_lost_is || null,
      search_rank_lost_is: c.search_rank_lost_is || null,
      // Score breakdown for deeper analysis
      score_breakdown: c.score_breakdown || null,
    };
  });

  // Overflow summary if more campaigns exist
  const overflowCount = campaigns.length - campaignSummary.length;
  const overflowLine = overflowCount > 0
    ? `\n(+ ${overflowCount} more campaigns not shown — ${campaigns.slice(40).filter((c: any) => c.classification === "UNDERPERFORMER").length} underperformers among them)`
    : "";

  // ─── Ad Set / Ad Group summary (top 30) ────────────────────────
  const adsets = analysisData?.adset_analysis || analysisData?.ad_group_analysis || [];
  const adsetSummary = adsets.slice(0, 30).map((a: any) => {
    const spend = a.spend || a.cost || 0;
    const leads = a.leads || a.conversions || 0;
    const cpl = a.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
    return {
      id: a.adset_id || a.ad_group_id || a.id,
      name: a.adset_name || a.ad_group_name || a.name,
      campaign_name: a.campaign_name,
      status: a.status || a.effective_status,
      classification: a.classification,
      health_score: a.health_score,
      spend: Math.round(spend),
      leads,
      cpl: cpl > 99990 ? "no_leads" : Math.round(cpl),
      ctr: `${Number(a.ctr || 0).toFixed(2)}%`,
      cvr: `${Number(a.cvr || 0).toFixed(2)}%`,
      frequency: a.frequency ? Number(a.frequency).toFixed(1) : null,
      impressions: a.impressions || 0,
      daily_budget: a.daily_budget || null,
      should_pause: a.should_pause || false,
      auto_pause_reasons: a.auto_pause_reasons || [],
      // Google ad group specific
      quality_score: a.quality_score || null,
    };
  });

  // ─── Ad / Creative summary (top 30) ────────────────────────────
  const ads = analysisData?.creative_health || analysisData?.ad_analysis || [];
  const adSummary = ads.slice(0, 30).map((ad: any) => {
    const spend = ad.spend || ad.cost || 0;
    const leads = ad.leads || ad.conversions || 0;
    const cpl = ad.cpl ?? (leads > 0 ? spend / leads : spend > 0 ? 99999 : 0);
    return {
      id: ad.ad_id || ad.id,
      name: ad.ad_name || ad.name,
      campaign_name: ad.campaign_name,
      adset_name: ad.adset_name || ad.ad_group_name,
      classification: ad.classification,
      creative_score: ad.creative_score || ad.performance_score || null,
      creative_age_days: ad.creative_age_days || ad.age_days || null,
      spend: Math.round(spend),
      leads,
      cpl: cpl > 99990 ? "no_leads" : Math.round(cpl),
      ctr: `${Number(ad.ctr || 0).toFixed(2)}%`,
      frequency: ad.frequency ? Number(ad.frequency).toFixed(1) : null,
      impressions: ad.impressions || 0,
      // Video metrics
      thumb_stop_rate: ad.thumb_stop_rate || ad.tsr || null,
      video_hold_rate: ad.video_hold_rate || ad.vhr || null,
      hook_rate: ad.hook_rate || null,
      // Action flags from Python agent
      should_pause: ad.should_pause || false,
      auto_pause_reasons: ad.auto_pause_reasons || [],
    };
  });

  // ─── Python Agent Diagnostic Insights (PIE/PDE) ────────────────
  const agentInsights = analysisData?.intellect_insights || [];
  const insightBlock = Array.isArray(agentInsights) && agentInsights.length > 0
    ? agentInsights.slice(0, 25).map((ins: any) => {
        // Meta format: { type, severity, entity, detail, auto_action }
        // Google format: { type, title, observation, recommendation, impact, confidence }
        if (ins.detail) {
          return `- [${ins.type}]${ins.severity ? ` ${ins.severity}` : ""}: ${ins.entity || "account"} — ${ins.detail}${ins.auto_action ? " [AUTO-ACTION FLAGGED]" : ""}`;
        }
        return `- [${ins.type}] ${ins.title || ""}: ${ins.observation || ""} → Rec: ${ins.recommendation || ""}${ins.confidence ? ` (confidence: ${ins.confidence})` : ""}`;
      }).join("\n")
    : "No diagnostic insights from analysis engine.";

  return `## LAYER 2: CURRENT ANALYSIS DATA

### Account Overview
- Health Score: ${intellect_insights.healthScore ?? "N/A"}
- Overall CPL: ${intellect_insights.overallCpl?.toFixed(0) || "N/A"}
- Total Spend: ${intellect_insights.totalSpend?.toFixed(0) || "N/A"}
- Total Leads: ${intellect_insights.totalLeads || 0}
- Active Campaigns: ${intellect_insights.campaignCount || 0}
- Winners: ${intellect_insights.winnerCount || 0}
- Underperformers: ${intellect_insights.loserCount || 0}
- Active Alerts: ${intellect_insights.alertCount || 0}

### Platform Context
- Platform: ${platformContext.platform}
- Days Elapsed in Month: ${platformContext.daysElapsed ?? "N/A"}
- Days Remaining: ${platformContext.daysRemaining ?? "N/A"}

### Agent Diagnostic Insights (PIE/PDE Engine)
These are automated diagnoses from the analysis engine. Use them as INPUT for
your deeper analysis — do NOT just repeat them. Enhance them with your own
expert reasoning, or challenge them if the data suggests otherwise.
${insightBlock}

### Campaign Data (${campaignSummary.length} campaigns)
${JSON.stringify(campaignSummary, null, 2)}${overflowLine}

### Ad Set / Ad Group Data (${adsetSummary.length} ad sets)
${adsetSummary.length > 0 ? JSON.stringify(adsetSummary, null, 2) : "No ad set data available."}

### Ad / Creative Data (${adSummary.length} ads)
${adSummary.length > 0 ? JSON.stringify(adSummary, null, 2) : "No ad-level data available."}`;
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
      "action": "Specific action referencing exact entity names and IDs from the data above",
      "confidence": 0.87,
      "source_layers": ["layer1", "layer2"],
      "sop_alignment": "agrees",
      "sop_position": "If sop_alignment is 'disagrees', explain what the SOP says here. Otherwise null.",
      "reasoning": "Detailed multi-paragraph reasoning structured strictly in this order: (1) SOP EVALUATION: Compare stats against Meta/Google SOP thresholds; (2) EXPERT ANALYSIS: Identify root cause trends in CTR/CPL/CVR; (3) EXECUTION HISTORY: Note how similar past actions performed; (4) STRATEGIC RATIONALE: Align with user's past logic. Give a concrete step-by-step fix with specific entity names and numbers.",
      "execution_type": "auto",
      "risk_level": "low",
      "action_payload": {
        "intent": "Brief intent description",
        "platform": "meta",
        "entity_type": "campaign | adset | ad_group | ad | account | creative",
        "entity_ids": ["id1", "id2"],
        "filters": [
          { "metric": "cpl", "operator": ">", "value": 800, "unit": "INR" }
        ],
        "action": {
          "type": "pause",
          "parameters": {
            "reason": "CPL exceeds target threshold"
          }
        },
        "execution_plan": ["Step 1: ...", "Step 2: ...", "Step 3: Expected outcome — e.g. CTR improvement from 0.5% to 0.9%+"],
        "strategic_rationale": "One sentence strategic reasoning.",
        "risk_checks": ["Check 1", "Check 2"]
      }
    }
  ],
  "layer_contributions": {
    "layer1_sop": "MANDATORY FIRST STEP: Evaluation of platform-specific SOPs (Meta or Google) and deterministic client rules.",
    "layer2_expert": "SECOND STEP: Your deep expert analysis of the raw campaign/adset/ad data and performance trends.",
    "layer3_learning": "THIRD STEP: Contextualization based on execution history and historical success rates.",
    "layer4_strategy": "FINAL STEP: Synthesis with the user's past strategic decisions and overarching rationale."
  },
  "conflicts": [
    "When layers DISAGREE, explain: Layer X says [position]. Layer Y says [position]. The stronger path is [X/Y] because [reason]. Include BOTH as separate recommendations."
  ]
}

RULES:
- Provide exactly 5 recommendations, ranked by confidence and expected impact
- confidence must be between 0.0 and 1.0
- sop_alignment: "agrees" if follows SOP, "disagrees" if it challenges SOP (MUST explain sop_position), "extends" if it goes beyond SOPs
- execution_type values:
    "auto"    = Safe reversible platform change (pause, budget adjust) — executable via API
    "confirm" = Significant change requiring user approval before execution
    "manual"  = Requires human creative work, content upload, or external tool (creative refresh, landing page fix, form edits, audience research)
- risk_level: "low" for reversible safe changes, "medium" for significant budget changes, "high" for large-scale pauses or budget increases > 50%
- action.type MUST be one of:
    For executable (auto/confirm): "pause", "scale", "adjust_budget", "unpause", "duplicate_winner"
    For strategic/manual: "creative_refresh", "audience_shift", "funnel_audit", "restructure", "bid_strategy_change", "ad_format_shift", "landing_page_audit", "creative_rotation", "clarify"
- entity_type: specify whether acting on campaign, adset, ad_group, ad, account, or creative level
- entity_ids: list the specific IDs from the data to act on (empty array [] if account-level or strategic)
- CRITICAL: DO NOT limit yourself to only pause/scale. For creative, CTR, or engagement problems, you MUST recommend specific creative angles, hooks, formats, or audience targeting changes with full specificity.
- CRITICAL: When layers conflict, show BOTH opinions as SEPARATE recommendations. Do NOT silently discard a layer's position. The user needs to see all strong perspectives.
- CRITICAL: Reference specific entity NAMES and METRICS from the data above. Never say "optimize campaigns" — say which campaign/ad/adset and cite the exact numbers.
- CRITICAL: For each manual/strategic recommendation, the execution_plan MUST contain at least 3 specific, actionable steps a media buyer can follow immediately (not vague advice).
- If the user's request is ambiguous, set action.type = "clarify" and explain what you need`;

// ─── Prompt Builders ──────────────────────────────────────────────

/**
 * Strategic analysis prompt — used for deep analysis queries.
 * Routes to Opus for maximum reasoning quality.
 */
export function buildStrategicPrompt(ctx: AssembledContext): { system: string; user: string } {
  const system = `You are Mojo AdCortex, an elite AI performance marketing strategist for AdPilot.

You have 4 intelligence layers. You MUST follow this analytical protocol in sequence:

STEP 1 — SOP EVALUATION (LAYER 1 & 2 SOPs)
Evaluate deterministic baseline rules. For Meta dashboards, prioritize creative/audience SOPs; for Google, prioritize quality score/rank SOPs. State whether the data triggers an SOP alert.

STEP 2 — EXPERT ANALYSIS (LAYER 2 DATA)
Perform deep analysis of campaigns, ad sets, and individual ad creatives. Identify root causes: creative fatigue, audience saturation, or funnel friction. Form your own expert opinion independent of SOPs.

STEP 3 — EXECUTION HISTORY (LAYER 3)
Check history of similar actions. Calibrate your confidence based on what actually worked for this client in the past.

STEP 4 — STRATEGIC RATIONALE (LAYER 4)
Factor in the user's past decisions and overrides. Ensure recommendation aligns with their broader strategic goals.

CONFLICT RESOLUTION:
When layers disagree, you MUST produce SEPARATE recommendations for each strong opinion.
Tag each with which layers support it. Explain which is stronger and WHY.
NEVER silently discard a layer's position — the user decides.

${OUTPUT_FORMAT_INSTRUCTION}`;

  const user = `${serializeLayer1(ctx)}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}

---

Analyse the full context across all 4 layers. Identify the most impactful opportunities to improve account health. For EVERY recommendation, reference specific entity names, IDs, and metrics from the data above. Prioritize by expected impact on CPL and lead volume. Show all strong opinions, especially where layers disagree.`;

  return { system, user };
}

/**
 * Recommendation prompt — used for generating specific actionable recommendations.
 * Routes to Sonnet for fast, cost-effective responses.
 *
 * alertContext is passed when the call is triggered from a specific alert (e.g. "Account CTR is
 * critically low"). When present, the prompt becomes a problem-specific diagnosis + fix engine
 * rather than a generic account health sweep.
 */
export function buildRecommendationPrompt(
  ctx: AssembledContext,
  alertContext?: { problem: string; metric?: string; metrics?: Record<string, string | number> }
): { system: string; user: string } {

  const hasProblem = !!alertContext?.problem;
  const alertMetric = alertContext?.metric?.toLowerCase() || "";

  // ── Alert-specific diagnosis directive ───────────────────────────
  // When triggered from a specific alert, inject a tailored analysis directive
  // that forces Claude to go deep on root cause — not just execute SOPs.
  const alertDiagnosisBlock = hasProblem ? buildAlertDiagnosisDirective(alertContext!.problem, alertMetric) : "";

  // ── System prompt ────────────────────────────────────────────────
  const system = `You are Mojo AdCortex, an elite AI performance marketing strategist specializing in real-estate lead generation ads on Meta and Google.

YOUR 4-LAYER ANALYTICAL PROTOCOL (MUST FOLLOW SEQUENTIALLY):

1. SOP EVALUATION (LAYER 1 & 2): 
Check deterministic Meta/Google SOP rules and client targets first. This is your baseline. 

2. EXPERT ANALYSIS (LAYER 2 DATA): 
Perform deep audit of CTR, CPL, CVR. Identify root causes: creative fatigue, frequency > 2.5x, or post-click friction. 

3. EXECUTION HISTORY (LAYER 3): 
Review past outcomes and calibrated success rates. Adjust confidence based on historical data.

4. STRATEGIC RATIONALE (LAYER 4): 
Incorporate the media buyer's past strategic logic and overrides. Ensure final recommendation aligns with the established account strategy.

CRITICAL RULES — NEVER VIOLATE:
- NEVER give generic advice like "improve creatives" or "refresh ads"
- ALWAYS recommend specific creative ANGLES (e.g., "Test disruptive hook: 'Still renting in [city]?'")
- ALWAYS state which specific ad/adset/campaign by NAME and cite the exact metric
- DO NOT default to just "pause" for creative/CTR problems — creative refresh, format shift, or audience narrowing may be higher impact
- When you recommend creative work, specify: (a) format (Reel/Static/Story), (b) first-frame concept, (c) text overlay idea, (d) target audience signal
- When recommending audience changes, specify which segments to test/exclude
- Combine SOP rules with expert analysis to produce SHARPER recommendations than either alone
- Use execution_type="manual" for creative and strategic work; "auto"/"confirm" for platform actions

${OUTPUT_FORMAT_INSTRUCTION}`;

  // ── Live account metrics block ───────────────────────────────────
  const { intellect_insights, analysisData, platformContext } = ctx.layer2;
  const ap = analysisData?.account_pulse || {};

  const liveMetrics = alertContext?.metrics
    ? Object.entries(alertContext.metrics).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : [
        ap.overall_cpl   ? `- Account CPL: ₹${Math.round(ap.overall_cpl)} (target: ₹${ctx.layer1.clientTargets.cpl || 'N/A'})`   : null,
        ap.overall_ctr   ? `- Account CTR: ${ap.overall_ctr}%`                : null,
        ap.overall_cpm   ? `- Account CPM: ₹${Math.round(ap.overall_cpm)}`   : null,
        ap.overall_cpc   ? `- Account CPC: ₹${Math.round(ap.overall_cpc)}`   : null,
        intellect_insights.totalSpend  ? `- Total Spend: ₹${Math.round(intellect_insights.totalSpend)}` : null,
        intellect_insights.totalLeads  ? `- Total Leads: ${intellect_insights.totalLeads}`              : null,
        intellect_insights.healthScore ? `- Account Health Score: ${intellect_insights.healthScore}`    : null,
        `- Platform: ${platformContext.platform}`,
        platformContext.daysElapsed    ? `- Days Elapsed in Month: ${platformContext.daysElapsed}`      : null,
        platformContext.daysRemaining  ? `- Days Remaining: ${platformContext.daysRemaining}`           : null,
      ].filter(Boolean).join("\n");

  // ── User message ─────────────────────────────────────────────────
  const problemBlock = hasProblem
    ? `🚨 ALERT TO DIAGNOSE:\n${alertContext!.problem}${alertContext?.metric ? ` [Primary Metric: ${alertContext.metric}]` : ""}`
    : `TASK:\nGenerate a full account health sweep — identify the highest-impact issues across all active campaigns, ad sets, and ads. Drill down to entity level.`;

  const user = `${problemBlock}

ACCOUNT CONTEXT (live metrics at time of alert):
${liveMetrics}
${alertDiagnosisBlock}

${serializeLayer2(ctx)}

${serializeLayer3(ctx)}

${serializeLayer4(ctx)}

${serializeLayer1(ctx)}

---

Now generate your TOP 5 recommendations. For EACH one:
1. Reference the specific entity (campaign/adset/ad) by NAME and ID
2. Cite exact metrics from the data (e.g., "CTR is 0.50% vs target 0.7%")
3. Diagnose the ROOT CAUSE — not just the symptom (e.g., "CTR is low because 3 ads are static images running >40 days with no creative rotation. Frequency is 2.8x indicating audience fatigue.")
4. State what each layer says (do all layers agree? if not, show the conflict)
5. Give a concrete, multi-step fix that a media buyer can execute TODAY

For creative/CTR alerts: You MUST recommend specific creative angles, hooks, formats, or audience changes — not just pausing.
For CPL alerts: Diagnose whether the failure is at CPM, CTR, or CVR level — then prescribe at the right level.
If the analysis engine already flagged something (in Agent Diagnostic Insights), go DEEPER — explain the underlying cause.`;

  return { system, user };
}

/**
 * Builds a rich, alert-specific analysis directive injected into the user message.
 * This tells Claude exactly what diagnostic lenses to apply for each alert type.
 */
function buildAlertDiagnosisDirective(problem: string, metric: string): string {
  const p = problem.toLowerCase();
  const m = metric.toLowerCase();

  // CTR / Creative / Engagement alerts
  if (m.includes("ctr") || p.includes("ctr") || p.includes("click")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (CTR / Creative / Engagement):
This is a CTR problem. Your job is to diagnose the creative and audience layer — NOT just pause the campaign.

Diagnose these in order:
1. CREATIVE FATIGUE CHECK: Are any ads older than 21 days? Are static images dominating over video?
   - If yes → recommend specific creative angles to replace them (not "refresh the ad")
   - Specify: (a) First-frame concept, (b) Headline hook, (c) Disruptive text overlay
   - Real estate hooks that work: "₹7L for premium living in [city]?", "Still commuting 2hrs daily?", "Before you buy, see this."
2. AUDIENCE EXHAUSTION CHECK: Is frequency > 2.0? Is the same cold audience being shown the same ad?
   - If yes → recommend audience segmentation: retarget video viewers (50%+), website visitors, while resting cold audience
3. FORMAT CHECK: Are ads in feed vs Reels? Reels-first format gets 2-3x CTR vs static in 2026.
   - Recommend format shift with specific first-3-second hook concept
4. AD-LEVEL DIAGNOSIS: Which specific ADs have the lowest CTR? Name them and explain why they are scroll-ignored.
5. CREATIVE ROTATION PLAN: Recommend a 7-day refresh cycle with specific creative rotation strategy.

IMPACT EXPECTATION: A creative refresh targeting the right audience on Reels format can lift CTR from 0.5% to 0.9%+ within 7 days.
`;
  }

  // CPL / Cost efficiency alerts
  if (m.includes("cpl") || p.includes("cpl") || p.includes("cost per lead") || p.includes("above target")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (CPL / Cost Efficiency):
CPL exceeds target. Your job is to diagnose WHICH layer of the funnel is broken.

Diagnose the cost stack in order:
1. CPM LAYER: Is CPM inflated (>₹150 for Meta)? If CPM is high → audience issue (narrow/competitive) or creative fatigue.
   - If CPM is high → recommend: audience broadening, exclude overlap, or creative refresh to improve relevance score
2. CTR LAYER: Is CTR < 0.7%? Low CTR means the creative is not stopping the scroll.
   - If CTR is low → creative issue (see CTR directive above)
3. CVR LAYER: Is CVR (clicks→leads) < 4% (Meta benchmark)? If clicks exist but no leads → landing page or form friction.
   - If CVR is low → recommend: (a) switch to Lead Form instead of website, (b) audit landing page speed, (c) shorten form fields
4. AUDIENCE QUALITY: Are leads converting to qualified leads? If CPL is ok but CPQL is high → audience mismatch.
5. CAMPAIGN STRUCTURE: Too many ad sets competing? Auction overlap inflates CPM. Consolidate.

For each failing layer, prescribe the exact fix — not a generic recommendation.
`;
  }

  // Budget / Pacing / Shift alerts
  if (m.includes("pacing") || m.includes("budget") || p.includes("budget") || p.includes("best performer") || p.includes("shift")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (Budget / Pacing / Allocation):
Budget is misallocated or off-pace. Your job is to identify the winner and shift spend toward it.

Diagnose:
1. WINNER IDENTIFICATION: Which campaign has the best COMBINATION of: stable CTR + consistent leads + CPL near or below target? (Not just cheapest CPL — that can be a spike)
2. SAFE SCALING: Increase winner's budget by 20-25% max (not a sudden spike — that resets Meta's learning phase)
3. DUPLICATION STRATEGY: Create 1-2 copies of the winner with same creative + slight audience variation
4. UNDERPERFORMER CAP: Which ad sets are in the bottom 50% by CPL? Cap or pause them.
5. FREQUENCY GUARD: After scaling, if frequency > 2.5 → CTR will drop again. Set up creative rotation before scaling.
`;
  }

  // Status / Underperformance / Review flags
  if (m.includes("status") || p.includes("flagged") || p.includes("underperform") || p.includes("review")) {
    return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE (Underperformance / Status Flag):
An entity has been flagged for review. Your job is to identify whether to pause, restructure, or reset.

Diagnose:
1. FAILURE PATTERN: Is this a CPL failure, a CTR failure, or a zero-leads-drain situation? Each needs a different fix.
2. CREATIVE vs AUDIENCE vs FUNNEL: Which layer is failing? Assign the failure to the correct layer.
3. LEARNING PHASE CHECK: Is this campaign still in the learning phase (<50 conversions MTD)? If yes → DO NOT pause — let it learn.
4. KILL RULES: Should a kill rule be applied? (e.g., Pause if CPL > ₹1200 after ₹3000 spend with <2 leads)
5. RESTRUCTURE vs RESET: Should this be restructured (fewer ad sets, clearer segmentation) or reset with new creatives and targeting?
`;
  }

  // Generic fallback for unrecognized alert types
  return `

🎯 ALERT-SPECIFIC DIAGNOSIS DIRECTIVE:
Diagnose the root cause of this alert across all 4 layers. Do not just recommend pausing — identify the exact failure point (CPM, CTR, CVR, creative, audience, or funnel) and prescribe the fix at that layer.
`;
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

Your role: Interpret natural language commands from media buyers and convert them into precise,
safe campaign actions — informed by a 4-layer intelligence system.

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

## 4-LAYER ANALYTICAL PROTOCOL (FOLLOW SEQUENTIALLY)
You MUST cross-reference all intelligence layers in this exact order:
1. LAYER 1 — SOP EVALUATION: Check operational rules, client targets, and platform-specific SOPs (Meta/Google).
2. LAYER 2 — EXPERT ANALYSIS: Verify against current campaign, ad set, and ad-level performance metrics.
3. LAYER 3 — EXECUTION HISTORY: Check if similar past actions resulted in positive or negative outcomes.
4. LAYER 4 — STRATEGIC RATIONALE: Respect the user's past logic and strategic preferences.

When layers conflict, show BOTH opinions. If Layer 3 shows a similar action previously failed,
WARN the user and adjust confidence. If Layer 1 SOP says one thing but Layer 2 data says another,
show both as separate recommendations and explain which is stronger.

CRITICAL: Always reference SPECIFIC entity names and metrics from the data.
When you have ad-level and adset-level data available, use it to be MORE specific.
"Pause the 3 worst-performing ads in campaign X" is better than "pause campaign X."

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

Analyse the command against all 4 layers. Produce ranked recommendations with full action payloads.
Reference specific campaign, ad set, and ad names where applicable.
When layers disagree, show all strong opinions.`;

  return { system, user };
}
