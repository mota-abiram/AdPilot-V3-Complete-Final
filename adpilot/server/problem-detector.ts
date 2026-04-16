import type { AssembledContext } from "./context-assembler";
import {
  traceRootCause,
  type EntityMetricScore,
  type IntelligencePlatform,
  type RootCauseTrace,
} from "./root-cause-tracer";

export type SeverityTier = "CRITICAL" | "MEDIUM" | "LOW";
export type EntityClassification = "WINNER" | "WATCH" | "UNDERPERFORMER";

export interface IntelligenceEntity {
  id?: string;
  name: string;
  type: "account" | "campaign" | "adset" | "ad_group" | "ad";
  platform: IntelligencePlatform;
  score: number;
  classification: EntityClassification;
  metrics: EntityMetricScore[];
  raw: any;
}

export interface DetectedProblem {
  id: string;
  platform: IntelligencePlatform;
  severity: SeverityTier;
  entity: IntelligenceEntity;
  symptomMetric: string;
  weakMetrics: EntityMetricScore[];
  weakKPIs: EntityMetricScore[];
  weakSupporting: EntityMetricScore[];
  symptom: string;
  problemStatement: string;
  rootCause: RootCauseTrace;
  dataPoints: string[];
  triggers: string[];
  expectedIfIgnored: string;
}

interface DetectionOptions {
  targets?: {
    cpl?: number;
    budget?: number;
    leads?: number;
  };
}

const KPI_KEYS = new Set(["cpl", "cpsv", "cpql", "leads", "budget"]);

const METRIC_LABELS: Record<string, string> = {
  cpl: "CPL",
  cpsv: "CPSV",
  cpql: "CPQL",
  leads: "Leads",
  budget: "Budget",
  cpm: "CPM",
  ctr: "CTR",
  cpc: "CPC",
  cvr: "CVR",
  freq: "Frequency",
  frequency: "Frequency",
  qs: "Quality Score",
  quality_score: "Quality Score",
  is: "Impression Share",
  rsa: "Ad Strength",
  creative: "Creative",
  creative_age: "Creative Age",
};

function toNumber(value: any, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMetricKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === "frequency") return "freq";
  if (normalized === "quality_score") return "qs";
  if (normalized === "campaign") return "campaign";
  return normalized;
}

function classifyEntity(score: number): EntityClassification {
  if (score >= 70) return "WINNER";
  if (score < 35) return "UNDERPERFORMER";
  return "WATCH";
}

function metricValueForEntity(entity: any, metricKey: string): number | null {
  switch (normalizeMetricKey(metricKey)) {
    case "cpl":
      return toNumber(entity.cpl ?? entity.overall_cpl, 0);
    case "cpsv":
      return toNumber(entity.cpsv, 0);
    case "cpql":
      return toNumber(entity.cpql, 0);
    case "budget":
      return toNumber(
        entity.budget_utilization_pct
          ?? entity.spend_pct
          ?? entity.mtd_pacing
          ?? entity.projected_eom?.spend
          ?? entity.daily_budget,
        0,
      );
    case "leads":
      return toNumber(entity.leads ?? entity.conversions ?? entity.total_leads ?? entity.total_leads_30d, 0);
    case "cpm":
      return toNumber(entity.cpm ?? entity.overall_cpm, 0);
    case "ctr":
      return toNumber(entity.ctr ?? entity.overall_ctr, 0);
    case "cpc":
      return toNumber(entity.cpc ?? entity.avg_cpc ?? entity.overall_cpc, 0);
    case "cvr":
      return toNumber(entity.cvr ?? entity.overall_cvr, 0);
    case "freq":
      return toNumber(entity.frequency ?? entity.overall_frequency, 0);
    case "qs":
      return toNumber(entity.qs_avg ?? entity.quality_score, 0);
    case "is":
      return toNumber(entity.search_budget_lost_is ?? entity.search_impression_share ?? entity.search_is, 0);
    case "rsa":
      return toNumber(entity.rsa_count ?? entity.ad_strength_score, 0);
    case "creative_age":
      return toNumber(entity.creative_age_days ?? entity.age_days ?? entity.age_score, 0);
    case "creative":
      return toNumber(entity.creative_score ?? entity.performance_score, 0);
    default:
      return null;
  }
}

