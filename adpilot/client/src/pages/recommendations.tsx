import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { AnalysisData } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useClient } from "@/lib/client-context";
import { useExecution } from "@/hooks/use-execution";
import { StrategicCallDialog } from "@/components/strategic-call-dialog";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Target,
  Play,
  Search,
  Shield,
  Brain,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Unified Types ───────────────────────────────────────────────

interface UnifiedInsight {
  issue: string;
  impact: string;
  recommendation: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  entityId?: string;
  entityName?: string;
  entityType?: string;
  confidence: number;
  source: "SOP" | "AI" | "MIXED";
  sop_alignment?: "agrees" | "disagrees" | "extends";
  source_layers?: string[];
}

type PriorityBand = "immediate" | "this_week" | "strategic";

interface EnrichedInsight extends UnifiedInsight {
  recId: string;
  priorityBand: PriorityBand;
  currentAction?: string;
}

// ─── Constants & Helpers ──────────────────────────────────────────

const PRIORITY_CONFIG: Record<PriorityBand, {
  label: string;
  icon: any;
  color: string;
  bg: string;
  borderColor: string;
}> = {
  immediate: {
    label: "Immediate",
    icon: AlertTriangle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  this_week: {
    label: "This Week",
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
  },
  strategic: {
    label: "Strategic",
    icon: Target,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
};

function mapPriorityToBand(priority: string): PriorityBand {
  const p = priority.toUpperCase();
  if (p === "CRITICAL") return "immediate";
  if (p === "HIGH") return "this_week";
  return "strategic";
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Recommendations Page Component ───────────────────────────────

export default function RecommendationsPage() {
  const { activeClient, activePlatform, activePlatformInfo } = useClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [collapsedSections, setCollapsedSections] = useState<Record<PriorityBand, boolean>>({
    immediate: false, this_week: false, strategic: true,
  });

  // 1. Fetch Pipeline Unified Insights
  const { data: pipelineData, isLoading: isLoadingInsights } = useQuery<{ insights: UnifiedInsight[], trace: any, conflicts?: string[], layer_contributions?: Record<string, number> }>({
    queryKey: ["/api/intelligence", activeClient?.id, activePlatform, "insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/intelligence/${activeClient?.id}/${activePlatform}/insights`);
      return res.json();
    },
    enabled: !!activeClient?.id && !!activePlatform,
  });

  // 2. Fetch User Actions (for execution status)
  const { data: actionsData } = useQuery<Record<string, { action: string; timestamp: string }>>({
    queryKey: ["/api/recommendations/actions", activeClient?.id, activePlatform],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/clients/${activeClient?.id}/${activePlatform}/analysis`); // Fallback for now if actions endpoint is missing
      return {}; 
    },
    enabled: !!activeClient?.id && !!activePlatform,
  });

  const enriched: EnrichedInsight[] = useMemo(() => {
    if (!pipelineData?.insights) return [];
    return pipelineData.insights.map((ins, idx) => ({
      ...ins,
      recId: `unified-${idx}`,
      priorityBand: mapPriorityToBand(ins.priority),
      currentAction: undefined,
    }));
  }, [pipelineData]);

  const [showContributions, setShowContributions] = useState(false);

  const sections: Record<PriorityBand, EnrichedInsight[]> = {
    immediate: enriched.filter((r) => r.priorityBand === "immediate"),
    this_week: enriched.filter((r) => r.priorityBand === "this_week"),
    strategic: enriched.filter((r) => r.priorityBand === "strategic"),
  };

  if (isLoadingInsights) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-page-title text-foreground flex items-center gap-2">
            Intelligence Master
            <Badge variant="outline" className="border-blue-500/30 text-blue-400 bg-blue-500/5 gap-1.5 py-1">
              <Brain className="w-3 h-3" /> 4-Layer Pipeline Active
            </Badge>
          </h1>
          <p className="t-label text-muted-foreground mt-0.5">
            {activeClient?.name} · {activePlatformInfo?.label} · {enriched.length} Validated Insights
          </p>
        </div>
        <div className="flex items-center gap-2">
           <Button 
            variant="outline" 
            size="sm"
            onClick={() => setShowContributions(!showContributions)}
            className="border-border/50 text-[10px] font-black uppercase tracking-widest gap-2"
           >
             <Brain className="w-3.5 h-3.5" />
             {showContributions ? "Hide Contributions" : "View Layer Contributions"}
           </Button>
           <Badge variant="outline" className="bg-card py-2 px-4 flex items-center gap-2 border-border/80 shadow-xs">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
             <span className="t-label font-bold">Standardized Output v1.2</span>
           </Badge>
        </div>
      </div>

      {/* Layer Conflicts Callout (Gap 1 Fix) */}
      {pipelineData?.conflicts && pipelineData.conflicts.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-2">
          <div className="flex items-center gap-2 text-amber-500">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-xs font-black uppercase tracking-widest">Architectural Layer Conflicts Detected</span>
          </div>
          <div className="space-y-1">
            {pipelineData.conflicts.map((conflict: string, i: number) => (
              <p key={i} className="text-[11px] text-amber-200/80 italic leading-relaxed pl-6 border-l border-amber-500/20">
                "{conflict}"
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Layer Contributions Panel (Gap 1 Fix) */}
      {showContributions && pipelineData?.layer_contributions && (
        <Card className="border-blue-500/20 bg-blue-500/5 animate-in slide-in-from-top duration-300">
          <CardContent className="p-4 grid grid-cols-4 gap-4">
            {Object.entries(pipelineData.layer_contributions).map(([layer, contribution]) => (
              <div key={layer} className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-400">
                  {layer.replace("_", " ")}
                </p>
                <p className="text-[10px] text-blue-200/60 leading-tight italic">
                  {String(contribution)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}


      {/* Hero Stats */}
      <div className="grid grid-cols-3 gap-4">
        {(["immediate", "this_week", "strategic"] as PriorityBand[]).map((band) => {
          const cfg = PRIORITY_CONFIG[band];
          const Icon = cfg.icon;
          const items = sections[band];
          return (
            <div 
              key={band}
              className={cn("flex flex-col gap-1 px-4 py-3 rounded-xl border transition-all text-left", 
                cfg.borderColor, cfg.bg
              )}
            >
              <div className="flex items-center justify-between">
                <Icon className={cn("w-5 h-5", cfg.color)} />
                <span className="t-kpi tabular-nums">{items.length}</span>
              </div>
              <span className={cn("t-label font-bold", cfg.color)}>{cfg.label}</span>
            </div>
          );
        })}
      </div>

      {/* Main Insights Table */}
      {(["immediate", "this_week", "strategic"] as PriorityBand[]).map((band) => {
        const cfg = PRIORITY_CONFIG[band];
        const Icon = cfg.icon;
        const items = sections[band];
        if (items.length === 0) return null;

        return (
          <div key={band} className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Icon className={cn("w-4 h-4", cfg.color)} />
              <span className={cn("text-xs font-black uppercase tracking-widest", cfg.color)}>
                {cfg.label} Priority · {items.length} Items
              </span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            <Card className="border-border/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="t-table w-full">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/10">
                      <th className="px-4 py-3 text-left t-label font-black uppercase tracking-widest text-muted-foreground/70 w-[200px]">Entity</th>
                      <th className="px-4 py-3 text-left t-label font-black uppercase tracking-widest text-muted-foreground/70">Intelligence Insight</th>
                      <th className="px-4 py-3 text-left t-label font-black uppercase tracking-widest text-muted-foreground/70 w-[240px]">Strategic Impact</th>
                      <th className="px-4 py-3 text-center t-label font-black uppercase tracking-widest text-muted-foreground/70 w-[100px]">Confidence</th>
                      <th className="px-4 py-3 text-right t-label font-black uppercase tracking-widest text-muted-foreground/70 w-[120px]">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((rec) => {
                      const EntityIcon = rec.entityType?.includes("campaign") ? TrendingUp
                        : rec.entityType?.includes("adset") || rec.entityType?.includes("ad_group") ? Target
                        : rec.entityType?.includes("ad") ? Play
                        : rec.entityType?.includes("keyword") ? Search
                        : Shield;

                      return (
                        <tr key={rec.recId} className="border-b border-border/20 hover:bg-muted/5 transition-colors">
                          {/* Entity Info */}
                          <td className="px-4 py-4 align-top">
                            <div className="flex items-center gap-2">
                              <EntityIcon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold text-foreground truncate" title={rec.entityName || "Account-Wide"}>
                                  {rec.entityName || "Account-Wide"}
                                </p>
                                <p className="text-[9px] text-muted-foreground uppercase tracking-widest">
                                  {rec.entityType || "Global"}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Insight & Recommendation */}
                          <td className="px-4 py-4 align-top">
                            <div className="space-y-1.5">
                              <p className={cn(
                                "text-[12px] font-semibold leading-tight",
                                rec.sop_alignment === "disagrees" ? "text-amber-400" : "text-red-400"
                              )}>
                                {rec.issue}
                              </p>
                              <div className={cn(
                                "p-2 rounded border",
                                rec.sop_alignment === "disagrees" ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/40 border-border/30"
                              )}>
                                <p className="text-[11px] text-foreground/90 font-medium leading-relaxed">
                                  <span className="text-emerald-400 font-bold mr-1">REC:</span> {rec.recommendation}
                                </p>
                                {rec.sop_alignment === "disagrees" && (
                                  <div className="mt-2 pt-2 border-t border-amber-500/10 flex items-start gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1 shrink-0" />
                                    <p className="text-[9px] text-amber-200/60 uppercase font-black italic">
                                      Layer Conflict: This AI recommendation overrides established SOP rules based on current L2 data patterns.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>


                          {/* Strategic Impact */}
                          <td className="px-4 py-4 align-top">
                            <p className="text-[11px] text-muted-foreground leading-relaxed italic border-l-2 border-emerald-500/30 pl-3">
                              "{rec.impact}"
                            </p>
                          </td>

                          {/* Confidence Badge */}
                          <td className="px-4 py-4 align-top text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-[10px] font-black tabular-nums">{Math.round(rec.confidence * 100)}%</span>
                              <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                                <div 
                                  className={cn("h-full", rec.confidence > 0.8 ? "bg-emerald-500" : rec.confidence > 0.5 ? "bg-amber-500" : "bg-red-500")}
                                  style={{ width: `${rec.confidence * 100}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Source Tag */}
                          <td className="px-4 py-4 align-top text-right">
                             <div className="flex flex-col items-end gap-1.5">
                               <Badge variant="outline" className={cn(
                                 "text-[9px] font-black uppercase tracking-tighter px-1.5 py-0",
                                 rec.source === "AI" ? "border-blue-500/30 text-blue-400" : "border-emerald-500/30 text-emerald-400"
                               )}>
                                 {rec.source}
                               </Badge>
                               {rec.sop_alignment && (
                                 <Badge variant="outline" className={cn(
                                   "text-[8px] font-bold uppercase px-1 py-0",
                                   rec.sop_alignment === "agrees" ? "border-emerald-500/20 text-emerald-400/60" :
                                   rec.sop_alignment === "disagrees" ? "border-amber-500/40 text-amber-400 bg-amber-500/5" :
                                   "border-blue-500/20 text-blue-400/60"
                                 )}>
                                   SOP: {rec.sop_alignment}
                                 </Badge>
                               )}
                             </div>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      })}

      {enriched.length === 0 && (
        <div className="py-24 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto border border-emerald-500/20">
             <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="space-y-1">
             <h3 className="text-lg font-bold italic tracking-tight">Intelligence Pipeline Clear</h3>
             <p className="text-sm text-muted-foreground max-w-xs mx-auto">All funnels are operating within target benchmarks. No actionable insights at this time.</p>
          </div>
        </div>
      )}
    </div>
  );
}
