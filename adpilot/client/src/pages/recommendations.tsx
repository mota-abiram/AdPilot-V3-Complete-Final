import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { AnalysisData, Recommendation, RootCause, IntellectInsight } from "@shared/schema";
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
    ? ((data as any).ad_group_analysis || [])
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
      ? ((data as any).campaigns || [])
      : (data.campaign_audit || []);
    const campaign = campaigns.find((c: any) => {
      const campaignName = c.campaign_name || c.name || "";
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

  // Add fatigue alerts from creative_health
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

  // Sort: critical first
  return alerts.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.level] - order[b.level];
  });
}

function intellect_insightsToRecommendations(data: AnalysisData): EnrichedRec[] {
  const insights: IntellectInsight[] = (data as any).intellect_insights || [];
  return insights
    .filter((ins) => !ins.auto_action) // auto_action ones show in alerts
    .map((ins, idx) => {
      const priorityBand: PriorityBand =
        ins.severity === "HIGH" ? "immediate" : ins.severity === "MEDIUM" ? "this_week" : "strategic";
      const redirect_path = inferRedirectPath(ins.type, ins.entity, "");
      return {
        layer: "account",
        category: ins.type.replace(/_/g, " "),
        action: ins.detail,
        detail: `Entity: ${ins.entity}\n${ins.detail}`,
        ice_score: priorityBand === "immediate" ? 8 : priorityBand === "this_week" ? 6 : 4,
        priority: priorityBand.toUpperCase(),
        root_causes: [],
        idx: 10000 + idx,
        recId: `intellect-${idx}`,
        priorityBand,
        currentAction: undefined,
        executionMapping: null,
        isAutoExec: false,
        redirect_path,
        source: "intellect" as const,
      };
    });
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

  const enriched: EnrichedRec[] = useMemo(() => {
    if (!data) return [];

    // SOP recommendations
    const rawRecommendations = Array.isArray((data as any).recommendations) ? (data as any).recommendations : [];
    const sopRecs: EnrichedRec[] = rawRecommendations.map((rawRec: any, idx: number) => {
      const rec = normalizeRecommendationShape(rawRec);
      const executionMapping = mapRecommendationToExecution(rec, data);
      const priorityBand = classifyPriority(rec);
      const redirect_path = inferRedirectPath(rec.category, "", rec.action);
      return {
        ...rec,
        idx,
        recId: `rec-${idx}`,
        priorityBand,
        currentAction: actionsData?.[`rec-${idx}`]?.action,
        executionMapping,
        isAutoExec: isAutoExecutable(executionMapping),
        redirect_path,
        source: "sop" as const,
      };
    }).filter((rec: EnrichedRec) => {
      if (rec.executionMapping && isEntityPaused(rec.executionMapping.entityId)) return false;
      return true;
    });

    // Intellect insights converted to recommendations (non-auto_action ones)
    const intellectRecs = intellect_insightsToRecommendations(data).map((r) => ({
      ...r,
      currentAction: actionsData?.[r.recId]?.action,
    }));

    // Deduplicate by category+action combo (same entity+issue)
    const seen = new Set<string>();
    const all = [...sopRecs, ...intellectRecs].filter((r) => {
      const key = `${r.category}:${r.action.slice(0, 40)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return all;
  }, [data, actionsData, isEntityPaused]);

  const sections: Record<PriorityBand, EnrichedRec[]> = {
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
    <div className="p-6 space-y-6 max-w-[1200px]">
      {/* Strategic Call Dialog — used for ALL actions */}
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

      <div>
        <h1 className="text-lg font-semibold text-foreground">Recommendations</h1>
        <p className="text-xs text-muted-foreground">
          {activeClient?.name} · {activePlatformInfo?.label} · {enriched.length} actions · Prioritized by urgency
        </p>
      </div>

      {/* Priority Band Summary */}
      <div className="grid grid-cols-3 gap-3">
        {(["immediate", "this_week", "strategic"] as PriorityBand[]).map((band) => {
          const cfg = PRIORITY_CONFIG[band];
          const Icon = cfg.icon;
          const items = sections[band];
          const autoExecCount = items.filter((r) => r.isAutoExec).length;
          return (
            <div key={band} className={cn("flex items-center gap-3 px-3 py-2.5 rounded-md border", cfg.borderColor, cfg.bg)}>
              <Icon className={cn("w-4 h-4 shrink-0", cfg.color)} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold tabular-nums">{items.length}</span>
                  <span className={cn("text-[10px] font-medium", cfg.color)}>{cfg.label}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {autoExecCount > 0 && (
                    <Badge variant="secondary" className="text-[9px] text-emerald-400 bg-emerald-500/10 gap-0.5">
                      <Zap className="w-2.5 h-2.5" /> {autoExecCount} auto
                    </Badge>
                  )}
                  <span className="text-[9px] text-muted-foreground">
                    {items.length - autoExecCount} manual
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alert System — replaces Active Playbooks */}
      <AlertSystemPanel alerts={alerts} onNavigate={navigate} />

      {/* Render each priority band */}
      {(["immediate", "this_week", "strategic"] as PriorityBand[]).map((band) => {
        const cfg = PRIORITY_CONFIG[band];
        const Icon = cfg.icon;
        const items = sections[band].sort((a, b) => b.ice_score - a.ice_score);
        const isCollapsed = collapsedSections[band];
        if (items.length === 0) return null;

        return (
          <div key={band} className="space-y-3">
            <div className={cn("rounded-md p-3", cfg.bg, `border ${cfg.borderColor}`)}>
              <button
                className="flex items-center gap-2 w-full text-left"
                onClick={() => toggleSection(band)}
                data-testid={`section-toggle-${band}`}
              >
                <Icon className={cn("w-4 h-4", cfg.color)} />
                <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
                <Badge variant="secondary" className="text-[10px] ml-1">{items.length}</Badge>
                <span className="text-[10px] text-muted-foreground ml-2">{cfg.description}</span>
                <span className="ml-auto">
                  {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
                </span>
              </button>
            </div>

            {!isCollapsed && (
              <div className="space-y-3">
                {items.map((rec) => {
                  const { recId, currentAction, idx, executionMapping, isAutoExec, redirect_path, source } = rec;
                  const layer = getLayerColor(rec.layer);
                  const execState = executionStates[recId];
                  const actionTimestamp = actionsData?.[recId]?.timestamp;

                  return (
                    <Card
                      key={recId}
                      className={cn("transition-all",
                        execState === "done" ? "border-emerald-500/30 bg-emerald-500/5"
                        : execState === "failed" ? "border-red-500/30 bg-red-500/5"
                        : currentAction === "approved" ? "border-emerald-500/30 bg-emerald-500/5"
                        : currentAction === "rejected" ? "border-red-500/30 bg-red-500/5 opacity-60"
                        : currentAction === "deferred" ? "border-amber-500/30 bg-amber-500/5 opacity-75"
                        : ""
                      )}
                      data-testid={`card-recommendation-${idx}`}
                    >
                      <CardContent className="p-4 space-y-3">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold tabular-nums text-primary">ICE {rec.ice_score}</span>
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", cfg.bg, cfg.color)}>
                              {cfg.label.toUpperCase()}
                            </span>
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", layer.bg, layer.text)}>
                              {rec.layer}
                            </span>
                            {source === "intellect" && (
                              <Badge variant="secondary" className="text-[9px] px-1.5 py-0 text-purple-400 bg-purple-500/10 gap-0.5">
                                <Brain className="w-2.5 h-2.5" /> AI Insight
                              </Badge>
                            )}
                            {isAutoExec ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-emerald-400 bg-emerald-500/10 gap-0.5">
                                <Zap className="w-2.5 h-2.5" /> Auto-Executable
                              </Badge>
                            ) : executionMapping ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-primary bg-primary/10">Executable</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-muted-foreground bg-muted/50">
                                <Wrench className="w-2.5 h-2.5 mr-0.5" /> Manual Only
                              </Badge>
                            )}
                          </div>

                          {/* Status + timestamp */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {actionTimestamp && (
                              <span className="text-[9px] text-muted-foreground/60">{timeAgo(actionTimestamp)}</span>
                            )}
                            {execState === "executing" && (
                              <Badge variant="secondary" className="text-[10px] text-blue-400">
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />Executing
                              </Badge>
                            )}
                            {execState === "done" && (
                              <Badge variant="secondary" className="text-[10px] text-emerald-400">
                                <CheckCircle2 className="w-3 h-3 mr-1" />Executed
                              </Badge>
                            )}
                            {execState === "failed" && (
                              <Badge variant="secondary" className="text-[10px] text-red-400">
                                <XCircle className="w-3 h-3 mr-1" />Failed
                              </Badge>
                            )}
                            {currentAction && !execState && (
                              <Badge variant="secondary" className={cn("text-[10px]",
                                currentAction === "approved" ? "text-emerald-400"
                                : currentAction === "rejected" ? "text-red-400"
                                : "text-amber-400"
                              )}>
                                {currentAction === "approved" ? "Executed" : currentAction === "rejected" ? "Rejected" : "Deferred"}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{rec.category}</div>
                        <p className="text-sm font-medium text-foreground">{rec.action}</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.detail}</p>

                        {/* Root Causes */}
                        {rec.root_causes && rec.root_causes.length > 0 && (
                          <div className="space-y-2 pt-2 border-t border-border/30">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                              Root Causes ({rec.root_causes.length})
                            </span>
                            {rec.root_causes.map((rc: RootCause, rcIdx: number) => (
                              <div key={rcIdx} className="p-2.5 rounded-md bg-muted/30 border border-border/30 space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="space-y-1 flex-1">
                                    <p className="text-[11px] font-medium text-foreground">{rc.cause}</p>
                                    <p className="text-[10px] text-muted-foreground">{rc.evidence}</p>
                                    <p className="text-[10px] text-primary/80">{rc.solution}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <Badge variant="secondary" className="text-[9px] px-1 py-0">ICE {rc.ice_score}</Badge>
                                    <Badge variant="secondary" className={cn("text-[9px] px-1 py-0",
                                      rc.approval_level === "auto" ? "text-emerald-400" : "text-amber-400"
                                    )}>
                                      {rc.approval_level}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        {!currentAction && !execState && (
                          <div className="pt-2 border-t border-border/30 space-y-2">
                            {/* Auto-execute button */}
                            {executionMapping && (
                              <div className="flex items-center justify-between gap-2 rounded-md p-2.5 bg-primary/5 border border-primary/10">
                                <div className="text-[11px] text-primary/80 flex items-center gap-1.5">
                                  <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                                  <span>{executionMapping.description}</span>
                                </div>
                                <Button
                                  size="sm"
                                  className="text-[10px] h-7 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 gap-1"
                                  onClick={() => openDialog(recId, executionMapping, "execute", rec)}
                                  disabled={isExecuting || actionMutation.isPending}
                                  data-testid={`button-auto-exec-${idx}`}
                                >
                                  <Zap className="w-3 h-3" /> Auto-Execute
                                </Button>
                              </div>
                            )}

                            {/* Action row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {executionMapping && (
                                <Button
                                  size="sm"
                                  className="text-[10px] h-7 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                  onClick={() => openDialog(recId, executionMapping, "execute", rec)}
                                  disabled={isExecuting || actionMutation.isPending}
                                  data-testid={`button-execute-${idx}`}
                                >
                                  <Play className="w-3 h-3" /> Execute
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-7 text-blue-400 border-blue-500/30 hover:bg-blue-500/10 gap-1"
                                onClick={() => openDialog(recId, null, "complete", rec)}
                                disabled={actionMutation.isPending}
                                data-testid={`button-complete-${idx}`}
                              >
                                <CheckCircle2 className="w-3 h-3" /> Mark Complete
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-7 text-red-400 border-red-500/30 hover:bg-red-500/10 gap-1"
                                onClick={() => openDialog(recId, null, "reject", rec)}
                                disabled={actionMutation.isPending}
                                data-testid={`button-reject-${idx}`}
                              >
                                <XCircle className="w-3 h-3" /> Reject
                              </Button>

                              {/* Navigate to relevant page */}
                              {redirect_path && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-[10px] h-7 text-muted-foreground hover:text-foreground gap-1 ml-auto"
                                  onClick={() => navigate(redirect_path)}
                                >
                                  <ExternalLink className="w-3 h-3" /> View
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Completed/rejected state — show navigate button */}
                        {(currentAction || execState === "done") && redirect_path && (
                          <div className="pt-2 border-t border-border/30">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-[10px] h-7 text-muted-foreground hover:text-foreground gap-1"
                              onClick={() => navigate(redirect_path)}
                            >
                              <ExternalLink className="w-3 h-3" /> View in {redirect_path.replace("/", "").replace("-", " ")}
                            </Button>
                          </div>
                        )}
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
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400/30 mb-3" />
            <p className="text-sm text-muted-foreground">No recommendations at this time. Account is performing within targets.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
