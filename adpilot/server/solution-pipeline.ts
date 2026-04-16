import type { AssembledContext } from "./context-assembler";
import type { LearningEntry } from "./execution-learning";
import type { AdCortexRecommendation } from "./prompt-templates";
import type { DetectedProblem, SeverityTier } from "./problem-detector";

export type ExecutionClassification = "AUTO-EXECUTE" | "MANUAL" | "REJECT";

export interface LayerAnalysisBlock {
  title: string;
  action: string;
  confidence: number;
  reasoning: string;
  data?: string[];
}

export interface SolutionOption {
  classification: ExecutionClassification;
  title: string;
  rationale: string;
  steps: string[];
  risk: "Low" | "Medium" | "High";
  confidence: number;
  expectedOutcome: string;
  actionPayload?: AdCortexRecommendation["action_payload"];
}

export interface RecommendationCard {
  id: string;
  severity: SeverityTier;
  platform: "meta" | "google";
  entity: {
    id?: string;
    name: string;
    type: string;
    score: number;
    classification: string;
  };
  diagnosis: {
    symptom: string;
    problem: string;
    data: string[];
    rootCauseChain: string[];
  };
  layerAnalysis: {
    l1: LayerAnalysisBlock;
    l2: LayerAnalysisBlock;
    l3: LayerAnalysisBlock;
    l4: LayerAnalysisBlock;
    conflicts: string[];
  };
  solutions: SolutionOption[];
  expectedOutcome: string;
}

function toActionKeyword(title: string): "pause" | "scale" | "budget" | "creative" | "landing" | "clarify" {
  const text = title.toLowerCase();
  if (text.includes("pause")) return "pause";
  if (text.includes("scale")) return "scale";
  if (text.includes("budget")) return "budget";
  if (text.includes("creative")) return "creative";
  if (text.includes("landing") || text.includes("form") || text.includes("audit")) return "landing";
  return "clarify";
}

function buildEntityFilter(problem: DetectedProblem) {
  const id = problem.entity.id;
  const name = problem.entity.name;
  const metric = problem.entity.type === "campaign" ? "campaign_id" : "name";
  const value = id && problem.entity.type === "campaign" ? id : name;

  return value
    ? [{ metric, operator: "==", value }]
    : [];
}