function extractMetricsFromBreakdown(entity: any, breakdown: Record<string, any> | undefined): EntityMetricScore[] {
  if (!breakdown || typeof breakdown !== "object") return [];

  return Object.entries(breakdown)
    .map(([rawKey, rawValue]) => {
      const key = normalizeMetricKey(rawKey);
      const score = typeof rawValue === "number" ? rawValue : toNumber(rawValue?.score, 0);
      const weight = typeof rawValue === "number" ? undefined : toNumber(rawValue?.weight, 0);
      return {
        key,
        label: METRIC_LABELS[key] || key.toUpperCase(),
        score,
        weight,
        value: metricValueForEntity(entity, key),
        category: KPI_KEYS.has(key) ? "kpi" : "supporting",
      } satisfies EntityMetricScore;
    })
    .filter((metric) => Number.isFinite(metric.score));
}

function buildAccountEntity(analysisData: any, platform: IntelligencePlatform): IntelligenceEntity | null {
  const accountScore = toNumber(analysisData?.account_health_score ?? analysisData?.account_pulse?.health_score, NaN);
  const breakdown = analysisData?.account_health_breakdown;
  if (!Number.isFinite(accountScore) && !breakdown) return null;

  const raw = {
    ...analysisData?.account_pulse,
    ...(analysisData?.monthly_pacing || analysisData?.budget_pacing || {}),
    ...analysisData,
  };

  return {
    id: "account",
    name: "Account Health",
    type: "account",
    platform,
    score: Number.isFinite(accountScore) ? accountScore : 0,
    classification: classifyEntity(Number.isFinite(accountScore) ? accountScore : 0),
    metrics: extractMetricsFromBreakdown(raw, breakdown),
    raw,
  };
}

function getCampaignEntities(analysisData: any, platform: IntelligencePlatform): IntelligenceEntity[] {
  const campaigns = analysisData?.campaign_audit || analysisData?.campaign_performance || analysisData?.campaigns || [];
  return campaigns.map((campaign: any) => ({
    id: campaign.campaign_id || campaign.id,
    name: campaign.campaign_name || campaign.name || "Unnamed Campaign",
    type: "campaign",
    platform,
    score: toNumber(campaign.health_score ?? campaign.score, 0),
    classification: classifyEntity(toNumber(campaign.health_score ?? campaign.score, 0)),
    metrics: extractMetricsFromBreakdown(campaign, campaign.detailed_breakdown || campaign.score_breakdown),
    raw: campaign,
  }));
}

function getSubEntities(analysisData: any, platform: IntelligencePlatform): IntelligenceEntity[] {
  const topLevel = analysisData?.adset_analysis || analysisData?.ad_group_analysis || [];
  if (Array.isArray(topLevel) && topLevel.length > 0) {
    return topLevel.map((entity: any) => ({
      id: entity.adset_id || entity.ad_group_id || entity.id,
      name: entity.adset_name || entity.ad_group_name || entity.name || "Unnamed Entity",
      type: platform === "google" ? "ad_group" : "adset",
      platform,
      score: toNumber(entity.health_score ?? entity.score, 0),
      classification: classifyEntity(toNumber(entity.health_score ?? entity.score, 0)),
      metrics: extractMetricsFromBreakdown(entity, entity.detailed_breakdown || entity.score_breakdown),
      raw: entity,
    }));
  }

  const campaignEntities = analysisData?.campaigns || [];
  const nested = campaignEntities.flatMap((campaign: any) => campaign.ad_groups || []);
  return nested.map((entity: any) => ({
    id: entity.ad_group_id || entity.id,
    name: entity.ad_group_name || entity.name || "Unnamed Ad Group",
    type: "ad_group",
    platform,
    score: toNumber(entity.health_score ?? entity.score, 0),
    classification: classifyEntity(toNumber(entity.health_score ?? entity.score, 0)),
    metrics: extractMetricsFromBreakdown(entity, entity.detailed_breakdown || entity.score_breakdown),
    raw: entity,
  }));
}

