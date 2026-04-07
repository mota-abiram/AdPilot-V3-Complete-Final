import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { AnalysisData, Recommendation, RootCause, IntellectInsight, CreativeHealth } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/client-context";
import { useExecution } from "@/hooks/use-execution";
import { usePausedEntities } from "@/hooks/use-paused-entities";
import { StrategicCallDialog } from "@/components/strategic-call-dialog";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  AlertTriangle,
  Wrench,
  Loader2,
  Play,
  ChevronDown,
  ChevronUp,
  Pause,
  TrendingUp,
  Flame,
  Shield,
  Target,
  ExternalLink,
  Brain,
  AlertCircle,
  Info,
  Search,
} from "lucide-react";
import { getLayerColor, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── Redirect path inference ────────────────────────────────────

function inferRedirectPath(type: string, entity: string, category: string): string {
  const t = (type + " " + category + " " + entity).toLowerCase();
  if (t.includes("creative") || t.includes("fatigue") || t.includes("refresh")) return "/creative-calendar";
  if (t.includes("tracking") || t.includes("audit") || t.includes("pixel") || t.includes("zero_lead")) return "/audit";
  if (t.includes("adset") || t.includes("budget") || t.includes("learning") || t.includes("cannibalization")) return "/adsets";
  if (t.includes("campaign") || t.includes("diminishing") || t.includes("funnel") || t.includes("realloc")) return "/campaigns";
  return "/dashboard";
}

// ─── Execution mapping helpers ─────────────────────────────────

interface ExecutionMapping {
  action: string;
  entityType: "campaign" | "adset" | "ad" | "ad_group";
  entityId: string;
  entityName: string;
  params?: Record<string, any>;
  description: string;
  currentMetrics?: {
    spend?: number;
    leads?: number;
    cpl?: number;
    ctr?: number;
    impressions?: number;
    cpc?: number;
    cvr?: number;
  };
}

function mapRecommendationToExecution(
  rec: Recommendation,
  data: AnalysisData
): ExecutionMapping | null {
  const category = String(rec.category || "").toLowerCase();
  const action = String(rec.action || "").toLowerCase();
  const detail = String(rec.detail || "").toLowerCase();
  const isGoogle = (data as any).platform === "google";
  const entities: any[] = isGoogle
    ? ((data as any).ad_group_analysis || (data as any).campaigns || [])
    : (data.adset_analysis || []);
  const getEntityId = (e: any) => isGoogle ? e.ad_group_id : e.adset_id;
  const getEntityName = (e: any) => isGoogle ? e.ad_group_name : e.adset_name;
  const getEntityMetrics = (e: any) => ({
    spend: e.spend ?? e.cost ?? undefined,
    leads: e.leads ?? e.conversions ?? undefined,
    cpl: e.cpl ?? e.cost_per_lead ?? e.cost_per_conversion ?? undefined,
    ctr: e.ctr ?? undefined,
    impressions: e.impressions ?? undefined,
    cpc: e.cpc ?? undefined,
    cvr: e.cvr ?? e.conversion_rate ?? undefined,
  });
  const pauseAction = isGoogle ? "PAUSE_AD_GROUP" : "PAUSE_ADSET";
  const entityType = isGoogle ? "ad_group" as const : "adset" as const;
  const entityLabel = isGoogle ? "ad group" : "adset";

  if (category.includes("auto-pause") || category.includes("pause cpl")) {
    const entity = entities.find((a: any) => rec.detail.includes(getEntityName(a)));
    if (entity) {
      return {
        action: pauseAction, entityType, entityId: getEntityId(entity),
        entityName: getEntityName(entity), params: { reason: rec.detail },
        description: `Pause ${entityLabel} "${getEntityName(entity)}" due to high CPL`,
        currentMetrics: getEntityMetrics(entity),
      };
    }
    const campaigns: any[] = isGoogle
      ? ((data as any).campaign_audit || (data as any).campaigns || [])
      : (data.campaign_audit || []);
    const campaign = campaigns.find((c: any) => {
      const campaignName = c.campaign_name || c.name || "";
      const campaignId = c.campaign_id || c.id || "";
      if ((rec as any).campaign_id && campaignId === (rec as any).campaign_id) return true;
      return String(rec.detail || "").includes(campaignName);
    });
    if (campaign) {
      return {
        action: "PAUSE_CAMPAIGN", entityType: "campaign", entityId: campaign.campaign_id || campaign.id,
        entityName: campaign.campaign_name || campaign.name, params: { reason: rec.detail },
        description: `Pause campaign "${campaign.campaign_name || campaign.name}" due to high CPL`,
        currentMetrics: {
          spend: (campaign as any).spend ?? (campaign as any).cost,
          leads: (campaign as any).leads ?? (campaign as any).conversions,
          cpl: (campaign as any).cpl,
          ctr: (campaign as any).ctr,
          impressions: (campaign as any).impressions,
        },
      };
    }
    const pausable = entities.find((a: any) => a.should_pause);
    if (pausable) {
      return {
        action: pauseAction, entityType, entityId: getEntityId(pausable),
        entityName: getEntityName(pausable), params: { reason: rec.detail },
        description: `Pause ${entityLabel} "${getEntityName(pausable)}"`,
        currentMetrics: getEntityMetrics(pausable),
      };
    }
  }

  if (category.includes("combat learning limited") || category.includes("learning limited")) {
    const llEntity = entities.find((a: any) => a.learning_status === "LEARNING_LIMITED" || a.status === "LIMITED");
    if (llEntity) {
      return {
        action: "SCALE_BUDGET_UP", entityType, entityId: getEntityId(llEntity),
        entityName: getEntityName(llEntity), params: { scalePercent: 25, reason: "Combat learning limited" },
        description: `Scale up budget by 25% on "${getEntityName(llEntity)}" to exit Learning Limited`,
        currentMetrics: getEntityMetrics(llEntity),
      };
    }
  }

  if (category.includes("budget scaling") || category.includes("budget")) {
    const isScaleUp = action.includes("increase") || action.includes("scale up") || detail.includes("increase");
    const isScaleDown = action.includes("decrease") || action.includes("reduce") || action.includes("scale down") || detail.includes("reduce");
    if (isScaleUp) {
      const winner = entities.find((a: any) => a.classification === "WINNER");
      if (winner) {
        return {
          action: "SCALE_BUDGET_UP", entityType, entityId: getEntityId(winner),
          entityName: getEntityName(winner), params: { scalePercent: 20, reason: rec.detail },
          description: `Scale up budget by 20% on winner "${getEntityName(winner)}"`,
          currentMetrics: getEntityMetrics(winner),
        };
      }
    }
    if (isScaleDown) {
      const underperformer = entities.find((a: any) => a.classification === "UNDERPERFORMER");
      if (underperformer) {
        return {
          action: "SCALE_BUDGET_DOWN", entityType, entityId: getEntityId(underperformer),
          entityName: getEntityName(underperformer), params: { scalePercent: 20, reason: rec.detail },
          description: `Scale down budget by 20% on underperformer "${getEntityName(underperformer)}"`,
          currentMetrics: getEntityMetrics(underperformer),
        };
      }
    }
  }

  if (category.includes("creative pause") || category.includes("creative fatigue")) {
    const ad = data.creative_health?.find(
      (a) => rec.detail.includes(a.ad_name) || a.frequency > 2.5
    );
    if (ad) {
      return {
        action: "PAUSE_AD", entityType: "ad", entityId: ad.ad_id,
        entityName: ad.ad_name, params: { reason: rec.detail },
        description: `Pause fatigued ad "${ad.ad_name}"`,
        currentMetrics: {
          spend: (ad as any).spend,
          ctr: (ad as any).ctr,
          impressions: (ad as any).impressions,
          cpl: (ad as any).cpl,
        },
      };
    }
  }

  return null;
}

// ─── Intellect insight → unified recommendation ─────────────────

type AlertLevel = "critical" | "warning" | "info";

interface AlertItem {
  level: AlertLevel;
  title: string;
  detail: string;
  entity: string;
  redirect_path: string;
  autoAction?: boolean;
}

function intellectToAlerts(data: AnalysisData): AlertItem[] {
  const insights: IntellectInsight[] = (data as any).intellect_insights || [];
  const alerts: AlertItem[] = [];

  for (const insight of insights) {
    const level: AlertLevel =
      insight.severity === "CRITICAL" || (insight.severity === "HIGH" && insight.auto_action)
        ? "critical"
        : insight.severity === "HIGH" || insight.severity === "MEDIUM"
        ? "warning"
        : "info";

    const redirect_path = inferRedirectPath(insight.type, insight.entity, "");

    alerts.push({
      level,
      title: insight.type.replace(/_/g, " "),
      detail: insight.detail,
      entity: insight.entity,
      redirect_path,
      autoAction: insight.auto_action,
    });
  }

  const fatigued = (data.creative_health || []).filter((a: any) => (a.frequency ?? 0) > 2.5 || (a.fatigue_score ?? 0) > 70);
  for (const ad of fatigued.slice(0, 4)) {
    alerts.push({
      level: (ad.frequency ?? 0) > 4 ? "critical" : "warning",
      title: "Creative Fatigue",
      detail: `${ad.ad_name}: Frequency ${(ad.frequency || 0).toFixed(1)}x — ${(ad.frequency ?? 0) > 4 ? "Refresh immediately" : "Prepare replacement creative"}`,
      entity: ad.ad_name,
      redirect_path: "/creative-calendar",
    });
  }

  return alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.level] - order[b.level];
  });
}