function buildSopDraft(problem: DetectedProblem, ctx: AssembledContext): LayerAnalysisBlock & {
  ruleId: string;
  execution: ExecutionClassification;
  actionPayload?: AdCortexRecommendation["action_payload"];
} {
  const targetCpl = Number(ctx.layer1.clientTargets?.cpl || 0);
  const raw = problem.entity.raw || {};
  const cvr = Number(raw.cvr || raw.overall_cvr || 0);

  if (problem.triggers.includes("zero_lead_budget_drain")) {
    return {
      ruleId: "zero_lead_pause",
      title: "L1 (SOP)",
      action: `Pause ${problem.entity.type} immediately`,
      confidence: 95,
      reasoning: "Document rule match: zero leads plus spend above 2x target CPL maps to an immediate pause draft action.",
      execution: "AUTO-EXECUTE",
      actionPayload: {
        intent: `Pause ${problem.entity.name} immediately`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "pause", parameters: { reason: "Zero leads plus high spend" } },
        execution_plan: [
          `Pause ${problem.entity.name}.`,
          "Watch the account for volume replacement over the next 72 hours.",
          "Reallocate budget only after a replacement winner is confirmed.",
        ],
        strategic_rationale: "Safe, reversible, deterministic pause based on zero leads and budget drain.",
        risk_checks: ["Confirm zero leads are not caused by tracking gaps."],
      },
    };
  }

  if (problem.symptomMetric === "cpl" && cvr > 0 && targetCpl > 0 && raw.cpl > targetCpl * 1.3 && cvr < (problem.platform === "google" ? 3 : 4)) {
    return {
      ruleId: "landing_page_audit",
      title: "L1 (SOP)",
      action: "Flag for landing page audit",
      confidence: 80,
      reasoning: "Document rule match: CPL above 1.3x target with CVR below floor routes to a landing page or lead-form audit.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Audit funnel for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Review landing page speed and mobile UX.",
          "Reduce form friction or field count.",
          "Validate tracking before changing traffic sources.",
        ],
        strategic_rationale: "Manual funnel work is required; the platform cannot execute this safely via API.",
        risk_checks: ["Confirm whether the bottleneck is page friction versus audience intent."],
      },
    };
  }

  if (problem.triggers.includes("frequency_breach")) {
    return {
      ruleId: "frequency_reduce_budget",
      title: "L1 (SOP)",
      action: "Reduce budget by 30% or pause",
      confidence: 85,
      reasoning: "Document rule match: frequency in breach territory drafts a budget reduction or pause pending audience validation.",
      execution: "AUTO-EXECUTE",
      actionPayload: {
        intent: `Reduce budget on ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "adjust_budget", parameters: { direction: "down", scale_percent: 30, reason: "Frequency breach" } },
        execution_plan: [
          `Reduce budget on ${problem.entity.name} by 30%.`,
          "Watch CTR and CPL for 72 hours after the budget reduction.",
          "Prepare a creative refresh if fatigue persists.",
        ],
        strategic_rationale: "Budget reduction is reversible and safe when fatigue is already confirmed by score.",
        risk_checks: ["Do not cut budget if this entity is the only lead driver and no replacement exists."],
      },
    };
  }

  if (problem.triggers.includes("winner_underfunded")) {
    return {
      ruleId: "winner_scale",
      title: "L1 (SOP)",
      action: "Scale budget by 20-25%",
      confidence: 75,
      reasoning: "Document rule match: score above 70 plus low budget utilization is a missed scaling opportunity.",
      execution: "AUTO-EXECUTE",
      actionPayload: {
        intent: `Scale winner ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "scale", parameters: { scale_percent: 20, reason: "Winner is underfunded" } },
        execution_plan: [
          `Increase ${problem.entity.name} budget by 20%.`,
          "Monitor CPL and frequency after the scale.",
          "Stop further scaling if CPL drifts above target.",
        ],
        strategic_rationale: "Moderate winner scaling is reversible and aligned to the document's missed-opportunity rule.",
        risk_checks: ["Avoid scaling beyond 25% in one step."],
      },
    };
  }

  if (problem.triggers.includes("google_is_budget_lost")) {
    return {
      ruleId: "google_is_budget",
      title: "L1 (SOP)",
      action: "Increase budget or adjust bid",
      confidence: 70,
      reasoning: "Document rule match: Search IS budget loss above 20% escalates to budget or bid review.",
      execution: "MANUAL",
      actionPayload: {
        intent: `Review budget limits on ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Review impression share and budget caps.",
          "Increase budget only if CPL can tolerate additional spend.",
          "If CPL is already stressed, improve bid efficiency before adding budget.",
        ],
        strategic_rationale: "Budget expansion needs human judgment when search economics are already changing.",
        risk_checks: ["Check ROI before adding budget into a weak efficiency profile."],
      },
    };
  }

  return {
    ruleId: "escalate_to_l2",
    title: "L1 (SOP)",
    action: "Escalate to Layer 2 for root-cause analysis",
    confidence: 0,
    reasoning: "No deterministic SOP rule cleanly fits this score-driven problem, so the document requires a Layer 2 analysis.",
    execution: "MANUAL",
  };
}

function buildL2(problem: DetectedProblem, l1: ReturnType<typeof buildSopDraft>): LayerAnalysisBlock & {
  position: "AGREE" | "OVERRIDE" | "EXTEND";
  primaryAction: string;
  actionPayload?: AdCortexRecommendation["action_payload"];
  expectedOutcome: string;
} {
  const raw = problem.entity.raw || {};
  const primaryMetric = problem.rootCause.primaryMetric;
  const conflicts: string[] = [];

  let action = l1.action;
  let reasoning = `Root-cause focus is ${problem.rootCause.primaryLabel}. ${problem.rootCause.summary}`;
  let position: "AGREE" | "OVERRIDE" | "EXTEND" = l1.ruleId === "escalate_to_l2" ? "EXTEND" : "AGREE";
  let expectedOutcome = "Stabilize performance while addressing the first broken layer in the chain.";
  let actionPayload = l1.actionPayload;

  if (l1.ruleId === "zero_lead_pause" && typeof raw.learning_status === "string" && raw.learning_status.toLowerCase().includes("learning")) {
    position = "OVERRIDE";
    action = "Hold for 3 days and monitor learning instead of pausing";
    reasoning = "SOP wants an immediate pause, but the entity is still in a learning state. The document allows Layer 2 to override when current data contradicts the SOP. Conflicting data: the entity is still learning.";
    expectedOutcome = "Allow the learning phase to complete before judging final CPL efficiency.";
    actionPayload = {
      intent: `Hold ${problem.entity.name} for 3 more days`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Leave the entity live for 3 more days.",
        "Review CTR and CPL trend daily.",
        "Pause only if no improvement appears by the next review window.",
      ],
      strategic_rationale: "Learning-phase exceptions should not be auto-paused without confirming the trend.",
      risk_checks: ["Revert to the SOP pause if leads stay at zero after the hold period."],
    };
  } else if (primaryMetric === "ctr") {
    position = l1.ruleId === "zero_lead_pause" || l1.ruleId === "escalate_to_l2" ? "OVERRIDE" : "EXTEND";
    action = `Refresh creative instead of treating ${problem.rootCause.primaryLabel} as a generic CPL issue`;
    reasoning = `The cost stack points to CTR as the first broken layer. Conflicting data: reach cost is not the first failure, engagement is. The document example explicitly says a CTR drop should be treated as a creative problem, not a blanket pause.`;
    expectedOutcome = "A creative refresh should lift engagement and reduce downstream CPL pressure within the next optimization cycle.";
    actionPayload = {
      intent: `Refresh creative for ${problem.entity.name}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Replace the weakest creative or hook.",
        "Keep the audience intact while testing the new creative.",
        "Re-check CTR, CPC, and CPL after 72 hours.",
      ],
      strategic_rationale: "Creative work is required because the score breakdown shows engagement failing before conversion.",
      risk_checks: ["Fallback to pause only if CTR does not recover after the refresh."],
    };
  } else if (primaryMetric === "cvr") {
    position = l1.ruleId === "landing_page_audit" ? "AGREE" : "OVERRIDE";
    action = "Fix the conversion step before cutting traffic";
    reasoning = "The first broken layer is CVR. The document states that CVR weakness means landing page friction, form friction, or intent mismatch, so the right move is to fix the conversion step rather than blanket-pause traffic.";
    expectedOutcome = "Improving conversion friction should lower CPL without sacrificing reach.";
    actionPayload = {
      intent: `Fix conversion friction for ${problem.entity.name}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Audit form or landing page friction.",
        "Reduce complexity in the conversion step.",
        "Validate post-click tracking before changing traffic sources.",
      ],
      strategic_rationale: "Manual conversion work is required because the top-of-funnel is not the first break point.",
      risk_checks: ["Fallback to traffic cuts only if CVR stays weak after the audit."],
    };
  } else if (primaryMetric === "cpm" || primaryMetric === "cpc") {
    position = l1.ruleId === "escalate_to_l2" ? "EXTEND" : "OVERRIDE";
    action = problem.platform === "google"
      ? "Tighten search efficiency before expanding spend"
      : "Relieve cost pressure through audience or bidding cleanup";
    reasoning = `The first broken layer is ${problem.rootCause.primaryLabel}. The document treats this as an upstream cost problem, so the entity should not be diagnosed as 'high CPL' in isolation.`;
    expectedOutcome = "Reducing upstream auction pressure should lower click cost and improve CPL without an unnecessary pause.";
    actionPayload = {
      intent: `Relieve cost pressure on ${problem.entity.name}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Review bidding and audience or keyword efficiency.",
        "Trim the waste source driving CPM/CPC up.",
        "Re-check the full cost stack after the adjustment.",
      ],
      strategic_rationale: "This requires analysis and optimization work rather than direct API execution.",
      risk_checks: ["Do not increase budget until the upstream cost layer stabilizes."],
    };
  } else if (problem.triggers.includes("winner_underfunded")) {
    position = "AGREE";
    action = "Scale the winner and monitor frequency";
    reasoning = "Layer 2 agrees with the SOP because the score profile already validates a winner and the opportunity is budget utilization, not a broken KPI.";
    expectedOutcome = "A measured scale should increase lead volume while keeping CPL in range.";
  }

  return {
    title: "L2 (AI)",
    action,
    confidence: Math.max(l1.confidence, position === "OVERRIDE" ? 78 : 82),
    reasoning,
    data: conflicts.length > 0 ? conflicts : undefined,
    position,
    primaryAction: action,
    actionPayload,
    expectedOutcome,
  };
}

