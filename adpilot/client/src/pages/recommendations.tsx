import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { AnalysisData, Recommendation, RootCause } from "@shared/schema";
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
import { UnifiedActions, type UnifiedActionItem, type ActionState } from "@/components/unified-actions";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Eye,
  AlertTriangle,
  Wrench,
  Loader2,
  Play,
  ChevronDown,
  ChevronUp,
  Pause,
  TrendingUp,
  Flame,
  BookOpen,
  Shield,
  RefreshCw,
  Target,
} from "lucide-react";
import { getLayerColor, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

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
    impact: typeof rec.impact === "number" ? rec.impact : 5,
    confidence: typeof rec.confidence === "number" ? rec.confidence : 5,
    ease: typeof rec.ease === "number" ? rec.ease : 5,
    priority: rec.priority,
    root_causes: Array.isArray(rec.root_causes) ? rec.root_causes : [],
  };
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

function isAutoExecutable(rec: Recommendation, mapping: ExecutionMapping | null): boolean {
  if (!mapping) return false;
  const action = mapping.action;
  return action.includes("PAUSE") || action.includes("SCALE") || action.includes("ENABLE");
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

// ─── Playbooks Component (moved from Audit Panel) ───────────────

function ActivePlaybooks({ data }: { data: any }) {
  const playbooks = data?.active_playbooks || data?.playbooks || [];
  if (playbooks.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Active Playbooks</span>
          <Badge variant="secondary" className="text-[10px]">{playbooks.length}</Badge>
        </div>
        <div className="space-y-2">
          {playbooks.map((pb: any, i: number) => (
            <div key={i} className="p-2.5 rounded-md bg-muted/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] font-medium text-foreground">{pb.name || pb.title || `Playbook ${i + 1}`}</span>
                {pb.status && (
                  <Badge variant="secondary" className={cn("text-[9px]",
                    pb.status === "active" ? "text-emerald-400" : "text-amber-400"
                  )}>
                    {pb.status}
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">{pb.description || pb.detail || ""}</p>
              {pb.trigger && <p className="text-[10px] text-muted-foreground mt-1">Trigger: {pb.trigger}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Fatigue Alerts Component (moved from Audit Panel) ──────────

function FatigueAlerts({ data }: { data: any }) {
  const fatigueAds = useMemo(() => {
    const ads = data?.creative_health || [];
    return ads.filter((a: any) => (a.frequency ?? 0) > 2.5 || (a.fatigue_score ?? 0) > 70);
  }, [data]);

  if (fatigueAds.length === 0) return null;

  return (
    <Card className="border-amber-500/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-foreground">Fatigue Alerts</span>
          <Badge variant="secondary" className="text-[10px] text-amber-400">{fatigueAds.length}</Badge>
        </div>
        <div className="space-y-2">
          {fatigueAds.slice(0, 5).map((ad: any, i: number) => (
            <div key={i} className="p-2.5 rounded-md bg-amber-500/5 border border-amber-500/20">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground truncate">{ad.ad_name || `Ad ${i + 1}`}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {(ad.frequency ?? 0) > 2.5 && (
                    <Badge variant="secondary" className="text-[9px] text-red-400">Freq: {(ad.frequency || 0).toFixed(1)}</Badge>
                  )}
                  {ad.fatigue_score && (
                    <Badge variant="secondary" className="text-[9px] text-amber-400">Fatigue: {ad.fatigue_score}</Badge>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {(ad.frequency ?? 0) > 4 ? "Critical fatigue — refresh immediately" : "Approaching fatigue — prepare replacement"}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function RecommendationsPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, apiBase, activeClient, activePlatformInfo, activePlatform } = useClient();
  const { execute, isExecuting } = useExecution();

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
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      await apiRequest("POST", `${apiBase}/recommendations/${id}/action`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionsQueryKey });
      toast({ title: "Action recorded", description: "Recommendation action has been saved." });
    },
  });

  const [executionStates, setExecutionStates] = useState<Record<string, "pending" | "executing" | "done" | "failed">>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<PriorityBand, boolean>>({
    immediate: false, this_week: false, strategic: false,
  });

  // Strategic Call Dialog state
  const [strategicDialog, setStrategicDialog] = useState<{
    open: boolean;
    recId: string;
    mapping: ExecutionMapping | null;
  }>({ open: false, recId: "", mapping: null });

  const enriched = useMemo(() => {
    if (!data) return [];
    const rawRecommendations = Array.isArray((data as any).recommendations) ? (data as any).recommendations : [];
    return rawRecommendations.map((rawRec, idx) => {
      const rec = normalizeRecommendationShape(rawRec);
      const executionMapping = mapRecommendationToExecution(rec, data);
      return {
        ...rec,
        idx,
        recId: `rec-${idx}`,
        priorityBand: classifyPriority(rec),
        currentAction: actionsData?.[`rec-${idx}`]?.action,
        executionMapping,
        isAutoExec: isAutoExecutable(rec, executionMapping),
      };
    }).filter((rec) => {
      if (rec.executionMapping && isEntityPaused(rec.executionMapping.entityId)) return false;
      return true;
    });
  }, [data, actionsData, isEntityPaused]);

  const sections: Record<PriorityBand, typeof enriched> = {
    immediate: enriched.filter((r) => r.priorityBand === "immediate"),
    this_week: enriched.filter((r) => r.priorityBand === "this_week"),
    strategic: enriched.filter((r) => r.priorityBand === "strategic"),
  };

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

  function openStrategicDialog(recId: string, mapping: ExecutionMapping) {
    setStrategicDialog({ open: true, recId, mapping });
  }

  async function handleStrategicConfirm(strategicCall: string) {
    const { recId, mapping } = strategicDialog;
    if (!mapping) return;
    setStrategicDialog({ open: false, recId: "", mapping: null });
    setExecutionStates((prev) => ({ ...prev, [recId]: "executing" }));
    actionMutation.mutate({ id: recId, action: "approved" });
    const result = await execute({
      action: mapping.action,
      entityId: mapping.entityId,
      entityName: mapping.entityName,
      entityType: mapping.entityType,
      params: { ...mapping.params, recommendationId: recId },
      strategicCall,
    });
    setExecutionStates((prev) => ({ ...prev, [recId]: result.success ? "done" : "failed" }));
  }

  return (
    <div className="p-6 space-y-6 max-w-[1200px]">
      {/* Strategic Call Dialog */}
      <StrategicCallDialog
        open={strategicDialog.open}
        onOpenChange={(open) => {
          if (!open) setStrategicDialog({ open: false, recId: "", mapping: null });
        }}
        actionType={strategicDialog.mapping?.action || ""}
        entityName={strategicDialog.mapping?.entityName || ""}
        entityType={strategicDialog.mapping?.entityType || "campaign"}
        platform={activePlatform}
        currentMetrics={strategicDialog.mapping?.currentMetrics}
        onConfirm={handleStrategicConfirm}
        isExecuting={isExecuting}
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
          const autoExecCount = items.filter(r => r.isAutoExec).length;
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

      {/* Playbooks & Fatigue Alerts (moved from Audit Panel) */}
      <ActivePlaybooks data={data} />
      <FatigueAlerts data={data} />

      {/* Render each priority band */}
      {(["immediate", "this_week", "strategic"] as PriorityBand[]).map((band) => {
        const cfg = PRIORITY_CONFIG[band];
        const Icon = cfg.icon;
        const items = sections[band].sort((a, b) => b.ice_score - a.ice_score);
        const isCollapsed = collapsedSections[band];
        if (items.length === 0) return null;

        return (
          <div key={band} className="space-y-3">
            {/* Section header with colored banner */}
            <div className={cn("rounded-md p-3", cfg.bg, `border ${cfg.borderColor}`)}>
              <button className="flex items-center gap-2 w-full text-left" onClick={() => toggleSection(band)} data-testid={`section-toggle-${band}`}>
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
                  const { recId, currentAction, idx, executionMapping, isAutoExec } = rec;
                  const layer = getLayerColor(rec.layer);
                  const execState = executionStates[recId];

                  return (
                    <Card
                      key={idx}
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold tabular-nums text-primary">ICE {rec.ice_score}</span>
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", cfg.bg, cfg.color)}>{cfg.label.toUpperCase()}</span>
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", layer.bg, layer.text)}>{rec.layer}</span>
                            {/* Auto-exec / Manual indicator */}
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
                          <div className="flex items-center gap-1">
                            {execState === "executing" && <Badge variant="secondary" className="text-[10px] text-blue-400"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Executing</Badge>}
                            {execState === "done" && <Badge variant="secondary" className="text-[10px] text-emerald-400"><CheckCircle2 className="w-3 h-3 mr-1" />Executed</Badge>}
                            {execState === "failed" && <Badge variant="secondary" className="text-[10px] text-red-400"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>}
                            {currentAction && !execState && (
                              <Badge variant="secondary" className={`text-[10px] ${currentAction === "approved" ? "text-emerald-400" : currentAction === "rejected" ? "text-red-400" : "text-amber-400"}`}>
                                {currentAction.charAt(0).toUpperCase() + currentAction.slice(1)}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{rec.category}</div>
                        <p className="text-sm font-medium text-foreground">{rec.action}</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.detail}</p>

                        {/* Multi Root Causes */}
                        {rec.root_causes && rec.root_causes.length > 0 && (
                          <div className="space-y-2 pt-2 border-t border-border/30">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Root Causes ({rec.root_causes.length})</span>
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
                                    <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${rc.approval_level === "auto" ? "text-emerald-400" : "text-amber-400"}`}>
                                      {rc.approval_level}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Unified Action Buttons for ALL recommendations */}
                        {!currentAction && !execState && (
                          <div className="pt-2 border-t border-border/30 space-y-2">
                            {/* Auto-executable action */}
                            {executionMapping && (
                              <div className="flex items-center justify-between gap-2 rounded-md p-2.5 bg-primary/5 border border-primary/10">
                                <div className="text-[11px] text-primary/80 flex items-center gap-1.5">
                                  <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                                  <span>{executionMapping.description}</span>
                                </div>
                                <Button
                                  size="sm"
                                  className="text-[10px] h-7 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 gap-1"
                                  onClick={() => openStrategicDialog(recId, executionMapping)}
                                  disabled={isExecuting || actionMutation.isPending}
                                  data-testid={`button-auto-exec-${idx}`}
                                >
                                  <Zap className="w-3 h-3" />
                                  Auto-Execute
                                </Button>
                              </div>
                            )}

                            {/* Standard action buttons */}
                            <div className="flex items-center gap-2 flex-wrap">
                              {executionMapping && (
                                <Button
                                  size="sm"
                                  className="text-[10px] h-7 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                  onClick={() => openStrategicDialog(recId, executionMapping)}
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
                                onClick={() => actionMutation.mutate({ id: recId, action: "approved" })}
                                disabled={actionMutation.isPending}
                                data-testid={`button-complete-${idx}`}
                              >
                                <CheckCircle2 className="w-3 h-3" /> Mark Complete
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-7 text-red-400 border-red-500/30 hover:bg-red-500/10 gap-1"
                                onClick={() => actionMutation.mutate({ id: recId, action: "rejected" })}
                                disabled={actionMutation.isPending}
                                data-testid={`button-reject-${idx}`}
                              >
                                <XCircle className="w-3 h-3" /> Reject
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-7 text-gray-400 border-gray-500/30 hover:bg-gray-500/10 gap-1"
                                onClick={() => actionMutation.mutate({ id: recId, action: "deferred" })}
                                disabled={actionMutation.isPending}
                                data-testid={`button-defer-${idx}`}
                              >
                                <Clock className="w-3 h-3" /> Defer
                              </Button>
                            </div>
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