// ─── Recommendations Engine Configuration (SOP) ──────────────────
const RECOMMENDATION_SOP_CONFIG = [
  { column: "Entity", description: "Campaign / Ad Set / Creative / Keyword name" },
  { column: "Entity Type", description: "Campaign / Ad Set / Creative / Ad / Keyword" },
  { column: "Issue", description: "Performance issue detected (e.g. high CPL, low CTR)" },
  { column: "Root Cause", description: "Underlying cause (from defined root types)" },
  { column: "Recommendation", description: "Actionable fix suggestion" },
  { column: "Expected Impact", description: "Estimated improvement (e.g. -15% CPL)" },
  { column: "Priority", description: "CRITICAL / HIGH / MEDIUM / LOW" },
  { column: "Confidence", description: "High / Medium / Low" },
  { column: "Category", description: "PERFORMANCE/BUDGET/AUDIENCE/CREATIVE/STRUCTURE" }
];

interface StructuredRecommendation extends EnrichedRec {
  entityLabel: string;
  entityTypeLabel: string;
  issue: string;
  rootCause: string;
  expectedImpact: string;
  confidence: "High" | "Medium" | "Low";
  categoryLabel: string;
}

function generateStructuredRecommendations(data: AnalysisData, actionsData: any, isEntityPaused: any): StructuredRecommendation[] {
  if (!data) return [];
  
  const insights: IntellectInsight[] = (data as any).intellect_insights || [];
  const recs: Recommendation[] = (data as any).recommendations || [];
  const creativeHealth: CreativeHealth[] = data.creative_health || [];

  const structured: StructuredRecommendation[] = [];

  insights.forEach((ins, idx) => {
    const priorityBand = ins.severity === "HIGH" || ins.severity === "CRITICAL" ? "immediate" : ins.severity === "MEDIUM" ? "this_week" : "strategic";
    
    structured.push({
      layer: "account",
      category: ins.type,
      action: ins.detail,
      detail: ins.detail,
      ice_score: ins.severity === "CRITICAL" ? 9 : ins.severity === "HIGH" ? 8 : 6,
      priority: ins.severity as any,
      root_causes: [],
      idx: 20000 + idx,
      recId: `intellect-${idx}`,
      priorityBand,
      currentAction: actionsData?.[`intellect-${idx}`]?.action,
      executionMapping: null,
      isAutoExec: ins.auto_action,
      redirect_path: inferRedirectPath(ins.type, ins.entity, ""),
      source: "intellect",
      
      entityLabel: ins.entity,
      entityTypeLabel: ins.type.includes("CAMPAIGN") ? "Campaign" : ins.type.includes("ADSET") ? "Ad Set" : "Account",
      issue: ins.type.replace(/_/g, " "),
      rootCause: ins.recommendation || "System detection",
      recommendation: ins.detail,
      expectedImpact: ins.score_impact ? `+${ins.score_impact} Health Score` : "Efficiency optimization",
      confidence: ins.severity === "CRITICAL" ? "High" : "Medium",
      categoryLabel: ins.type.includes("CREATIVE") ? "CREATIVE" : ins.type.includes("BUDGET") ? "BUDGET" : "PERFORMANCE"
    });
  });

  recs.forEach((rec, idx) => {
    const enrichedRec = normalizeRecommendationShape(rec);
    const executionMapping = mapRecommendationToExecution(enrichedRec, data);
    const priorityBand = classifyPriority(enrichedRec);
    
    structured.push({
      ...enrichedRec,
      idx,
      recId: `rec-${idx}`,
      priorityBand,
      currentAction: actionsData?.[`rec-${idx}`]?.action,
      executionMapping,
      isAutoExec: isAutoExecutable(executionMapping),
      redirect_path: inferRedirectPath(rec.category, "", rec.action),
      source: "sop",
      
      entityLabel: rec.layer,
      entityTypeLabel: "Layer / Audience",
      issue: (rec as any).insight || "Met KPI Deviation",
      rootCause: rec.root_causes?.[0]?.cause || "Algorithm benchmark miss",
      recommendation: rec.action,
      expectedImpact: (rec as any).impact || "CPL Stabilization",
      confidence: rec.ice_score > 7 ? "High" : "Medium",
      categoryLabel: rec.category.toUpperCase() as any
    });
  });

  creativeHealth.filter(ad => ad.should_pause || ad.creative_score < 40).forEach((ad, idx) => {
    structured.push({
      layer: "creative",
      category: "CREATIVE_REFRESH",
      action: `Refresh fatigued ad: ${ad.ad_name}`,
      detail: `CTR is low (${(ad.ctr * 100).toFixed(2)}%) despite high spend. Fatigue detected.`,
      ice_score: ad.creative_score < 30 ? 9 : 7,
      priority: ad.should_pause ? "CRITICAL" : "HIGH",
      root_causes: [{ cause: "Creative Fatigue", evidence: `Score: ${ad.creative_score}`, solution: "Refresh", ice_score: 8, approval_level: "High" }],
      idx: 30000 + idx,
      recId: `creative-${idx}`,
      priorityBand: ad.should_pause ? "immediate" : "this_week",
      currentAction: actionsData?.[`creative-${idx}`]?.action,
      executionMapping: { 
        action: "PAUSE_AD", entityType: "ad", entityId: ad.ad_id, entityName: ad.ad_name, 
        description: `Pause fatigued ad "${ad.ad_name}"`, 
        currentMetrics: { spend: ad.spend, ctr: ad.ctr, cpl: ad.cpl } 
      },
      isAutoExec: ad.should_pause,
      redirect_path: "/creative-calendar",
      source: "intellect",
      
      entityLabel: ad.ad_name,
      entityTypeLabel: "Ad (Creative)",
      issue: "Creative Fatigue / Low Score",
      rootCause: "Diminishing returns on creative assets",
      recommendation: `Pause and rotate in top-performing hooks from ${ad.campaign_name}`,
      expectedImpact: "CTR Improvement (+20%)",
      confidence: "High",
      categoryLabel: "CREATIVE"
    });
  });

  return structured.filter(r => {
     if (r.executionMapping && isEntityPaused(r.executionMapping.entityId)) return false;
     return true;
  }).sort((a, b) => b.ice_score - a.ice_score);
}

