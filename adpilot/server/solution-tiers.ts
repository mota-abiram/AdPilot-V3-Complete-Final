/**
 * Multi-Tier Solution Generation
 *
 * For each detected problem, generate three solution tiers:
 * 1. PRIMARY (AUTO-EXECUTE): Highest confidence, direct solution to root cause
 * 2. SECONDARY (MANUAL): Alternative approaches that require review
 * 3. REJECTION (REJECT): Why certain actions won't work (with confidence level)
 *
 * This ensures users see complete problem-solution mapping with clear reasoning.
 */

import type { DetectedProblem, SeverityTier } from "./problem-detector";
import type { AdCortexRecommendation } from "./prompt-templates";
import type { SolutionOption } from "./solution-pipeline";

interface TieredSolutions {
  primary: SolutionOption;
  secondary: SolutionOption[];
  rejection: SolutionOption[];
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

function getExecutionAction(
  intent: "pause" | "unpause" | "scale_up" | "scale_down" | "set_budget",
  entityType: string,
  platform: string
): string {
  const isGoogle = platform === "google";

  if (intent === "pause") {
    if (entityType === "campaign") return "PAUSE_CAMPAIGN";
    if (entityType === "adset" || entityType.includes("ad_group")) return isGoogle ? "PAUSE_AD_GROUP" : "PAUSE_ADSET";
    return "PAUSE_AD";
  }

  if (intent === "unpause") {
    if (entityType === "campaign") return isGoogle ? "ENABLE_CAMPAIGN" : "UNPAUSE_CAMPAIGN";
    if (entityType === "adset" || entityType.includes("ad_group")) return isGoogle ? "ENABLE_AD_GROUP" : "UNPAUSE_ADSET";
    return isGoogle ? "ENABLE_AD" : "UNPAUSE_AD";
  }

  if (intent === "scale_up") return "SCALE_BUDGET_UP";
  if (intent === "scale_down") return "SCALE_BUDGET_DOWN";
  if (intent === "set_budget") return isGoogle ? "SET_CAMPAIGN_BUDGET" : "SET_BUDGET";

  return intent.toUpperCase();
}

/**
 * Generate all three tiers of solutions for a detected problem
 */
export function generateSolutionTiers(
  problem: DetectedProblem,
  entityContext: { accountScore: number; entityScore: number; spend: number; leads: number }
): TieredSolutions {
  const primary = selectPrimarySolution(problem, entityContext);
  const secondary = generateSecondaryOptions(problem, primary, entityContext);
  const rejection = generateRejectionExplanations(problem, [primary, ...secondary]);

  return { primary, secondary, rejection };
}

/**
 * Select the single best solution for AUTO-EXECUTE
 * This should be low-risk, high-confidence, and directly address the root cause
 */
function selectPrimarySolution(
  problem: DetectedProblem,
  context: { accountScore: number; entityScore: number; spend: number; leads: number }
): SolutionOption {
  const trigger = problem.triggers[0];
  const riskProfile = problem.severity === "CRITICAL" ? "immediate" : "standard";

  // ZERO LEAD DRAIN: Always pause
  if (trigger === "zero_lead_budget_drain" || trigger === "zero_lead_heavy_spend") {
    return {
      classification: "AUTO-EXECUTE",
      title: `Pause ${problem.entity.name} immediately (zero leads + high spend)`,
      rationale: `This ${problem.entity.type} has spent significantly without generating leads. ` +
                 `Continuing will only drain budget. Pausing is reversible and prevents further loss.`,
      steps: [
        `1. Pause ${problem.entity.type} "${problem.entity.name}" via dashboard or API`,
        `2. Set alert to monitor replacement volume for next 72 hours`,
        `3. Reallocate budget to performers only after confirming replacement`,
        `4. Document pause reason for audit trail`,
      ],
      risk: problem.severity === "CRITICAL" ? "Low" : "Low",
      confidence: 95,
      expectedOutcome: `Budget stops leaking. Account maintains volume through replacement sources. ` +
                       `CPL improves as inefficient spend is eliminated.`,
      actionPayload: {
        intent: `Pause ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("pause", problem.entity.type, problem.platform),
          parameters: { reason: "Zero leads with high spend" },
        },
        execution_plan: [
          `Pause ${problem.entity.name} immediately`,
          "Monitor account for volume replacement over next 72 hours",
          "Reallocate budget to proven performers",
        ],
        strategic_rationale: "Pause prevents further budget drain on non-performing entity",
        risk_checks: ["Confirm zero leads are not tracking issue"],
      },
    };
  }

  // INFLATED CPC: Bid/audience review
  if (trigger === "inflated_cpc") {
    return {
      classification: "AUTO-EXECUTE",
      title: "Audit bidding strategy and audience overlap",
      rationale: `CPC is 2x+ the account average, suggesting bid competitiveness or audience fatigue. ` +
                 `Review bidding strategy to ensure bids match auction conditions.`,
      steps: [
        `1. Review bidding strategy (automated, manual, target CPA)`,
        `2. Check audience overlap with other campaigns`,
        `3. Analyze bid-to-CPC ratio trends over last 7 days`,
        `4. If automated bidding: verify learning phase is complete`,
        `5. Consider audience exclusions if overlap detected`,
      ],
      risk: "Low",
      confidence: 75,
      expectedOutcome: `Bidding strategy realigned to auction conditions. If audience overlap found, ` +
                       `exclusions prevent bid wars. CPC should normalize within 24-48 hours.`,
      actionPayload: {
        intent: `Optimize CPC for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Review bidding strategy settings",
          "Check for audience overlap with other campaigns",
          "Adjust bids or add audience exclusions if needed",
        ],
        strategic_rationale: "High CPC requires bid/audience optimization, not budget changes",
        risk_checks: ["Verify bid changes in controlled increments"],
      },
    };
  }