function getAdEntities(analysisData: any, platform: IntelligencePlatform): IntelligenceEntity[] {
  const ads = analysisData?.creative_health || analysisData?.ad_analysis || [];
  return ads.map((ad: any) => ({
    id: ad.ad_id || ad.id,
    name: ad.ad_name || ad.name || "Unnamed Ad",
    type: "ad",
    platform,
    score: toNumber(ad.performance_score ?? ad.creative_score ?? ad.health_score, 0),
    classification: classifyEntity(toNumber(ad.performance_score ?? ad.creative_score ?? ad.health_score, 0)),
    metrics: extractMetricsFromBreakdown(ad, ad.detailed_breakdown || ad.score_breakdown),
    raw: ad,
  }));
}

function findWeakMetrics(entity: IntelligenceEntity): EntityMetricScore[] {
  return entity.metrics
    .filter((metric) => metric.score < 60)
    .sort((left, right) => left.score - right.score);
}

function metricSummary(metric: EntityMetricScore): string {
  if (metric.value == null || Number.isNaN(metric.value)) {
    return `${metric.label} score ${metric.score.toFixed(0)}/100`;
  }
  return `${metric.label} ${metric.value} (score ${metric.score.toFixed(0)}/100)`;
}

function getTargetCpl(ctx: AssembledContext, analysisData: any): number {
  const target = toNumber(ctx.layer1.clientTargets?.cpl, 0);
  if (target > 0) return target;
  const dynamic = toNumber(analysisData?.dynamic_thresholds?.cpl_target, 0);
  if (dynamic > 0) return dynamic;
  const monthly = toNumber(analysisData?.monthly_pacing?.targets?.cpl, 0);
  if (monthly > 0) return monthly;
  const live = toNumber(analysisData?.account_pulse?.overall_cpl, 0);
  return live > 0 ? live : 0;
}

function detectSeverity(
  entity: IntelligenceEntity,
  weakKPIs: EntityMetricScore[],
  weakSupporting: EntityMetricScore[],
  analysisData: any,
  ctx: AssembledContext,
): { severity: SeverityTier; triggers: string[] } {
  const triggers: string[] = [];
  const targetCpl = getTargetCpl(ctx, analysisData);
  const raw = entity.raw || {};

  if (entity.type === "account" && entity.score < 55) {
    triggers.push("account_score_below_55");
  }

  if (weakKPIs.some((metric) => metric.score < 15)) {
    triggers.push("kpi_below_15");
  }

  const spend = toNumber(raw.spend ?? raw.cost ?? analysisData?.monthly_pacing?.mtd?.spend, 0);
  const leads = toNumber(raw.leads ?? raw.conversions ?? raw.total_leads ?? raw.total_leads_30d, 0);
  if (targetCpl > 0 && spend > targetCpl * 2 && leads === 0) {
    triggers.push("zero_lead_budget_drain");
  }

  const pacing = analysisData?.monthly_pacing?.pacing;
  const spendPct = toNumber(pacing?.spend_pct, 100);
  const daysRemaining = toNumber(analysisData?.monthly_pacing?.days_remaining, 99);
  if (Math.abs(spendPct - 100) > 25 && daysRemaining < 10) {
    triggers.push("budget_pacing_emergency");
  }

  const scoreDrop = toNumber(raw.score_drop_48h ?? raw.health_score_drop_48h, 0);
  if (scoreDrop > 25) {
    triggers.push("entity_freefall");
  }

  if (triggers.length > 0) {
    return { severity: "CRITICAL", triggers };
  }

  if (entity.score < 35) {
    triggers.push("entity_score_below_35");
  }

  if (weakKPIs.some((metric) => metric.score >= 15 && metric.score <= 40)) {
    triggers.push("kpi_alert_zone");
  }

  if (weakMetricsCount(weakKPIs, weakSupporting) >= 3) {
    triggers.push("multiple_weak_metrics");
  }

  const freqMetric = weakSupporting.find((metric) => normalizeMetricKey(metric.key) === "freq");
  if (freqMetric && freqMetric.score < 40) {
    triggers.push("frequency_breach");
  }

  const creativeAgeScore = toNumber(raw.age_score, 100);
  if (creativeAgeScore < 50 && toNumber(raw.spend_share_pct ?? raw.spend_share, 0) > 30) {
    triggers.push("creative_aging");
  }

  if (entity.score > 70 && toNumber(raw.budget_utilization_pct, 100) < 60) {
    triggers.push("winner_underfunded");
  }

  if (entity.platform === "google" && toNumber(raw.search_budget_lost_is, 0) > 20) {
    triggers.push("google_is_budget_lost");
  }

  if (triggers.length > 0) {
    return { severity: "MEDIUM", triggers };
  }

  return { severity: "LOW", triggers: weakSupporting.length > 0 ? ["supporting_metric_only"] : ["watch_zone"] };
}