// ─── Priority classification ────────────────────────────────────

type PriorityBand = "immediate" | "this_week" | "strategic";

function classifyPriority(rec: Recommendation): PriorityBand {
  const p = rec.priority?.toUpperCase();
  if (p === "IMMEDIATE") return "immediate";
  if (p === "THIS_WEEK") return "this_week";
  if (p === "STRATEGIC") return "strategic";

  const category = rec.category.toLowerCase();
  const action = rec.action.toLowerCase();

  if (category.includes("auto-pause") || category.includes("tracking") ||
      action.includes("pause") || action.includes("stop")) {
    return "immediate";
  }
  if (category.includes("creative") || category.includes("budget") ||
      category.includes("bid") || action.includes("refresh")) {
    return "this_week";
  }
  return "strategic";
}

function isAutoExecutable(mapping: ExecutionMapping | null): boolean {
  if (!mapping) return false;
  return mapping.action.includes("PAUSE") || mapping.action.includes("SCALE") || mapping.action.includes("ENABLE");
}

function inferGoogleLayer(rec: any): string {
  const source = `${rec?.campaign || ""} ${rec?.description || ""} ${rec?.title || ""}`.toLowerCase();
  if (source.includes("demand_gen")) return "demand_gen";
  if (source.includes("lookalike")) return "lookalike";
  if (source.includes("inmarket")) return "inmarket";
  if (source.includes("brand")) return "branded";
  if (source.includes("location")) return "location";
  if (source.includes("search")) return "search";
  return "google";
}