  // CREATIVE AGING: Refresh creative
  if (trigger === "creative_aging") {
    return {
      classification: "AUTO-EXECUTE",
      title: "Refresh creative assets to combat fatigue",
      rationale: `Creative has been running for 21+ days or shows low age score. Audience frequency ` +
                 `is rising, suggesting fatigue. Fresh creative resets impression quality.`,
      steps: [
        `1. Audit creative performance (CTR, frequency, conversion rate trends)`,
        `2. Design or source 2-3 new creative variations`,
        `3. Set up A/B test: old creative (hold) vs. new creative (test)`,
        `4. Launch over next 48 hours with 50/50 budget split`,
        `5. Monitor CTR improvement within first 3 days`,
      ],
      risk: "Low",
      confidence: 80,
      expectedOutcome: `CTR improves 10-20% within 3 days. Frequency curve flattens. ` +
                       `Conversion rate maintains or improves (new creative is typically close to old).`,
      actionPayload: {
        intent: `Refresh creative for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Audit current creative performance metrics",
          "Design or source 2-3 new creative variations",
          "Set up A/B test with 50/50 budget split",
          "Monitor CTR and frequency daily",
        ],
        strategic_rationale: "Creative fatigue requires new assets, not just budget adjustments",
        risk_checks: ["Keep top performer running at reduced spend during test"],
      },
    };
  }

  // WEAK AD STRENGTH (Google): Improve ad strength
  if (trigger === "weak_ad_strength") {
    return {
      classification: "AUTO-EXECUTE",
      title: "Improve ad strength and RSA completeness",
      rationale: `Ad strength score is below 50. Missing ad headlines/descriptions limits Google's ` +
                 `ability to optimize. Adding headlines increases ad coverage and CTR.`,
      steps: [
        `1. Review RSA completeness (Google requires min 3 headlines, 2 descriptions)`,
        `2. Add missing headlines/descriptions to reach maximum (15 headlines, 4 descriptions)`,
        `3. Use best-performing single-text ads as basis for new RSA variations`,
        `4. Focus on unique value props and CTAs`,
        `5. Launch refresh and monitor Quality Score improvement over 48 hours`,
      ],
      risk: "Low",
      confidence: 85,
      expectedOutcome: `Ad strength improves to \"Good\" or \"Excellent\". Quality Score increases 1-3 points. ` +
                       `CTR improves due to better ad coverage.`,
      actionPayload: {
        intent: `Improve ad strength for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Review current RSA headlines and descriptions",
          "Add missing headlines and descriptions",
          "Test new ad variations",
          "Monitor Quality Score improvement",
        ],
        strategic_rationale: "Improved ad strength increases Google's optimization capability",
        risk_checks: ["Test ad changes in limited volume first"],
      },
    };
  }

  // BUDGET PACING EMERGENCY: Pause high-spend, low-ROI entities
  if (trigger === "budget_pacing_emergency") {
    return {
      classification: "AUTO-EXECUTE",
      title: "Pause overspending campaigns to align pacing",
      rationale: `Budget pacing is off-track (<20% of month remaining). Must pause overspenders ` +
                 `to avoid waste and allow efficient campaigns room to spend.`,
      steps: [
        `1. Identify campaigns with spend % > daily target % (e.g., 40% spend vs 30% target)`,
        `2. Rank by CPL: pause high-CPL campaigns first`,
        `3. Pause non-performing 10-20% of spend`,
        `4. Monitor daily pacing to ensure realignment`,
        `5. Reallocate freed budget to performers`,
      ],
      risk: "Medium",
      confidence: 80,
      expectedOutcome: `Budget pacing realigns to daily targets. Spend is not wasted on poor performers. ` +
                       `Account finishes month at target ROI.`,
      actionPayload: {
        intent: `Pause overspending ${problem.entity.type}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("pause", problem.entity.type, problem.platform),
          parameters: { reason: "Budget pacing emergency" },
        },
        execution_plan: [
          "Pause high-CPL overspending entities",
          "Monitor daily pacing alignment",
          "Reallocate budget to performers",
        ],
        strategic_rationale: "Pause prevents month-end budget waste on poor performers",
        risk_checks: ["Ensure performers have capacity for reallocated budget"],
      },
    };
  }