function weakMetricsCount(weakKPIs: EntityMetricScore[], weakSupporting: EntityMetricScore[]): number {
  return weakKPIs.length + weakSupporting.length;
}

function buildProblemStatement(entity: IntelligenceEntity, kpiMetric: EntityMetricScore, rootCause: RootCauseTrace): string {
  const chain = rootCause.chain
    .filter((step) => step.status !== "HEALTHY")
    .map((step) => `${step.label} ${step.score.toFixed(0)}/100`)
    .join(" -> ");

  return `${entity.type === "account" ? "Account" : entity.type} "${entity.name}" is score-led into a ${kpiMetric.label} problem. Root cause chain: ${chain || `${kpiMetric.label} ${kpiMetric.score.toFixed(0)}/100`}.`;
}

function buildExpectedIfIgnored(problem: DetectedProblem): string {
  if (problem.severity === "CRITICAL") {
    return "If no action is taken, the account is likely to keep leaking spend or miss recovery windows within the next 24 hours.";
  }

  if (problem.rootCause.primaryMetric === "ctr" || problem.rootCause.primaryMetric === "freq") {
    return "If no action is taken, creative fatigue is likely to push CPL higher over the next 3-5 days.";
  }

  if (problem.rootCause.primaryMetric === "cvr") {
    return "If no action is taken, inefficient traffic will keep converting poorly and CPL will stay elevated through the current optimization cycle.";
  }

  if (problem.triggers.includes("winner_underfunded")) {
    return "If no action is taken, the account will keep leaving efficient lead volume on the table.";
  }

  return "If no action is taken, the entity is likely to remain in the watch zone and continue dragging efficiency.";
}

function buildProblem(
  entity: IntelligenceEntity,
  symptomMetric: EntityMetricScore,
  weakMetrics: EntityMetricScore[],
  weakKPIs: EntityMetricScore[],
  weakSupporting: EntityMetricScore[],
  severity: SeverityTier,
  triggers: string[],
): DetectedProblem {
  const rootCause = traceRootCause(entity.metrics, entity.platform, symptomMetric.key);
  const dataPoints = [
    `Entity score ${entity.score.toFixed(1)}/100 (${entity.classification})`,
    ...weakMetrics.slice(0, 4).map(metricSummary),
  ];

  const symptom = `${symptomMetric.label} is scoring ${symptomMetric.score.toFixed(0)}/100 on ${entity.name}`;
  const problem: DetectedProblem = {
    id: `${entity.platform}:${entity.type}:${entity.id || entity.name}:${symptomMetric.key}`,
    platform: entity.platform,
    severity,
    entity,
    symptomMetric: symptomMetric.key,
    weakMetrics,
    weakKPIs,
    weakSupporting,
    symptom,
    problemStatement: buildProblemStatement(entity, symptomMetric, rootCause),
    rootCause,
    dataPoints,
    triggers,
    expectedIfIgnored: "",
  };

  problem.expectedIfIgnored = buildExpectedIfIgnored(problem);
  return problem;
}