function canonicalActionMatch(action: string): string {
  const normalized = action.toLowerCase();
  if (normalized.includes("pause")) return "pause";
  if (normalized.includes("scale")) return "scale";
  if (normalized.includes("creative")) return "creative";
  if (normalized.includes("landing") || normalized.includes("conversion") || normalized.includes("audit")) return "landing";
  if (normalized.includes("budget")) return "budget";
  return normalized;
}

function findRecentActionMatches(problem: DetectedProblem, recentActions: LearningEntry[], action: string) {
  const canonical = canonicalActionMatch(action);
  const sameEntity = recentActions.filter((entry) => entry.entityId === problem.entity.id);
  const exactAction = sameEntity.filter((entry) => canonicalActionMatch(entry.action) === canonical);
  const similarAction = recentActions.filter(
    (entry) => entry.entityType === problem.entity.type && canonicalActionMatch(entry.action) === canonical,
  );
  return { sameEntity, exactAction, similarAction };
}

function buildL3(problem: DetectedProblem, l2: ReturnType<typeof buildL2>, ctx: AssembledContext): LayerAnalysisBlock & {
  confidenceDelta: number;
  recurringIssue: boolean;
} {
  const { sameEntity, exactAction, similarAction } = findRecentActionMatches(problem, ctx.layer3.recentActions as LearningEntry[], l2.primaryAction);
  const positiveSimilar = similarAction.filter((entry) => entry.outcome === "POSITIVE").length;
  const negativeExact = exactAction.filter((entry) => entry.outcome === "NEGATIVE").length;
  const cooldownHit = sameEntity.some((entry) => {
    const executedAt = new Date(entry.executedAt).getTime();
    return Number.isFinite(executedAt) && Date.now() - executedAt < 72 * 60 * 60 * 1000;
  });
  const recurringIssue = sameEntity.length >= 3;

  let confidenceDelta = 0;
  let reasoning = "No strong historical contradiction was found, so Layer 3 leaves the action largely intact.";

  if (positiveSimilar >= 2) {
    confidenceDelta += 10;
    reasoning = `History supports this action: similar entities had ${positiveSimilar} positive outcomes for the same action pattern.`;
  }

  if (negativeExact > 0) {
    confidenceDelta -= 15;
    reasoning = "History cautions against repeating the exact same action on this entity because it already failed before.";
  }

  if (cooldownHit) {
    confidenceDelta -= 10;
    reasoning = "This entity was actioned within the last 72 hours, so the document says it is too soon to judge the last change.";
  }

  if (recurringIssue) {
    confidenceDelta -= 8;
    reasoning += " The entity has been flagged repeatedly, which points to a structural issue rather than a one-off tweak.";
  }

  return {
    title: "L3 (History)",
    action: confidenceDelta < -10 ? "Proceed with caution" : "History validates current direction",
    confidence: Math.max(0, Math.min(100, l2.confidence + confidenceDelta)),
    reasoning,
    confidenceDelta,
    recurringIssue,
  };
}