function normalizeRecommendationShape(rec: any): Recommendation {
  return {
    layer: rec.layer || inferGoogleLayer(rec),
    category: rec.category || "general",
    action: rec.action || rec.title || rec.action_type || "Recommendation",
    detail: rec.detail || rec.description || rec.campaign || rec.title || "",
    ice_score: typeof rec.ice_score === "number" ? rec.ice_score : 5,
    priority: rec.priority,
    root_causes: Array.isArray(rec.root_causes) ? rec.root_causes : [],
  };
}

const PRIORITY_CONFIG: Record<PriorityBand, {
  label: string;
  icon: typeof AlertTriangle;
  color: string;
  bg: string;
  borderColor: string;
  description: string;
}> = {
  immediate: {
    label: "Immediate",
    icon: AlertTriangle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    borderColor: "border-red-500/30",
    description: "Auto-pause items, tracking breaks — needs attention now",
  },
  this_week: {
    label: "This Week",
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    description: "Creative refresh, budget adjustments, bid changes",
  },
  strategic: {
    label: "Strategic",
    icon: Target,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "Audience restructuring, funnel rebalancing, LP changes",
  },
};

// ─── Alert System (replaces Active Playbooks) ───────────────────

const ALERT_CONFIG = {
  critical: {
    icon: AlertCircle,
    color: "text-red-400",
    bg: "bg-red-500/8",
    border: "border-red-500/25",
    dot: "bg-red-400",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-500/8",
    border: "border-amber-500/25",
    dot: "bg-amber-400",
    label: "Warning",
  },
  info: {
    icon: Info,
    color: "text-emerald-400",
    bg: "bg-emerald-500/8",
    border: "border-emerald-500/25",
    dot: "bg-emerald-400",
    label: "Info",
  },
};

