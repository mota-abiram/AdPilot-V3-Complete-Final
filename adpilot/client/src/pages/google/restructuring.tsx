import { useState, useMemo } from "react";
import { useClient } from "@/lib/client-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GitBranch,
  GitMerge,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  Layers,
  Zap,
  TrendingUp,
  Info,
  Loader2,
  Check,
  Play,
  FileText,
  Tag,
  Users,
} from "lucide-react";
import { formatINR, truncate } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

interface RestructuringSummary {
  ad_groups_analyzed: number;
  segregate_candidates: number;
  merge_candidates: number;
  no_action: number;
  total_estimated_impact: string;
}

interface RestructuringRecommendation {
  type: "SEGREGATE" | "MERGE";
  reason: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  campaign_id?: string;
  campaign_name?: string;
  ad_group_id?: string;
  ad_group_name?: string;
  ad_group_ids?: string[];
  ad_group_names?: string[];
  detail: string;
  data: Record<string, any>;
  action: string;
  expected_impact: string;
  ice_score: number;
  executable: boolean;
  execution_note: string;
}

interface RestructuringData {
  summary: RestructuringSummary;
  recommendations: RestructuringRecommendation[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function priorityBadge(priority: string) {
  switch (priority) {
    case "HIGH":
      return { label: "High", cls: "bg-red-500/15 text-red-400 border-red-500/30" };
    case "MEDIUM":
      return { label: "Medium", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case "LOW":
      return { label: "Low", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    default:
      return { label: priority, cls: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  }
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    QS_VARIANCE: "Quality Score Variance",
    CPL_VARIANCE: "CPL Variance Across Ads",
    SEARCH_TERM_CLUSTER: "Search Term Cluster",
    LOW_VOLUME_FRAGMENTATION: "Low Volume Fragmentation",
    OVERLAPPING_INTENT: "Overlapping Intent",
    LEARNING_LIMITED_RESCUE: "Learning Limited Rescue",
  };
  return labels[reason] || reason.replace(/_/g, " ");
}

function impactBg(impact: string): string {
  switch (impact) {
    case "HIGH": return "bg-red-500/15 border-red-500/30";
    case "MEDIUM": return "bg-amber-500/15 border-amber-500/30";
    case "LOW": return "bg-blue-500/15 border-blue-500/30";
    default: return "bg-gray-500/15 border-gray-500/30";
  }
}

// ─── Component ───────────────────────────────────────────────────────

export default function GoogleRestructuringPage() {
  const { analysisData: data, isLoadingAnalysis: isLoading, activePlatform, apiBase } = useClient();
  const { toast } = useToast();
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [executedIds, setExecutedIds] = useState<Set<string>>(new Set());
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  const restructuringData = useMemo<RestructuringData | null>(() => {
    if (!data) return null;
    return (data as any).ad_group_restructuring || null;
  }, [data]);

  const campaigns = useMemo(() => {
    if (!restructuringData) return [];
    const names = new Set<string>();
    for (const rec of restructuringData.recommendations) {
      if (rec.campaign_name) names.add(rec.campaign_name);
    }
    return Array.from(names);
  }, [restructuringData]);

  const filteredRecs = useMemo(() => {
    if (!restructuringData) return [];
    if (selectedCampaign === "all") return restructuringData.recommendations;
    return restructuringData.recommendations.filter(
      (r) => r.campaign_name === selectedCampaign
    );
  }, [restructuringData, selectedCampaign]);

  const segregateRecs = filteredRecs.filter((r) => r.type === "SEGREGATE");
  const mergeRecs = filteredRecs.filter((r) => r.type === "MERGE");

  async function handleExecute(rec: RestructuringRecommendation, idx: number) {
    const recId = `${rec.type}-${idx}`;
    if (executingIds.has(recId) || executedIds.has(recId)) return;

    setExecutingIds((prev) => new Set(prev).add(recId));
    try {
      await apiRequest("POST", `${apiBase}/google/execute`, {
        action_type: rec.type === "SEGREGATE" ? "restructure_segregate" : "restructure_merge",
        campaign_id: rec.campaign_id,
        campaign_name: rec.campaign_name,
        ad_group_id: rec.ad_group_id,
        ad_group_ids: rec.ad_group_ids,
        reason: rec.reason,
        detail: rec.detail,
      });
      setExecutedIds((prev) => new Set(prev).add(recId));
      toast({
        title: "Action Executed",
        description: `${rec.type === "SEGREGATE" ? "Segregation" : "Merge"} request sent for ${rec.ad_group_name || rec.campaign_name || "ad group"}`,
      });
    } catch (err: any) {
      toast({
        title: "Execution Failed",
        description: err?.message || "Could not execute action",
        variant: "destructive",
      });
    } finally {
      setExecutingIds((prev) => {
        const next = new Set(prev);
        next.delete(recId);
        return next;
      });
    }
  }

  function handleAcknowledge(rec: RestructuringRecommendation, idx: number) {
    const recId = `${rec.type}-${idx}`;
    setAcknowledgedIds((prev) => new Set(prev).add(recId));
    toast({
      title: "Acknowledged",
      description: `Marked "${reasonLabel(rec.reason)}" as reviewed`,
    });
  }

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-4" data-testid="restructuring-loading">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (activePlatform !== "google") {
    return (
      <div className="p-6" data-testid="restructuring-meta-notice">
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-8 text-center">
            <Layers className="w-10 h-10 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Ad Group Restructuring analysis is available for Google Ads only.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!restructuringData || restructuringData.recommendations.length === 0) {
    return (
      <div className="p-6" data-testid="restructuring-empty">
        <h2 className="text-lg font-semibold text-white mb-4">Ad Group Restructuring</h2>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-8 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-gray-300 font-medium">No restructuring needed</p>
            <p className="text-gray-500 text-sm mt-1">
              All ad groups are well-structured. No segregation or merging opportunities detected.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary } = restructuringData;

  return (
    <div className="p-6 space-y-6" data-testid="restructuring-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Ad Group Restructuring</h2>
          <p className="text-gray-400 text-sm mt-0.5">
            Intelligent analysis of when to split or consolidate ad groups
          </p>
        </div>
        <div className="flex items-center gap-3">
          {campaigns.length > 1 && (
            <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
              <SelectTrigger className="w-[220px] h-8 text-xs bg-[#1a1a2e]/60 border-gray-800" data-testid="select-campaign-filter">
                <SelectValue placeholder="Filter by campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Campaigns</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c} value={c}>{truncate(c, 35)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Badge
            variant="outline"
            className={cn("text-xs px-3 py-1 border", impactBg(summary.total_estimated_impact))}
            data-testid="badge-overall-impact"
          >
            <Zap className="w-3 h-3 mr-1" />
            {summary.total_estimated_impact} Impact
          </Badge>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="restructuring-summary">
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-white">{summary.ad_groups_analyzed}</p>
            <p className="text-xs text-gray-400 mt-1">Ad Groups Analyzed</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-400">{summary.segregate_candidates}</p>
            <p className="text-xs text-gray-400 mt-1">Split Candidates</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{summary.merge_candidates}</p>
            <p className="text-xs text-gray-400 mt-1">Merge Candidates</p>
          </CardContent>
        </Card>
        <Card className="bg-[#1a1a2e]/60 border-gray-800">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{summary.no_action}</p>
            <p className="text-xs text-gray-400 mt-1">No Action Needed</p>
          </CardContent>
        </Card>
      </div>

      {/* Segregation Section */}
      {segregateRecs.length > 0 && (
        <div className="space-y-3" data-testid="segregate-section">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Segregate (Split)</h3>
            <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
              {segregateRecs.length}
            </Badge>
          </div>
          <div className="space-y-3">
            {segregateRecs.map((rec, idx) => (
              <RestructuringCard
                key={`seg-${idx}`}
                rec={rec}
                idx={idx}
                recId={`SEGREGATE-${idx}`}
                isExecuting={executingIds.has(`SEGREGATE-${idx}`)}
                isExecuted={executedIds.has(`SEGREGATE-${idx}`)}
                isAcknowledged={acknowledgedIds.has(`SEGREGATE-${idx}`)}
                onExecute={() => handleExecute(rec, idx)}
                onAcknowledge={() => handleAcknowledge(rec, idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Merge Section */}
      {mergeRecs.length > 0 && (
        <div className="space-y-3" data-testid="merge-section">
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Merge (Consolidate)</h3>
            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
              {mergeRecs.length}
            </Badge>
          </div>
          <div className="space-y-3">
            {mergeRecs.map((rec, idx) => (
              <RestructuringCard
                key={`merge-${idx}`}
                rec={rec}
                idx={idx}
                recId={`MERGE-${idx}`}
                isExecuting={executingIds.has(`MERGE-${idx}`)}
                isExecuted={executedIds.has(`MERGE-${idx}`)}
                isAcknowledged={acknowledgedIds.has(`MERGE-${idx}`)}
                onExecute={() => handleExecute(rec, idx)}
                onAcknowledge={() => handleAcknowledge(rec, idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Intelligence Note */}
      <Card className="bg-[#1a1a2e]/40 border-gray-800/60">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-gray-500 space-y-1">
            <p>Restructuring recommendations are generated using performance marketer intellect beyond standard SOPs.</p>
            <p>Factors considered: Quality Score variance, CPL variance across ads, search term clusters, fragmentation, overlapping intent, and learning limited status.</p>
            <p><strong>Execute</strong> sends the restructuring action to the Google Ads API. <strong>Acknowledge</strong> marks it as reviewed without executing.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Recommendation Card ─────────────────────────────────────────────

function RestructuringCard({
  rec,
  idx,
  recId,
  isExecuting,
  isExecuted,
  isAcknowledged,
  onExecute,
  onAcknowledge,
}: {
  rec: RestructuringRecommendation;
  idx: number;
  recId: string;
  isExecuting: boolean;
  isExecuted: boolean;
  isAcknowledged: boolean;
  onExecute: () => void;
  onAcknowledge: () => void;
}) {
  const isSegregate = rec.type === "SEGREGATE";
  const pb = priorityBadge(rec.priority);
  const Icon = isSegregate ? GitBranch : GitMerge;
  const iconColor = isSegregate ? "text-purple-400" : "text-blue-400";
  const accentBg = isSegregate ? "border-l-purple-500/60" : "border-l-blue-500/60";

  const agName = rec.ad_group_name || (rec.ad_group_names || []).join(" + ");
  const campName = rec.campaign_name || "";

  return (
    <Card
      className={cn("bg-[#1a1a2e]/60 border-gray-800 border-l-2", accentBg)}
      data-testid={`card-restructuring-${rec.type.toLowerCase()}-${idx}`}
    >
      <CardContent className="p-4 space-y-3">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", iconColor)} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-white">{reasonLabel(rec.reason)}</span>
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border", pb.cls)}>
                  {pb.label}
                </Badge>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {campName}
                {campName && agName ? " → " : ""}
                {agName}
              </p>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-1 bg-[#F0BC00]/10 rounded px-2 py-1 flex-shrink-0">
                <Zap className="w-3 h-3 text-[#F0BC00]" />
                <span className="text-xs font-semibold text-[#F0BC00]">{rec.ice_score.toFixed(1)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-gray-900 border-gray-700 text-xs">
              ICE Score (Impact x Confidence x Ease)
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Detail */}
        <p className="text-xs text-gray-300 leading-relaxed">{rec.detail}</p>

        {/* Data badges */}
        <DataBadges rec={rec} />

        {/* Action */}
        <div className="bg-[#111013]/80 rounded-md p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <ArrowRight className="w-3 h-3 text-[#F0BC00]" />
            <span className="text-xs font-medium text-[#F0BC00]">Recommended Action</span>
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">{rec.action}</p>
        </div>

        {/* Impact */}
        <div className="flex items-start gap-1.5">
          <TrendingUp className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-emerald-400/80">{rec.expected_impact}</p>
        </div>

        {/* Execution note */}
        {rec.execution_note && (
          <p className="text-[10px] text-gray-600 italic">{rec.execution_note}</p>
        )}

        {/* Execute / Manual Only / Acknowledge buttons */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            {rec.executable ? (
              <Button
                size="sm"
                className={cn(
                  "text-xs gap-1.5 h-7",
                  isExecuted
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                    : "bg-[#F0BC00]/15 text-[#F0BC00] border-[#F0BC00]/30 hover:bg-[#F0BC00]/25"
                )}
                variant="outline"
                disabled={isExecuting || isExecuted}
                onClick={onExecute}
                data-testid={`button-execute-${recId}`}
              >
                {isExecuting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : isExecuted ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {isExecuted ? "Executed" : isExecuting ? "Executing…" : "Execute"}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1.5 h-7 bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
                    data-testid={`button-manual-${recId}`}
                  >
                    <FileText className="w-3 h-3" />
                    Manual Only
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="bg-gray-900 border-gray-700 text-xs max-w-xs p-3"
                  data-testid={`tooltip-manual-${recId}`}
                >
                  <p className="font-semibold text-white mb-1.5">Step-by-step Manual Instructions</p>
                  {isSegregate ? (
                    <ol className="space-y-1 text-gray-300 list-decimal list-inside">
                      <li>Create a new ad group in the campaign</li>
                      <li>Move keywords{" "}
                        {((rec.data?.keywords_to_split || rec.data?.keyword_groups || []) as string[]).length > 0
                          ? `(${(rec.data?.keywords_to_split || rec.data?.keyword_groups || []).join(", ")})`
                          : "identified above"}{" "}
                        to the new ad group
                      </li>
                      <li>Update ad copy to match the new ad group theme</li>
                      <li>Set initial bid based on historical performance</li>
                    </ol>
                  ) : (
                    <ol className="space-y-1 text-gray-300 list-decimal list-inside">
                      <li>Choose the primary ad group to keep</li>
                      <li>Move all keywords from the secondary ad group into the primary</li>
                      <li>Pause the secondary ad group</li>
                      <li>Monitor performance for 7 days before making further changes</li>
                    </ol>
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            <Button
              size="sm"
              variant="outline"
              className={cn(
                "text-xs gap-1.5 h-7",
                isAcknowledged
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "text-muted-foreground border-border hover:text-foreground"
              )}
              disabled={isAcknowledged}
              onClick={onAcknowledge}
              data-testid={`button-acknowledge-${recId}`}
            >
              {isAcknowledged ? (
                <Check className="w-3 h-3" />
              ) : (
                <CheckCircle className="w-3 h-3" />
              )}
              {isAcknowledged ? "Acknowledged" : "Acknowledge"}
            </Button>
          </div>
          {!rec.executable && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2.5 py-2 space-y-1" data-testid={`manual-steps-${recId}`}>
              <p className="text-[10px] font-semibold text-blue-300">Manual Steps Required</p>
              {isSegregate ? (
                <ol className="text-[10px] text-gray-400 space-y-0.5 list-decimal list-inside">
                  <li>Create a new ad group in the campaign</li>
                  <li>Move keywords{" "}
                    {((rec.data?.keywords_to_split || rec.data?.keyword_groups || []) as string[]).length > 0
                      ? `(${(rec.data?.keywords_to_split || rec.data?.keyword_groups || []).join(", ")})`
                      : "identified above"}{" "}
                    to the new ad group
                  </li>
                  <li>Update ad copy to match the new ad group theme</li>
                  <li>Set initial bid based on historical performance</li>
                </ol>
              ) : (
                <ol className="text-[10px] text-gray-400 space-y-0.5 list-decimal list-inside">
                  <li>Choose the primary ad group to keep</li>
                  <li>Move all keywords from the secondary ad group into the primary</li>
                  <li>Pause the secondary ad group</li>
                  <li>Monitor performance for 7 days before making further changes</li>
                </ol>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Data Badges ─────────────────────────────────────────────────────

function DataBadges({ rec }: { rec: RestructuringRecommendation }) {
  const d = rec.data || {};
  const badges: Array<{ label: string; value: string; color: string }> = [];

  if (rec.reason === "QS_VARIANCE") {
    badges.push({ label: "QS Spread", value: String(d.qs_spread), color: "text-red-400" });
    badges.push({ label: "Min QS", value: String(d.qs_min), color: "text-red-400" });
    badges.push({ label: "Max QS", value: String(d.qs_max), color: "text-emerald-400" });
    badges.push({ label: "Keywords", value: String(d.keyword_count), color: "text-gray-300" });
  } else if (rec.reason === "CPL_VARIANCE") {
    badges.push({ label: "CPL Spread", value: `${d.cpl_spread_pct}%`, color: "text-red-400" });
    badges.push({ label: "Best CPL", value: formatINR(d.cpl_min), color: "text-emerald-400" });
    badges.push({ label: "Worst CPL", value: formatINR(d.cpl_max), color: "text-red-400" });
  } else if (rec.reason === "SEARCH_TERM_CLUSTER") {
    badges.push({ label: "Term CVR", value: `${d.term_cvr}%`, color: "text-emerald-400" });
    badges.push({ label: "AG CVR", value: `${d.ad_group_cvr}%`, color: "text-gray-300" });
    badges.push({ label: "Conversions", value: String(d.conversions), color: "text-blue-400" });
  } else if (rec.reason === "LOW_VOLUME_FRAGMENTATION") {
    badges.push({ label: "Fragmented", value: String(d.fragmented_count), color: "text-amber-400" });
    badges.push({ label: "Total Impr", value: String(d.total_impressions), color: "text-gray-300" });
    badges.push({ label: "Total Conv", value: String(d.total_conversions), color: "text-gray-300" });
  } else if (rec.reason === "OVERLAPPING_INTENT") {
    badges.push({ label: "CPL Diff", value: `${d.cpl_diff_pct}%`, color: "text-amber-400" });
    badges.push({ label: "CTR Diff", value: `${d.ctr_diff_pct}%`, color: "text-amber-400" });
    badges.push({ label: "Combined Conv", value: String(d.combined_conversions), color: "text-blue-400" });
  } else if (rec.reason === "LEARNING_LIMITED_RESCUE") {
    badges.push({ label: "Current Conv", value: String(d.primary_ag?.conversions || 0), color: "text-red-400" });
    badges.push({ label: "Combined", value: String(d.combined_conversions), color: "text-emerald-400" });
    badges.push({ label: "Threshold", value: String(d.learning_threshold), color: "text-gray-300" });
  }

  // GR-02: SEGREGATE extra detail
  const segregateKeywords: string[] = rec.type === "SEGREGATE"
    ? (d.keywords_to_split || d.keyword_groups || [])
    : [];
  const showSegregateDetail = rec.type === "SEGREGATE";

  // Expected QS improvement for SEGREGATE
  let qsImprovementText: string | null = null;
  if (showSegregateDetail) {
    if (d.expected_qs_improvement != null) {
      qsImprovementText = `+${d.expected_qs_improvement} QS points`;
    } else if (rec.reason === "QS_VARIANCE" && d.qs_spread != null) {
      qsImprovementText = `+${Math.round(d.qs_spread / 2)} QS points estimated`;
    }
  }

  // Expected CTR impact for SEGREGATE
  let ctrImpactText: string | null = null;
  if (showSegregateDetail) {
    if (d.expected_ctr_impact != null) {
      ctrImpactText = String(d.expected_ctr_impact);
    } else {
      ctrImpactText = "~15-30% CTR improvement expected";
    }
  }

  // GR-03: MERGE extra detail
  const showMergeDetail = rec.type === "MERGE";
  const mergeAdGroupNames: string[] = showMergeDetail ? (rec.ad_group_names || []) : [];
  const individualVolumes: Record<string, number> = showMergeDetail ? (d.individual_volumes || {}) : {};
  const combinedConversions = d.combined_conversions;
  const learningThreshold = d.learning_threshold;
  const primaryConversions = d.primary_ag?.conversions;

  let learningSpeedText: string | null = null;
  if (showMergeDetail && combinedConversions != null && learningThreshold != null && learningThreshold > 0) {
    const multiplier = (combinedConversions / learningThreshold).toFixed(1);
    learningSpeedText = `Combined volume will accelerate learning by ~${multiplier}x`;
  }

  const hasBadges = badges.length > 0;
  const hasExtraDetail = showSegregateDetail || showMergeDetail;

  if (!hasBadges && !hasExtraDetail) return null;

  return (
    <div className="space-y-2" data-testid="data-badges">
      {hasBadges && (
        <div className="flex flex-wrap gap-2">
          {badges.map((b, i) => (
            <div key={i} className="bg-[#111013]/60 rounded px-2 py-1 text-center">
              <p className={cn("text-xs font-semibold", b.color)}>{b.value}</p>
              <p className="text-[10px] text-gray-500">{b.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* GR-02: SEGREGATE extra detail */}
      {showSegregateDetail && (
        <div className="space-y-2 pt-1" data-testid="segregate-detail">
          {segregateKeywords.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Keywords to Separate</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {segregateKeywords.map((kw: string, i: number) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 bg-purple-500/10 text-purple-300 border-purple-500/30"
                  >
                    {kw}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {qsImprovementText && (
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              <span className="text-[10px] text-emerald-400">
                <span className="font-medium">Expected QS Improvement:</span> {qsImprovementText}
              </span>
            </div>
          )}
          {ctrImpactText && (
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-blue-400 flex-shrink-0" />
              <span className="text-[10px] text-blue-400">
                <span className="font-medium">Expected CTR Impact:</span> {ctrImpactText}
              </span>
            </div>
          )}
        </div>
      )}

      {/* GR-03: MERGE extra detail */}
      {showMergeDetail && (
        <div className="space-y-2 pt-1" data-testid="merge-detail">
          {mergeAdGroupNames.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <Users className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Ad Groups to Combine</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {mergeAdGroupNames.map((name: string, i: number) => {
                  const vol = individualVolumes[name] ?? undefined;
                  return (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-300 border-blue-500/30"
                    >
                      {name}
                      {vol != null ? ` (${vol.toLocaleString()} impr)` : ""}
                    </Badge>
                  );
                })}
              </div>
              {d.total_impressions != null && Object.keys(individualVolumes).length === 0 && (
                <p className="text-[10px] text-gray-500">
                  Combined impressions: {Number(d.total_impressions).toLocaleString()}
                </p>
              )}
            </div>
          )}
          {learningSpeedText && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-400 flex-shrink-0" />
              <span className="text-[10px] text-amber-400">
                <span className="font-medium">Expected Learning Speed:</span> {learningSpeedText}
              </span>
            </div>
          )}
          {rec.reason === "LEARNING_LIMITED_RESCUE" && combinedConversions != null && primaryConversions != null && learningThreshold != null && (
            <div className="bg-amber-500/10 border border-amber-500/25 rounded px-2.5 py-2" data-testid="learning-limited-note">
              <p className="text-[10px] text-amber-300 leading-relaxed">
                <span className="font-semibold">Learning Limited:</span> Merging will bring conversions from{" "}
                <span className="font-semibold">{primaryConversions}</span> to{" "}
                <span className="font-semibold text-emerald-400">{combinedConversions}</span>, clearing the learning
                limited threshold of <span className="font-semibold">{learningThreshold}</span>.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
