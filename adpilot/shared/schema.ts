// TypeScript types matching the JSON analysis structure
// No DB tables needed — this is a read-only dashboard

export interface AnalysisPeriod {
  start: string;
  end: string;
  cadence: string;
}

export interface AccountPulse {
  total_spend_30d: number;
  daily_avg_spend: number;
  latest_daily_spend: number;
  spend_ratio: number;
  spend_status: string;
  spend_trend: string;
  spend_change_pct: number;
  total_leads_30d: number;
  avg_daily_leads: number;
  latest_daily_leads: number;
  leads_trend: string;
  leads_change_pct: number;
  zero_lead_days: number;
  total_impressions: number;
  total_clicks: number;
  total_reach: number;
  overall_ctr: number;
  ctr_trend: string;
  ctr_change_pct: number;
  overall_cpc: number;
  overall_cpm: number;
  overall_cpl: number;
  not_spending_campaigns: string[];
  alerts: string[];
  daily_spends: number[];
  daily_leads: number[];
  daily_ctrs: number[];
}

export interface LayerDiagnostic {
  metric: string;
  status: string;
  value: string | number;
  benchmark: string;
  message: string;
}

export interface LayerAggregate {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpl: number;
  avg_frequency: number;
  campaign_count: number;
}

export interface CostStackLayer {
  aggregate: LayerAggregate | null;
  diagnostics: LayerDiagnostic[];
  campaign_count: number;
}

export interface CostStack {
  funnel_split_actual: Record<string, number>;
  total_spend: number;
  layers: Record<string, CostStackLayer>;
}

export interface CampaignAudit {
  campaign_id: string;
  campaign_name: string;
  layer: string;
  objective: string;
  status: string;
  health_score: number;
  score_breakdown: Record<string, number>;
  score_bands: Record<string, string>;
  classification: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  reach: number;
  leads: number;
  cpl: number;
  daily_budget: number;
  budget_remaining: number;
  budget_utilization_pct: number;
  is_lead_campaign: boolean;
  is_awareness: boolean;
  delivery_status: string;
  learning_status: string;
}

export interface CreativeHealth {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  adset_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  leads: number;
  cpl: number;
  is_video: boolean;
  thumb_stop_pct: number;
  hold_rate_pct: number;
  first_frame_rate: number;
  video_p25: number;
  video_p50: number;
  video_p75: number;
  video_p100: number;
  avg_watch_sec: number;
  creative_age_days: number | null;
  health_signals: string[];
  creative_score: number;
  scoring_type: string;
  score_breakdown: Record<string, number>;
  score_bands: Record<string, string>;
  classification: string;
  should_pause: boolean;
  auto_pause_reasons: string[];
}

export interface FatigueAlert {
  type: string;
  severity: string;
  ad_name: string;
  campaign: string;
  layer: string;
  decay_pct: number;
  ctr_before?: number;
  ctr_after?: number;
  message: string;
}

export interface ActivePlaybook {
  playbook: number;
  title: string;
  trigger: string;
  diagnosis: string[];
  actions: string[];
  layer: string;
}

export interface PatternAnalysis {
  top_ads: Array<{ name: string; cpl: number; ctr: number; spend: number; leads: number }>;
  bottom_ads: Array<{ name: string; cpl: number; ctr: number; spend: number; leads: number }>;
  patterns: Array<{ type: string; detail: string }>;
  ad_count: number;
  top_avg: { cpl: number; ctr: number; cpm: number };
  bottom_avg: { cpl: number; ctr: number; cpm: number };
}

export interface RootCause {
  cause: string;
  evidence: string;
  solution: string;
  approval_level: string;
  ice_score: number;
}

export interface Recommendation {
  priority: string;
  category: string;
  action: string;
  detail: string;
  ice_score: number;
  layer: string;
  root_causes?: RootCause[];
}

export interface BudgetPacing {
  avg_7d_spend: number;
  latest_spend: number;
  spend_anomalies: string[];
  exhausted_budgets: string[];
  under_spending: Array<{ name: string; pace: number; budget: number }>;
  funnel_split_issues: string[];
  daily_spends: number[];
}

export interface MonthlyPacing {
  month: string;
  days_elapsed: number;
  days_remaining: number;
  pct_through_month: number;
  targets: {
    budget: number;
    leads: number;
    cpl: number;
    svs: { low: number; high: number };
    cpsv: { low: number; high: number };
  };
  data_source: string;
  mtd: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    cpc: number;
    cpm: number;
    impressions: number;
    clicks: number;
  };
  expected: { spend: number; leads: number };
  projected_eom: { spend: number; leads: number; cpl: number };
  pacing: {
    spend_pct: number;
    spend_status: string;
    leads_pct: number;
    leads_status: string;
    cpl_status: string;
  };
  daily_needed: { leads: number; spend: number };
  alerts: string[];
}