  // WINNER UNDERFUNDED: Scale budget
  if (trigger === "winner_underfunded") {
    return {
      classification: "AUTO-EXECUTE",
      title: `Scale budget on winning ${problem.entity.type}`,
      rationale: `This ${problem.entity.type} scores above 70 but budget utilization is below 60%. ` +
                 `It is proven efficient and has room to deliver more leads at target CPL.`,
      steps: [
        `1. Calculate available daily budget: (monthly budget - MTD spend) / days remaining`,
        `2. Increase daily budget by 20-30% for this ${problem.entity.type}`,
        `3. Reallocate from underfunded or paused campaigns`,
        `4. Monitor new daily spend rate and CPL over next 48 hours`,
        `5. If CPL stays below target, scale further (up to full budget utilization)`,
      ],
      risk: "Low",
      confidence: 90,
      expectedOutcome: `Budget utilization reaches 80-100%. Lead volume increases 20-50%. ` +
                       `CPL maintains (or improves due to efficiency gains).`,
      actionPayload: {
        intent: `Scale budget for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("scale_up", problem.entity.type, problem.platform),
          parameters: { scalePercent: 25, reason: "Winner underfunded" },
        },
        execution_plan: [
          "Increase daily budget by 20-30%",
          "Monitor spend rate and CPL over 48 hours",
          "Scale further if CPL remains below target",
        ],
        strategic_rationale: "Scale proven winners to increase lead volume at target efficiency",
        risk_checks: ["Verify CPL doesn't drift above target after scaling"],
      },
    };
  }

  // GOOGLE IMPRESSION SHARE BUDGET LOSS: Increase campaign budget
  if (trigger === "google_is_budget_lost") {
    return {
      classification: "AUTO-EXECUTE",
      title: "Increase campaign budget to recover impression share",
      rationale: `Losing >20% of impression share to budget. This means ads are not showing due to ` +
                 `insufficient daily budget. More budget = more impressions = more conversions.`,
      steps: [
        `1. Review current daily budget for the campaign`,
        `2. Check historical IS when budget was higher (or estimate 10-15% budget increase)`,
        `3. Increase daily budget by 15-25%`,
        `4. Monitor Impression Share metric within 24 hours (should improve to >80%)`,
        `5. Verify CPL does not increase more than 5-10%`,
      ],
      risk: "Low",
      confidence: 85,
      expectedOutcome: `Impression share improves to >85%. Lost IS due to budget drops to <5%. ` +
                       `Volume increases 15-25%. CPL stays flat or improves.`,
      actionPayload: {
        intent: `Increase budget for ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("set_budget", problem.entity.type, problem.platform),
          parameters: { increasePercent: 20, reason: "Impression share budget loss" },
        },
        execution_plan: [
          "Increase daily budget by 15-25%",
          "Monitor impression share within 24 hours",
          "Verify CPL stays within acceptable range",
        ],
        strategic_rationale: "Budget increase recovers lost impression share and volume",
        risk_checks: ["Ensure CPL doesn't degrade after budget increase"],
      },
    };
  }

  // FREQUENCY BREACH: Rotate or pause creative
  if (trigger === "frequency_breach") {
    return {
      classification: "AUTO-EXECUTE",
      title: "Lower frequency by rotating creative or pausing delivery",
      rationale: `Frequency is high (likely 3+ impressions per user per day). This indicates audience ` +
                 `fatigue and rising costs. Frequency should be 1-2 for lead gen.`,
      steps: [
        `1. Check current frequency metric (impressions / unique reach)`,
        `2. Pause the campaign for 24 hours to let frequency reset in audience`,
        `3. When restarting, use new creative to reach fresh inventory`,
        `4. Set frequency capping: Max 2 per user per day (Meta/Google: use ad delivery settings)`,
        `5. Monitor CTR and frequency over next 48 hours`,
      ],
      risk: "Medium",
      confidence: 75,
      expectedOutcome: `Frequency normalizes to 1.5-2.5. CTR improves 5-15%. ` +
                       `CPL drops as cost-per-impression decreases from frequency fatigue lift.`,
      actionPayload: {
        intent: `Reduce frequency on ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: {
          type: getExecutionAction("scale_down", problem.entity.type, problem.platform),
          parameters: { scalePercent: 30, reason: "Frequency breach - audience fatigue" },
        },
        execution_plan: [
          "Pause campaign for 24 hours to reset frequency",
          "Introduce new creative assets",
          "Set frequency cap to 2 per user per day",
          "Monitor CTR and frequency daily",
        ],
        strategic_rationale: "Frequency reduction lowers audience fatigue and cost per impression",
        risk_checks: ["Monitor volume during and after pause"],
      },
    };
  }

  // ENTITY FREEFALL: Immediate investigation
  if (trigger === "entity_freefall") {
    return {
      classification: "AUTO-EXECUTE",
      title: "Investigate and stabilize rapid score drop",
      rationale: `Score dropped >25 points in 48 hours. This is a crisis signal indicating ` +
                 `sudden change in performance (targeting, tracking, budget, or creative).`,
      steps: [
        `1. Check monitoring logs: any config changes in last 48 hours?`,
        `2. Verify conversion tracking is firing (pixel working)`,
        `3. Check audience size: did targeting become too narrow?`,
        `4. Review spend trend: sudden changes to budget or strategy?`,
        `5. Audit creative: any changes? Is it still in delivery?`,
        `6. If cause found: revert or fix immediately. If not: pause and investigate offline.`,
      ],
      risk: "High",
      confidence: 70,
      expectedOutcome: `Root cause identified. If configurable: immediate revert. ` +
                       `Score stabilizes within 24 hours. If pause needed: buys time for diagnosis.`,
      actionPayload: {
        intent: `Investigate and stabilize ${problem.entity.name}`,
        platform: problem.platform,
        entity_type: problem.entity.type,
        entity_ids: problem.entity.id ? [problem.entity.id] : [],
        filters: buildEntityFilter(problem) as any,
        action: { type: "clarify", parameters: {} },
        execution_plan: [
          "Check monitoring logs for recent changes",
          "Verify conversion tracking and pixel firing",
          "Review targeting, budget, and creative changes",
          "Pause if needed to prevent further loss while investigating",
        ],
        strategic_rationale: "Rapid score drop requires immediate investigation to prevent further damage",
        risk_checks: ["Be ready to pause if root cause cannot be found quickly"],
      },
    };
  }

  // DEFAULT: Low-performing entity
  return {
    classification: "AUTO-EXECUTE",
    title: `Review ${problem.entity.type} targeting and performance`,
    rationale: `This ${problem.entity.type} is underperforming (score ${problem.entity.score.toFixed(0)}/100). ` +
               `Audit targeting, creative, and bidding to identify optimization levers.`,
    steps: [
      `1. Compare metrics against account average and benchmarks`,
      `2. Identify which metric is weakest (CPL, CTR, conversion rate)`,
      `3. Build hypothesis: is it targeting (wrong audience), creative (poor message), or bidding (overpaying)?`,
      `4. Design test: swap creative, adjust targeting, or lower bids`,
      `5. Monitor for 48-72 hours to validate hypothesis`,
    ],
    risk: "Low",
    confidence: 60,
    expectedOutcome: `Performance improvement hypothesis validated. Next optimizations become clear. ` +
                     `Score improves 5-15 points within 5-7 days of targeted fixes.`,
    actionPayload: {
      intent: `Review ${problem.entity.name} performance`,
      platform: problem.platform,
      entity_type: problem.entity.type,
      entity_ids: problem.entity.id ? [problem.entity.id] : [],
      filters: buildEntityFilter(problem) as any,
      action: { type: "clarify", parameters: {} },
      execution_plan: [
        "Compare metrics against account benchmarks",
        "Identify weakest metric (CPL, CTR, CVR)",
        "Build and test optimization hypothesis",
        "Monitor results for 48-72 hours",
      ],
      strategic_rationale: "Underperformance requires systematic testing of targeting, creative, and bidding",
      risk_checks: ["Test changes on small portion before full rollout"],
    },
  };
}

/**
 * Generate 2-3 alternative solutions that require manual review
 */
function generateSecondaryOptions(
  problem: DetectedProblem,
  primary: SolutionOption,
  context: { accountScore: number; entityScore: number; spend: number; leads: number }
): SolutionOption[] {
  const alternatives: SolutionOption[] = [];

  // If primary is pause, offer budget reduction as gentler alternative
  if (primary.title.toLowerCase().includes("pause")) {
    alternatives.push({
      classification: "MANUAL",
      title: `Reduce budget on ${problem.entity.name} instead of pausing`,
      rationale: `If you want to keep the ${problem.entity.type} running for brand/volume reasons, ` +
                 `consider reducing budget by 50% instead of full pause. Slower but less risky.`,
      steps: [
        `1. Set daily budget to 50% of current`,
        `2. Monitor for 48 hours`,
        `3. If performance improves: keep reduced budget and reallocate savings`,
        `4. If no improvement: consider full pause`,
      ],
      risk: "Medium",
      confidence: 65,
      expectedOutcome: `Budget drain reduced by 50%. Gives time to validate if zero leads is tracking issue. ` +
                       `If volume resumes: you didn't over-react to a temporary problem.`,
    });
  }

  // If primary is creative, offer pause alternative
  if (primary.title.toLowerCase().includes("creative")) {
    alternatives.push({
      classification: "MANUAL",
      title: "Pause the struggling creative set temporarily",
      rationale: `If designing new creative will take time, pause the old one to stop the frequency bleed. ` +
                 `Pausing buys 48-72 hours to create replacements.`,
      steps: [
        `1. Identify worst-performing 1-2 creatives (lowest CTR)`,
        `2. Pause those creatives from delivery`,
        `3. Keep top performers running`,
        `4. Design replacements in parallel`,
        `5. Launch new creatives when ready`,
      ],
      risk: "Low",
      confidence: 70,
      expectedOutcome: `Frequency drops on bad creatives. Overall CTR improves. ` +
                       `Buying time for creative refresh without hard pause.`,
    });
  }

  // Offer escalation / deeper investigation
  alternatives.push({
    classification: "MANUAL",
    title: `Get expert review on ${problem.entity.name}`,
    rationale: `Before taking action, request human expert review to understand ` +
               `the full context. Useful when problem is ambiguous or consequences of action are high-stakes.`,
    steps: [
      `1. Export entity performance report (7-day trend)`,
      `2. Schedule review meeting with account manager`,
      `3. Present root cause hypothesis and proposed solution`,
      `4. Discuss risk/reward and whether solution is right for account goals`,
      `5. Execute agreed action`,
    ],
    risk: "Low",
    confidence: 80,
    expectedOutcome: `Higher confidence in decision due to human validation. ` +
                     `Potential to uncover context that automation missed.`,
  });

  return alternatives;
}