function AlertSystemPanel({ alerts, onNavigate }: { alerts: AlertItem[]; onNavigate: (path: string) => void }) {
  if (alerts.length === 0) return null;

  const criticalCount = alerts.filter((a) => a.level === "critical").length;
  const warningCount = alerts.filter((a) => a.level === "warning").length;
  const infoCount = alerts.filter((a) => a.level === "info").length;

  return (
    <Card className="border-red-500/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Active Alerts</span>
          </div>
          <div className="flex items-center gap-1.5">
            {criticalCount > 0 && (
              <Badge variant="secondary" className="text-[9px] text-red-400 bg-red-500/10">{criticalCount} critical</Badge>
            )}
            {warningCount > 0 && (
              <Badge variant="secondary" className="text-[9px] text-amber-400 bg-amber-500/10">{warningCount} warning</Badge>
            )}
            {infoCount > 0 && (
              <Badge variant="secondary" className="text-[9px] text-emerald-400 bg-emerald-500/10">{infoCount} info</Badge>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          {alerts.map((alert, i) => {
            const cfg = ALERT_CONFIG[alert.level];
            const Icon = cfg.icon;
            return (
              <button
                key={i}
                className={cn(
                  "w-full text-left p-2.5 rounded-md border transition-all hover:opacity-80 flex items-start gap-2.5",
                  cfg.bg, cfg.border
                )}
                onClick={() => onNavigate(alert.redirect_path)}
              >
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 mt-1", cfg.dot)} />
                  <Icon className={cn("w-3.5 h-3.5", cfg.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wider", cfg.color)}>
                      {alert.title}
                    </span>
                    {alert.autoAction && (
                      <Badge variant="secondary" className="text-[8px] text-emerald-400 bg-emerald-500/10 gap-0.5 px-1 py-0">
                        <Zap className="w-2 h-2" /> Auto
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{alert.detail}</p>
                  {alert.entity && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{alert.entity}</p>
                  )}
                </div>
                <ExternalLink className="w-3 h-3 text-muted-foreground/40 shrink-0 mt-0.5" />
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Types for enriched recommendations ────────────────────────

interface EnrichedRec extends Recommendation {
  idx: number;
  recId: string;
  priorityBand: PriorityBand;
  currentAction: string | undefined;
  executionMapping: ExecutionMapping | null;
  isAutoExec: boolean;
  redirect_path?: string;
  source?: "sop" | "intellect";
}

// ─── Dialog state type ─────────────────────────────────────────

type DialogMode = "execute" | "reject" | "complete";

interface DialogState {
  open: boolean;
  recId: string;
  mapping: ExecutionMapping | null;
  mode: DialogMode;
  rec?: EnrichedRec;
}

// ─── Time formatting ───────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Main Component ─────────────────────────────────────────────

export default function RecommendationsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, apiBase, activeClient, activePlatformInfo, activePlatform } = useClient();
  const { execute, isExecuting } = useExecution();
  const [, navigate] = useLocation();

  const actionsQueryKey = [apiBase, "recommendations", "actions"];
  const { data: actionsData } = useQuery<Record<string, { action: string; timestamp: string }>>({
    queryKey: actionsQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `${apiBase}/recommendations/actions`);
      return res.json();
    },
  });

  const { toast } = useToast();
  const { isPaused: isEntityPaused } = usePausedEntities();

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, strategicCall }: { id: string; action: string; strategicCall: string }) => {
      await apiRequest("POST", `${apiBase}/recommendations/${id}/action`, {
        action,
        strategic_call: strategicCall,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionsQueryKey });
      toast({ title: "Action recorded", description: "Recommendation action has been saved." });
    },
  });

  const [executionStates, setExecutionStates] = useState<Record<string, "pending" | "executing" | "done" | "failed">>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<PriorityBand, boolean>>({
    immediate: false, this_week: false, strategic: true,
  });

  const [dialogState, setDialogState] = useState<DialogState>({
    open: false, recId: "", mapping: null, mode: "execute",
  });

  // ─── Build enriched recommendation list ────────────────────────

  const enriched: StructuredRecommendation[] = useMemo(() => generateStructuredRecommendations(data as AnalysisData, actionsData, isEntityPaused), [data, actionsData, isEntityPaused]);

  const sections: Record<PriorityBand, StructuredRecommendation[]> = {
    immediate: enriched.filter((r) => r.priorityBand === "immediate"),
    this_week: enriched.filter((r) => r.priorityBand === "this_week"),
    strategic: enriched.filter((r) => r.priorityBand === "strategic"),
  };

  const alerts = useMemo(() => data ? intellectToAlerts(data) : [], [data]);

  // ─── Dialog helpers ─────────────────────────────────────────────

  function openDialog(recId: string, mapping: ExecutionMapping | null, mode: DialogMode, rec?: EnrichedRec) {
    setDialogState({ open: true, recId, mapping, mode, rec });
  }

  function getDialogConfig(): { confirmLabel: string; titleOverride: string; actionType: string; entityName: string; entityType: string } {
    const { mode, mapping, rec } = dialogState;
    if (mode === "reject") {
      return {
        confirmLabel: "Reject with Rationale",
        titleOverride: "Strategic Rationale Required",
        actionType: "REJECT",
        entityName: rec?.action || "Recommendation",
        entityType: "recommendation",
      };
    }
    if (mode === "complete") {
      return {
        confirmLabel: "Mark Complete with Rationale",
        titleOverride: "Strategic Rationale Required",
        actionType: "MARK_COMPLETE",
        entityName: rec?.action || "Recommendation",
        entityType: "recommendation",
      };
    }
    return {
      confirmLabel: "Execute with Rationale",
      titleOverride: "Strategic Call Required",
      actionType: mapping?.action || "",
      entityName: mapping?.entityName || "",
      entityType: mapping?.entityType || "campaign",
    };
  }

  async function handleDialogConfirm(strategicCall: string) {
    const { recId, mapping, mode } = dialogState;
    setDialogState({ open: false, recId: "", mapping: null, mode: "execute" });

    if (mode === "execute" && mapping) {
      setExecutionStates((prev) => ({ ...prev, [recId]: "executing" }));
      actionMutation.mutate({ id: recId, action: "approved", strategicCall });
      const result = await execute({
        action: mapping.action,
        entityId: mapping.entityId,
        entityName: mapping.entityName,
        entityType: mapping.entityType,
        params: { ...mapping.params, recommendationId: recId },
        strategicCall,
      });
      setExecutionStates((prev) => ({ ...prev, [recId]: result.success ? "done" : "failed" }));
    } else if (mode === "reject") {
      actionMutation.mutate({ id: recId, action: "rejected", strategicCall });
    } else if (mode === "complete") {
      actionMutation.mutate({ id: recId, action: "approved", strategicCall });
    }
  }

  if (isLoading || !data) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  function toggleSection(s: PriorityBand) {
    setCollapsedSections((prev) => ({ ...prev, [s]: !prev[s] }));
  }

  const dialogConfig = getDialogConfig();

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <StrategicCallDialog
        open={dialogState.open}
        onOpenChange={(open) => {
          if (!open) setDialogState({ open: false, recId: "", mapping: null, mode: "execute" });
        }}
        actionType={dialogConfig.actionType}
        entityName={dialogConfig.entityName}
        entityType={dialogConfig.entityType}
        platform={activePlatform}
        currentMetrics={dialogState.mapping?.currentMetrics}
        onConfirm={handleDialogConfirm}
        isExecuting={isExecuting}
        confirmLabel={dialogConfig.confirmLabel}
        titleOverride={dialogConfig.titleOverride}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Recommendations Master</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
            {activeClient?.name} · {activePlatformInfo?.label} · {enriched.length} Intelligence Items
          </p>
        </div>
        <div className="flex items-center gap-2">
           <Badge variant="outline" className="bg-card py-1.5 px-3 flex items-center gap-2 border-border/60">
             <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
             <span className="text-[10px] font-bold uppercase tracking-widest">Agent-v3 Active</span>
           </Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {(["immediate", "this_week", "strategic"] as PriorityBand[]).map((band) => {
          const cfg = PRIORITY_CONFIG[band];
          const Icon = cfg.icon;
          const items = sections[band];
          return (
            <button 
              key={band} 
              onClick={() => toggleSection(band)}
              className={cn("flex flex-col gap-1 px-4 py-3 rounded-xl border transition-all text-left group", 
                collapsedSections[band] ? 'opacity-50 grayscale' : '',
                cfg.borderColor, cfg.bg
              )}
            >
              <div className="flex items-center justify-between">
                <Icon className={cn("w-4 h-4", cfg.color)} />
                <span className="text-xl font-bold tabular-nums">{items.length}</span>
              </div>
              <span className={cn("text-[10px] font-black uppercase tracking-widest", cfg.color)}>{cfg.label}</span>
            </button>
          );
        })}
      </div>

      {alerts.length > 0 && <AlertSystemPanel alerts={alerts} onNavigate={navigate} />}

      {(["immediate", "this_week", "strategic"] as PriorityBand[]).map((band) => {
        const cfg = PRIORITY_CONFIG[band];
        const items = sections[band].sort((a, b) => b.ice_score - a.ice_score);
        const isCollapsed = collapsedSections[band];
        if (items.length === 0) return null;

        return (
          <div key={band} className="space-y-4">
            <div className={cn("flex items-center gap-2 px-1")}>
               <span className={cn("text-[10px] font-black uppercase tracking-[0.2em]", cfg.color)}>{cfg.label} Priority Feed</span>
               <div className="flex-1 h-px bg-border/40" />
            </div>

            {!isCollapsed && (
              <div className="grid grid-cols-1 gap-4">
                {items.map((rec) => {
                  const { recId, currentAction, idx, executionMapping, isAutoExec, redirect_path } = rec;
                  const execState = executionStates[recId];
                  const actionTimestamp = actionsData?.[recId]?.timestamp;

                  return (
                    <Card key={recId} className={cn("overflow-hidden border-border/60 hover:shadow-2xl hover:shadow-primary/5 transition-all group", 
                      currentAction === 'approved' ? 'bg-emerald-500/5' : currentAction === 'rejected' ? 'opacity-50' : '')}>
                      <CardContent className="p-0">
                        {/* THE 9-COLUMN SOP MASTER ROW */}
                        <div className="flex flex-col md:flex-row">
                          {/* Main Intelligence Block */}
                          <div className="flex-1 p-6 space-y-4">
                            <div className="flex items-start justify-between">
                               <div className="space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                     <Badge variant="secondary" className="text-[10px] font-black uppercase bg-muted/50">{rec.categoryLabel}</Badge>
                                     <Badge variant="outline" className={cn("text-[10px] uppercase font-bold", cfg.color, cfg.borderColor)}>{rec.priority.toUpperCase()}</Badge>
                                     <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{rec.entityTypeLabel}</span>
                                  </div>
                                  <h3 className="text-lg font-bold tracking-tight">{rec.entityLabel}</h3>
                               </div>
                               <div className="text-right">
                                  <div className="flex items-center gap-1.5 justify-end mb-1">
                                     <span className="text-[9px] font-bold uppercase tracking-tighter text-muted-foreground/60">Confidence</span>
                                     <Badge variant={rec.confidence === 'High' ? 'success' : 'warning'} className="text-[9px] px-1.5 py-0">{rec.confidence}</Badge>
                                  </div>
                                  <div className="text-2xl font-black text-primary/80 tabular-nums">ICE {rec.ice_score}</div>
                               </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-muted/10 rounded-xl p-5 border border-border/40">
                               <div className="space-y-1">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Detected Issue</p>
                                  <p className="text-xs font-bold text-red-400 leading-snug">{rec.issue}</p>
                               </div>
                               <div className="space-y-1">
                                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Root Cause</p>
                                  <p className="text-xs font-semibold text-foreground/80 leading-snug">{rec.rootCause}</p>
                               </div>
                            </div>

                            <div className="space-y-3">
                               <div className="flex items-start gap-4">
                                  <div className="mt-1 p-2 rounded-lg bg-primary/10 text-primary">
                                     <Zap className="w-4 h-4" />
                                  </div>
                                  <div className="space-y-1">
                                     <p className="text-[9px] font-black uppercase tracking-widest text-primary">Fix Recommendation</p>
                                     <p className="text-sm font-bold text-foreground leading-relaxed">{rec.recommendation}</p>
                                  </div>
                               </div>
                            </div>
                          </div>

                          {/* Impact & Action Panel */}
                          <div className="w-full md:w-80 bg-muted/20 border-l border-border/40 p-6 flex flex-col justify-between gap-6">
                            <div className="space-y-4">
                               <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1">
                                  <div className="flex items-center gap-1.5">
                                     <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                                     <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Expected Impact</span>
                                  </div>
                                  <p className="text-sm font-black text-emerald-300">{rec.expectedImpact}</p>
                               </div>

                               {actionTimestamp && (
                                 <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                    <Clock className="w-3.5 h-3.5" />
                                    <span>Actioned {timeAgo(actionTimestamp)}</span>
                                 </div>
                               )}
                            </div>

                            <div className="space-y-2">
                               {isAutoExec ? (
                                  <Button 
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 shadow-lg shadow-emerald-900/20 gap-2"
                                    onClick={() => openDialog(recId, executionMapping, "execute", rec)}
                                    disabled={isExecuting || actionMutation.isPending || !!currentAction}
                                  >
                                    <Zap className="w-4 h-4 fill-current" />
                                    {execState === 'executing' ? 'Executing...' : 'Auto-Execute Fix'}
                                  </Button>
                               ) : executionMapping ? (
                                  <Button 
                                    variant="default"
                                    className="w-full font-bold h-11 gap-2"
                                    onClick={() => openDialog(recId, executionMapping, "execute", rec)}
                                    disabled={isExecuting || actionMutation.isPending || !!currentAction}
                                  >
                                    <Play className="w-4 h-4" />
                                    Manual Sync
                                  </Button>
                               ) : (
                                  <Button 
                                    variant="outline"
                                    className="w-full h-11 border-dashed text-muted-foreground font-bold hover:text-foreground"
                                    onClick={() => openDialog(recId, null, "complete", rec)}
                                    disabled={!!currentAction}
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                    Mark Complete
                                  </Button>
                               )}

                               <div className="grid grid-cols-2 gap-2 mt-2">
                                  {!currentAction && (
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-[10px] font-bold uppercase"
                                      onClick={() => openDialog(recId, null, "reject", rec)}
                                    >
                                      Reject
                                    </Button>
                                  )}
                                  {redirect_path && (
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="text-muted-foreground hover:text-foreground text-[10px] font-bold uppercase ml-auto"
                                      onClick={() => navigate(redirect_path)}
                                    >
                                      Explore <ExternalLink className="w-3 h-3 ml-1" />
                                    </Button>
                                  )}
                               </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {enriched.length === 0 && (
         <div className="py-24 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto border border-emerald-500/20">
               <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="space-y-1">
               <h3 className="text-lg font-bold italic tracking-tight">System in Equilibrium</h3>
               <p className="text-sm text-muted-foreground max-w-xs mx-auto">No performance anomalies detected. All funnels are operating within target benchmarks.</p>
            </div>
         </div>
      )}
    </div>
  );
}