export interface SopBenchmarks {
  cpm_ideal_low: number;
  cpm_ideal_high: number;
  cpm_alert: number;
  ctr_ideal_low: number;
  ctr_ideal_high: number;
  ctr_alert: number;
  ctr_critical: number;
  cpl_target_low: number;
  cpl_target_high: number;
  cpl_alert: number;
  cpl_critical: number;
  freq_tofu_mofu_warn: number;
  freq_tofu_mofu_severe: number;
  freq_bofu_warn: number;
  freq_bofu_severe: number;
  freq_general_alert: number;
  thumb_stop_target: number;
  thumb_stop_alert: number;
  hold_rate_target: number;
  hold_rate_alert: number;
  creative_max_age_days: number;
  creative_refresh_days: number;
  spend_anomaly_high: number;
  spend_anomaly_low: number;
  budget_scale_max_pct: number;
  [key: string]: number;
}

export interface AnalysisSummary {
  total_campaigns: number;
  total_spend: number;
  total_leads: number;
  avg_cpl: number;
  overall_ctr: number;
  total_fatigue_alerts: number;
  active_playbooks: number;
  total_recommendations: number;
  immediate_actions: number;
}

export interface AnalysisData {
  generated_at: string;
  period: {
    primary_7d: AnalysisPeriod;
    weekly_14d: AnalysisPeriod;
    mtd: AnalysisPeriod;
  };
  sop_benchmarks: SopBenchmarks;
  account_pulse: AccountPulse;
  cost_stack: CostStack;
  campaign_audit: CampaignAudit[];
  creative_health: CreativeHealth[];
  fatigue_alerts: FatigueAlert[];
  active_playbooks: ActivePlaybook[];
  pattern_analysis: PatternAnalysis;
  recommendations: Recommendation[];
  budget_pacing: BudgetPacing;
  monthly_pacing: MonthlyPacing;
  notifications: string[];
  summary: AnalysisSummary;
  adset_analysis: AdsetAnalysis[];
  intellect_insights: IntellectInsight[];
  dynamic_thresholds: DynamicThresholds;
  agent_version: string;
  cadence: string;
  scoring_summary: {
    total_adsets: number;
    winners: number;
    watch: number;
    underperformers: number;
    ad_scores?: {
      auto_pause?: any[];
      [key: string]: any;
    };
    [key: string]: any;
  };
  playbook_names: Record<string, string>;
}

export interface AdsetAnalysis {
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  layer: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  reach: number;
  leads: number;
  cpl: number;
  daily_budget: number;
  budget_utilization_pct: number;
  delivery_status: string;
  learning_status: string;
  health_score: number;
  classification: string; // "WINNER" | "WATCH" | "UNDERPERFORMER" | "NEW"
  score_breakdown: Record<string, number>;
  score_bands: Record<string, string>;
  should_pause: boolean;
  auto_pause_reasons: string[];
  diagnostics: Array<{ metric: string; status: string; value: string | number; benchmark: string; message: string }>;
}

export interface IntellectInsight {
  type: string;
  severity: string; // "HIGH" | "MEDIUM" | "LOW"
  entity: string;
  detail: string;
  auto_action: boolean;
}

export interface DynamicThresholds {
  cpl_target: number;
  cpl_alert: number;
  cpl_critical: number;
  cpl_auto_pause: number;
  impressions_no_lead_pause: number;
}

export type RecommendationAction = "approved" | "rejected" | "deferred";

export interface RecommendationActionRecord {
  id: string;
  action: RecommendationAction;
  timestamp: string;
}

// ─── Execution Engine Types ─────────────────────────────────────

export type ExecutionActionType =
  | "PAUSE_AD"
  | "UNPAUSE_AD"
  | "PAUSE_ADSET"
  | "UNPAUSE_ADSET"
  | "PAUSE_CAMPAIGN"
  | "UNPAUSE_CAMPAIGN"
  | "SCALE_BUDGET_UP"
  | "SCALE_BUDGET_DOWN"
  | "SET_BUDGET";

export interface ExecutionResult {
  success: boolean;
  action: ExecutionActionType | string;
  entityId: string;
  entityName: string;
  entityType: string;
  previousValue?: string;
  newValue?: string;
  metaApiResponse?: any;
  error?: string;
  timestamp: string;
  requestedBy: string;
  reason?: string;
}

export type QuickActionType =
  | "SCALE_WINNERS"
  | "PAUSE_UNDERPERFORMERS"
  | "FIX_LEARNING_LIMITED";

export interface QuickActionRequest {
  actionType: QuickActionType;
  scalePercent?: number;
}

export interface ExecutionDetails {
  entityId: string;
  entityType: "campaign" | "adset" | "ad" | "ad_group";
  executionAction: ExecutionActionType | string;
  params?: Record<string, any>;
}