function buildL4(problem: DetectedProblem, action: string, ctx: AssembledContext): LayerAnalysisBlock & {
  veto: boolean;
} {
  const normalizedAction = canonicalActionMatch(action);
  const strategicInputs = ctx.layer4.strategicInputs || [];
  const overrideHistory = ctx.layer4.overrideHistory || [];
  const matchedStrategicInput = strategicInputs.find((entry) => {
    const entityMatch = entry.entityName && problem.entity.name.toLowerCase().includes(entry.entityName.toLowerCase());
    const actionMatch = entry.action && canonicalActionMatch(entry.action) === normalizedAction;
    return entityMatch || actionMatch;
  });

  const matchedOverride = overrideHistory.find((entry) => canonicalActionMatch(entry.strategicCall || entry.action) === normalizedAction);
  const text = [matchedStrategicInput?.reason, matchedStrategicInput?.strategicCall, matchedOverride?.strategicCall]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const veto = normalizedAction === "pause" && (text.includes("brand presence") || text.includes("launch"));
  let reasoning = "No strategic constraint blocks the data-backed action.";

  if (matchedStrategicInput) {
    reasoning = `Layer 4 found prior buyer context: ${matchedStrategicInput.reason || matchedStrategicInput.strategicCall}.`;
  } else if (matchedOverride) {
    reasoning = `Layer 4 found a related override history entry: ${matchedOverride.strategicCall}.`;
  }

  if (veto) {
    reasoning += " That context conflicts with a pause, so the system should not auto-resolve the conflict.";
  }

  return {
    title: "L4 (Strategy)",
    action: veto ? "Strategic constraint blocks the pause" : "Strategy allows the action",
    confidence: veto ? 65 : 85,
    reasoning,
    veto,
  };
}