function detectScoreDrivenProblems(
  entities: IntelligenceEntity[],
  analysisData: any,
  ctx: AssembledContext,
): DetectedProblem[] {
  const problems: DetectedProblem[] = [];

  for (const entity of entities) {
    const weakMetrics = findWeakMetrics(entity);
    const weakKPIs = weakMetrics.filter((metric) => metric.category === "kpi");
    const weakSupporting = weakMetrics.filter((metric) => metric.category !== "kpi");

    if (entity.score < 70) {
      if (weakKPIs.length > 0) {
        const { severity, triggers } = detectSeverity(entity, weakKPIs, weakSupporting, analysisData, ctx);
        for (const weakKpi of weakKPIs) {
          problems.push(buildProblem(entity, weakKpi, weakMetrics, weakKPIs, weakSupporting, severity, triggers));
        }
      } else if (weakSupporting.length > 0) {
        const supportingProblem = buildProblem(
          entity,
          weakSupporting[0],
          weakMetrics,
          weakKPIs,
          weakSupporting,
          "LOW",
          ["supporting_metric_only"],
        );
        supportingProblem.problemStatement = `${entity.type === "account" ? "Account" : entity.type} "${entity.name}" has weak supporting metrics, but KPIs remain healthy. This stays in optimization territory.`;
        problems.push(supportingProblem);
      }
    }

    if (entity.score > 70 && toNumber(entity.raw?.budget_utilization_pct, 100) < 60) {
      const budgetMetric = entity.metrics.find((metric) => metric.key === "budget");
      const trigger = "winner_underfunded";
      problems.push({
        id: `${entity.platform}:${entity.type}:${entity.id || entity.name}:winner_underfunded`,
        platform: entity.platform,
        severity: "MEDIUM",
        entity,
        symptomMetric: "budget",
        weakMetrics: budgetMetric ? [budgetMetric] : [],
        weakKPIs: budgetMetric ? [budgetMetric] : [],
        weakSupporting: [],
        symptom: `Winner opportunity missed on ${entity.name}`,
        problemStatement: `${entity.name} is a winner above 70/100 but budget utilization is below 60%, which the document classifies as a missed scaling opportunity.`,
        rootCause: traceRootCause(entity.metrics, entity.platform, "budget"),
        dataPoints: [
          `Entity score ${entity.score.toFixed(1)}/100 (${entity.classification})`,
          `Budget utilization ${toNumber(entity.raw?.budget_utilization_pct, 0).toFixed(1)}%`,
        ],
        triggers: [trigger],
        expectedIfIgnored: "If no action is taken, efficient lead volume remains underfunded and the account loses revenue opportunity.",
      });
    }

    if (entity.platform === "google" && toNumber(entity.raw?.search_budget_lost_is, 0) > 20) {
      problems.push({
        id: `${entity.platform}:${entity.type}:${entity.id || entity.name}:google_is_budget_lost`,
        platform: entity.platform,
        severity: "MEDIUM",
        entity,
        symptomMetric: "budget",
        weakMetrics: [],
        weakKPIs: [],
        weakSupporting: [],
        symptom: `Google impression share budget loss on ${entity.name}`,
        problemStatement: `${entity.name} is losing impression share due to budget, which the document marks as a medium-priority opportunity when Search IS budget lost exceeds 20%.`,
        rootCause: traceRootCause(entity.metrics, entity.platform, "budget"),
        dataPoints: [
          `Entity score ${entity.score.toFixed(1)}/100 (${entity.classification})`,
          `Search budget lost IS ${toNumber(entity.raw?.search_budget_lost_is, 0).toFixed(1)}%`,
        ],
        triggers: ["google_is_budget_lost"],
        expectedIfIgnored: "If no action is taken, competitors keep capturing impression share that this campaign could win back.",
      });
    }
  }

  return problems;
}

function uniqueById<T extends { id?: string; name: string; type: string; platform: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = item.id || `${item.platform}:${item.type}:${item.name}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function detectProblemsFromScores(
  analysisData: any,
  platform: IntelligencePlatform,
  ctx: AssembledContext,
  _options?: DetectionOptions,
): DetectedProblem[] {
  const accountEntity = buildAccountEntity(analysisData, platform);
  const entities = uniqueById([
    ...(accountEntity ? [accountEntity] : []),
    ...getCampaignEntities(analysisData, platform),
    ...getSubEntities(analysisData, platform),
    ...getAdEntities(analysisData, platform),
  ]);

  return detectScoreDrivenProblems(entities, analysisData, ctx).sort((left, right) => {
    const severityRank = { CRITICAL: 3, MEDIUM: 2, LOW: 1 };
    const bySeverity = severityRank[right.severity] - severityRank[left.severity];
    if (bySeverity !== 0) return bySeverity;
    return left.entity.score - right.entity.score;
  });
}