/**
 * Generate rejection explanations: why NOT to do certain things
 */
function generateRejectionExplanations(
  problem: DetectedProblem,
  acceptedSolutions: SolutionOption[]
): SolutionOption[] {
  const rejections: SolutionOption[] = [];

  // If the problem is zero leads, don't suggest scaling
  if (problem.triggers.some(t => t.includes("zero_lead"))) {
    rejections.push({
      classification: "REJECT",
      title: "Do NOT scale budget on this entity",
      rationale: `This entity has zero leads. Scaling budget will only increase the budget drain. ` +
                 `You must first fix the conversion issue (pause, audit tracking, or change targeting) ` +
                 `before scaling budget. Scaling will waste money.`,
      steps: [], // Rejection doesn't have steps
      risk: "High",
      confidence: 95,
      expectedOutcome: `Avoided wasting potentially thousands of dollars on zero-performing spend.`,
    });
  }

  // If problem is creative aging with high frequency, don't just lower bids
  if (problem.triggers.some(t => t.includes("creative_aging"))) {
    rejections.push({
      classification: "REJECT",
      title: "Lowering bids alone will NOT fix this",
      rationale: `Creative fatigue is a message/exhaustion problem, not a cost problem. ` +
                 `Lowering bids will just show tired creative to fewer people. ` +
                 `You must refresh the creative message itself.`,
      steps: [],
      risk: "Medium",
      confidence: 85,
      expectedOutcome: `Avoided wasting time on a bid adjustment that won't fix the root issue.`,
    });
  }

  // If problem is pacing emergency, don't suggest scaling
  if (problem.triggers.some(t => t.includes("pacing_emergency"))) {
    rejections.push({
      classification: "REJECT",
      title: "Do NOT increase budgets (pacing emergency)",
      rationale: `Budget is already ahead of pacing targets. Increasing budgets will worsen overspend. ` +
                 `Must pause or reduce first to align pacing. Once aligned, scaling can resume.`,
      steps: [],
      risk: "High",
      confidence: 98,
      expectedOutcome: `Prevented budget waste from overshooting monthly targets.`,
    });
  }

  // If entity type is account and problem is severe, don't suggest pause
  if (problem.entity.type === "account" && problem.severity === "CRITICAL") {
    rejections.push({
      classification: "REJECT",
      title: "Do NOT pause the entire account",
      rationale: `Pausing all campaigns at once will stop all lead flow. Instead, identify and pause ` +
                 `individual underperforming campaigns. Leaving winners running keeps volume alive.`,
      steps: [],
      risk: "High",
      confidence: 99,
      expectedOutcome: `Prevented catastrophic volume loss. Maintains winners while fixing problems.`,
    });
  }

  return rejections;
}