function classifyExecution(
  title: string,
  confidence: number,
  veto: boolean,
): ExecutionClassification {
  if (veto) return "REJECT";
  const keyword = toActionKeyword(title);
  if ((keyword === "pause" || keyword === "scale" || keyword === "budget") && confidence >= 85) {
    return "AUTO-EXECUTE";
  }
  if (keyword === "clarify") return "MANUAL";
  return "MANUAL";
}

function riskFor(action: string, classification: ExecutionClassification): "Low" | "Medium" | "High" {
  if (classification === "REJECT") return "High";
  const keyword = toActionKeyword(action);
  if (keyword === "pause") return "Medium";
  if (keyword === "scale" || keyword === "budget") return "Medium";
  if (keyword === "creative" || keyword === "landing") return "Low";
  return "Low";
}

function primarySteps(actionPayload?: AdCortexRecommendation["action_payload"], fallbackTitle?: string): string[] {
  if (actionPayload?.execution_plan?.length) return actionPayload.execution_plan;
  if (!fallbackTitle) return ["Review the entity manually."];
  return [fallbackTitle];
}

function rejectSolution(problem: DetectedProblem, l1: ReturnType<typeof buildSopDraft>, l2: ReturnType<typeof buildL2>): SolutionOption | null {
  if (l1.ruleId === "escalate_to_l2" || l1.action === l2.primaryAction) return null;

  return {
    classification: "REJECT",
    title: l1.action,
    rationale: `Layer 1 proposed "${l1.action}", but Layer 2 overrode it because ${l2.reasoning.toLowerCase()}`,
    steps: ["Do not execute the rejected action unless a human deliberately overrides it."],
    risk: "High",
    confidence: Math.max(55, l1.confidence),
    expectedOutcome: "Rejecting the SOP fallback avoids executing an action that current data does not support.",
    actionPayload: {
      intent: `Reject ${l1.action}`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: ["Keep the rejected option visible as a conflict note only."],
      strategic_rationale: "The document requires explicit conflict visibility instead of silently hiding disagreement.",
      risk_checks: [],
    },
  };
}

export function runSolutionPipeline(problem: DetectedProblem, ctx: AssembledContext): RecommendationCard {
  const l1 = buildSopDraft(problem, ctx);
  const l2 = buildL2(problem, l1);
  const l3 = buildL3(problem, l2, ctx);
  const l4 = buildL4(problem, l2.primaryAction, ctx);

  const conflicts: string[] = [];
  if (l1.action !== l2.primaryAction) {
    conflicts.push(`SOP says "${l1.action}" but Layer 2 recommends "${l2.primaryAction}" because current data points to ${problem.rootCause.primaryLabel}.`);
  }
  if (l3.confidenceDelta < 0) {
    conflicts.push(`History cautions the current action by ${Math.abs(l3.confidenceDelta)} confidence points.`);
  }
  if (l4.veto) {
    conflicts.push("Strategic context blocks an automatic pause, so the conflict must stay visible to the buyer.");
  }

  const finalConfidence = Math.max(0, Math.min(100, l3.confidence + (l4.veto ? -10 : 5)));
  const classification = classifyExecution(l2.primaryAction, finalConfidence, l4.veto);

  const primarySolution: SolutionOption = {
    classification,
    title: l2.primaryAction,
    rationale: `${l2.reasoning} ${l3.reasoning} ${l4.reasoning}`.trim(),
    steps: primarySteps(l2.actionPayload, l2.primaryAction),
    risk: riskFor(l2.primaryAction, classification),
    confidence: finalConfidence,
    expectedOutcome: l2.expectedOutcome,
    actionPayload: l2.actionPayload,
  };

  const alternativeReject = rejectSolution(problem, l1, l2);

  return {
    id: problem.id,
    severity: problem.severity,
    platform: problem.platform,
    entity: {
      id: problem.entity.id,
      name: problem.entity.name,
      type: problem.entity.type,
      score: problem.entity.score,
      classification: problem.entity.classification,
    },
    diagnosis: {
      symptom: problem.symptom,
      problem: problem.problemStatement,
      data: problem.dataPoints,
      rootCauseChain: problem.rootCause.chain.map((step) => `${step.label} ${step.score.toFixed(0)}/100`),
    },
    layerAnalysis: {
      l1,
      l2,
      l3,
      l4,
      conflicts,
    },
    solutions: alternativeReject ? [primarySolution, alternativeReject] : [primarySolution],
    expectedOutcome: problem.expectedIfIgnored,
  };
}

function severityWeight(severity: SeverityTier): number {
  return severity === "CRITICAL" ? 300 : severity === "MEDIUM" ? 200 : 100;
}

function commandRelevance(card: RecommendationCard, solution: SolutionOption, message?: string): number {
  if (!message) return 0;
  const text = message.toLowerCase();
  const solutionText = `${solution.title} ${solution.rationale}`.toLowerCase();
  const entityText = `${card.entity.name} ${card.entity.type}`.toLowerCase();
  let score = 0;

  if (text.includes("pause") && solutionText.includes("pause")) score += 120;
  if (text.includes("scale") && solutionText.includes("scale")) score += 120;
  if ((text.includes("winner") || text.includes("scale")) && card.entity.classification === "WINNER") score += 60;
  if ((text.includes("underperform") || text.includes("loser") || text.includes("bad")) && card.entity.score < 35) score += 60;
  if (text.includes("creative") && solutionText.includes("creative")) score += 80;
  if ((text.includes("landing") || text.includes("form") || text.includes("funnel")) && solutionText.includes("conversion")) score += 70;
  if (text.includes("budget") && solutionText.includes("budget")) score += 60;
  if (text.includes("lead") && card.diagnosis.problem.toLowerCase().includes("lead")) score += 40;

  const nameTokens = entityText.split(/\s+/).filter((token) => token.length > 4);
  if (nameTokens.some((token) => text.includes(token))) score += 100;

  return score;
}

export function cardsToRecommendations(cards: RecommendationCard[], message?: string): AdCortexRecommendation[] {
  const flattened = cards.flatMap((card) =>
    card.solutions
      .filter((solution) => solution.classification !== "REJECT")
      .map((solution) => ({ card, solution })),
  );

  return flattened
    .sort((left, right) => {
      const leftScore = severityWeight(left.card.severity) + left.solution.confidence + commandRelevance(left.card, left.solution, message);
      const rightScore = severityWeight(right.card.severity) + right.solution.confidence + commandRelevance(right.card, right.solution, message);
      return rightScore - leftScore;
    })
    .slice(0, 5)
    .map(({ card, solution }, index) => ({
      rank: index + 1,
      action: solution.title,
      confidence: Number((solution.confidence / 100).toFixed(2)),
      source_layers: ["L1", "L2", "L3", "L4"],
      sop_alignment: card.layerAnalysis.l1.action === card.layerAnalysis.l2.action ? "agrees" : "disagrees",
      sop_position: card.layerAnalysis.l1.action,
      reasoning: `${card.diagnosis.problem}\n${solution.rationale}`,
      execution_type: solution.classification === "AUTO-EXECUTE" ? "auto" : "manual",
      risk_level: solution.risk.toLowerCase() as "low" | "medium" | "high",
      action_payload: solution.actionPayload || {
        intent: solution.title,
        platform: card.platform,
        entity_type: card.entity.type,
        entity_ids: card.entity.id ? [card.entity.id] : [],
        filters: [],
        action: { type: "clarify", parameters: {} },
        execution_plan: solution.steps,
        strategic_rationale: solution.rationale,
        risk_checks: [],
      },
    }));
}
