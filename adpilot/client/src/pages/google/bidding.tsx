import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useClient } from "@/lib/client-context";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Zap,
  Info,
  ShieldCheck,
  Clock,
  Target,
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  PenLine,
  ArrowUpRight,
  BarChart3,
  MousePointerClick,
  Activity,
  SlidersHorizontal,
  Eye,
  Ban,
  History,
  AlertCircle,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { formatINR, formatPct, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BiddingAlert {
  severity: "critical" | "warning" | "info";
  message: string;
}

interface CampaignRecommendation {
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  status: string;
  current_strategy: string;
  avg_cpc: number;
  cvr: number;
  ctr: number;
  conversions_30d: number;
  conversions_14d: number;
  cost_per_conversion: number;
  search_impression_share: number | null;
  lost_is_rank: number | null;
  lost_is_budget: number | null;
  clicks: number;
  recommendation: "stay_max_clicks" | "switch_tcpa" | "hold";
  confidence: "high" | "medium" | "low";
  reasons: string[];
  alerts: BiddingAlert[];
  computed_bid_limit: number;
  bid_limit_by_top_of_page: number;
  bid_limit_by_cpa: number;
  suggested_tcpa: number;
  target_cpa: number;
  cvr_variance_14d: number | null;
  tracking_stable: boolean;
  low_top_of_page_cpc: number;
}

interface BiddingMeta {
  generated_at: string;
  data_available: boolean;
  total_campaigns: number;
  alert_count: number;
  on_correct_strategy: number;
  target_cpa: number;
}

interface BiddingHistoryEntry {
  id: number;
  timestamp: string;
  campaign_id: string;
  campaign_name: string;
  action: "apply" | "reject" | "manual_apply";
  recommendation: string;
  rationale: string;
  params: Record<string, any>;
}

interface BiddingData {
  campaigns: CampaignRecommendation[];
  meta: BiddingMeta;
  history: BiddingHistoryEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRecommendationConfig(rec: string) {
  switch (rec) {
    case "switch_tcpa":
      return {
        label: "Switch to tCPA",
        shortLabel: "→ tCPA",
        color: "text-emerald-400",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/30",
        icon: <Zap className="w-3.5 h-3.5" />,
      };
    case "hold":
      return {
        label: "Hold — Do Not Switch",
        shortLabel: "Hold",
        color: "text-amber-400",
        bg: "bg-amber-500/10",
        border: "border-amber-500/30",
        icon: <Ban className="w-3.5 h-3.5" />,
      };
    default: // stay_max_clicks
      return {
        label: "Stay: Max Clicks",
        shortLabel: "Max Clicks",
        color: "text-blue-400",
        bg: "bg-blue-500/10",
        border: "border-blue-500/30",
        icon: <MousePointerClick className="w-3.5 h-3.5" />,
      };
  }
}

function getConfidenceConfig(conf: string) {
  switch (conf) {
    case "high":
      return { label: "High", cls: "bg-emerald-500/15 text-emerald-400", dot: "bg-emerald-500" };
    case "medium":
      return { label: "Medium", cls: "bg-amber-500/15 text-amber-400", dot: "bg-amber-500" };
    default:
      return { label: "Low", cls: "bg-red-500/15 text-red-400", dot: "bg-red-500" };
  }
}

function getAlertConfig(severity: string) {
  switch (severity) {
    case "critical":
      return { icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" />, cls: "text-red-400 bg-red-500/5 border-red-500/20" };
    case "warning":
      return { icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0" />, cls: "text-amber-400 bg-amber-500/5 border-amber-500/20" };
    default:
      return { icon: <Info className="w-3.5 h-3.5 shrink-0" />, cls: "text-blue-400 bg-blue-500/5 border-blue-500/20" };
  }
}

function formatStrategy(s: string) {
  if (!s) return "Manual CPC";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Maximize Clicks", "Max Clicks")
    .replace("Target Cpa", "tCPA");
}

// ─── Action Dialog ─────────────────────────────────────────────────────────────

interface ActionDialogState {
  open: boolean;
  type: "apply" | "reject" | "manual_apply";
  campaign: CampaignRecommendation;
}

function ActionDialog({
  state,
  onClose,
  onSubmit,
  isPending,
}: {
  state: ActionDialogState;
  onClose: () => void;
  onSubmit: (rationale: string) => void;
  isPending: boolean;
}) {
  const [rationale, setRationale] = useState("");
  const rec = getRecommendationConfig(state.campaign.recommendation);

  const actionLabels = {
    apply: { title: "Auto Apply Recommendation", btn: "Apply Change", btnCls: "bg-emerald-600 hover:bg-emerald-700" },
    manual_apply: { title: "Manual Apply", btn: "Confirm Manual Apply", btnCls: "bg-blue-600 hover:bg-blue-700" },
    reject: { title: "Reject Recommendation", btn: "Reject", btnCls: "bg-red-600 hover:bg-red-700" },
  };
  const labels = actionLabels[state.type];

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {state.type === "reject" ? (
              <XCircle className="w-5 h-5 text-red-400" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            )}
            {labels.title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 mt-1">
              <div className={cn("p-3 rounded-lg border text-xs", rec.bg, rec.border)}>
                <p className="font-bold text-foreground mb-1 text-sm">{truncate(state.campaign.campaign_name, 40)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-muted-foreground">Current:</span>
                  <span className="font-medium">{formatStrategy(state.campaign.current_strategy)}</span>
                  {state.campaign.recommendation === "switch_tcpa" && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={cn("font-bold", rec.color)}>tCPA @ {formatINR(state.campaign.suggested_tcpa, 0)}</span>
                    </>
                  )}
                  {state.campaign.recommendation === "stay_max_clicks" && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={cn("font-bold", rec.color)}>Bid cap {formatINR(state.campaign.computed_bid_limit, 0)}</span>
                    </>
                  )}
                </div>
              </div>
              {state.type !== "reject" && (
                <div className="space-y-1 text-[11px] text-muted-foreground">
                  {state.campaign.reasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">·</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <PenLine className="w-3.5 h-3.5 text-primary" />
            <label className="text-xs font-semibold text-foreground">
              Strategic Rationale <span className="text-red-400">*</span>
            </label>
          </div>
          <Textarea
            placeholder="Enter your strategic reasoning for this decision (required)..."
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            className="min-h-[90px] text-sm resize-none"
            data-testid="input-rationale"
          />
          <p className="text-[10px] text-muted-foreground">
            All bidding decisions are logged with rationale for audit and learning purposes.
            {rationale.length < 10 && rationale.length > 0 && (
              <span className="text-red-400 ml-1">Min 10 characters required ({10 - rationale.length} more)</span>
            )}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            className={cn("gap-2", labels.btnCls)}
            onClick={() => onSubmit(rationale)}
            disabled={isPending || rationale.trim().length < 10}
            data-testid="button-confirm-action"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {labels.btn}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Campaign Row ─────────────────────────────────────────────────────────────

function CampaignRecommendationRow({
  camp,
  onAction,
}: {
  camp: CampaignRecommendation;
  onAction: (type: "apply" | "reject" | "manual_apply") => void;
}) {
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const rec = getRecommendationConfig(camp.recommendation);
  const conf = getConfidenceConfig(camp.confidence);
  const criticalAlerts = camp.alerts.filter((a) => a.severity === "critical");
  const warningAlerts = camp.alerts.filter((a) => a.severity === "warning");

  return (
    <div className={cn(
      "rounded-xl border transition-all duration-200",
      criticalAlerts.length > 0
        ? "border-red-500/30 bg-red-500/3"
        : warningAlerts.length > 0
        ? "border-amber-500/30 bg-amber-500/3"
        : "border-border/50 bg-card/60"
    )}>
      {/* Main Row */}
      <div className="p-4 grid grid-cols-[1fr_auto] gap-4 items-start">
        <div className="min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-sm font-semibold text-foreground">
                {truncate(camp.campaign_name, 45)}
              </span>
            </button>
            {camp.campaign_type && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                {camp.campaign_type}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-muted-foreground">
              {formatStrategy(camp.current_strategy)}
            </Badge>
            {criticalAlerts.length > 0 && (
              <Badge className="text-[9px] px-1.5 py-0 bg-red-500/15 text-red-400 border-red-500/30">
                {criticalAlerts.length} critical
              </Badge>
            )}
          </div>

          {/* Metric chips */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-help">
                  <Activity className="w-3 h-3" />
                  <span>CPC</span>
                  <span className={cn(
                    "font-bold tabular-nums",
                    camp.avg_cpc > camp.computed_bid_limit * 1.1 ? "text-red-400" : "text-foreground"
                  )}>
                    {formatINR(camp.avg_cpc, 0)}
                  </span>
                  {camp.computed_bid_limit > 0 && (
                    <span className="text-muted-foreground">/ cap {formatINR(camp.computed_bid_limit, 0)}</span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p className="font-medium mb-1">Bid Limit (SOP Formula)</p>
                <p>MIN(Low Top-of-Page CPC × 1.35, Target CPA × CVR)</p>
                <p className="text-muted-foreground mt-1">
                  = MIN({formatINR(camp.bid_limit_by_top_of_page, 0)}, {formatINR(camp.bid_limit_by_cpa, 0)})
                </p>
                <p className="font-bold text-primary mt-1">= {formatINR(camp.computed_bid_limit, 0)}</p>
              </TooltipContent>
            </Tooltip>

            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              <span>CVR</span>
              <span className={cn(
                "font-bold tabular-nums",
                camp.cvr < 1 ? "text-red-400" : camp.cvr >= 4 ? "text-emerald-400" : "text-foreground"
              )}>
                {camp.cvr.toFixed(1)}%
              </span>
              {camp.cvr_variance_14d != null && (
                <span className={cn(
                  "text-[10px]",
                  camp.cvr_variance_14d < 20 ? "text-emerald-400" : "text-amber-400"
                )}>
                  ±{camp.cvr_variance_14d.toFixed(0)}%
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <BarChart3 className="w-3 h-3" />
              <span>Conv/30d</span>
              <span className={cn(
                "font-bold tabular-nums",
                camp.conversions_30d >= 50 ? "text-emerald-400" :
                camp.conversions_30d >= 30 ? "text-amber-400" : "text-red-400"
              )}>
                {camp.conversions_30d}
              </span>
              <span className="text-[10px]">(need ≥30)</span>
            </div>

            {camp.search_impression_share != null && (
              <div className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                <span>IS</span>
                <span className={cn(
                  "font-bold tabular-nums",
                  camp.search_impression_share >= 60 ? "text-emerald-400" :
                  camp.search_impression_share >= 40 ? "text-amber-400" : "text-red-400"
                )}>
                  {camp.search_impression_share.toFixed(0)}%
                </span>
              </div>
            )}

            {camp.lost_is_rank != null && camp.lost_is_rank > 0 && (
              <div className="flex items-center gap-1 text-red-400">
                <ArrowUpRight className="w-3 h-3" />
                <span>Lost(Rank) {camp.lost_is_rank.toFixed(0)}%</span>
              </div>
            )}

            {camp.lost_is_budget != null && camp.lost_is_budget > 0 && (
              <div className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                <span>Lost(Budget) {camp.lost_is_budget.toFixed(0)}%</span>
              </div>
            )}

            {camp.cost_per_conversion > 0 && (
              <div className="flex items-center gap-1">
                <Target className="w-3 h-3" />
                <span>Cost/Conv</span>
                <span className={cn(
                  "font-bold tabular-nums",
                  camp.cost_per_conversion <= camp.target_cpa ? "text-emerald-400" :
                  camp.cost_per_conversion <= camp.target_cpa * 1.2 ? "text-amber-400" : "text-red-400"
                )}>
                  {formatINR(camp.cost_per_conversion, 0)}
                </span>
              </div>
            )}
          </div>

          {/* Alerts */}
          {camp.alerts.length > 0 && (
            <div className="flex flex-col gap-1.5 mb-3">
              {camp.alerts.map((alert, i) => {
                const ac = getAlertConfig(alert.severity);
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer hover:opacity-80 transition-opacity",
                      ac.cls
                    )}
                    onClick={() => navigate(`/campaigns?campaign_id=${camp.campaign_id}`)}
                    title="Click to view campaign"
                  >
                    {ac.icon}
                    <span>{alert.message}</span>
                    <ExternalLink className="w-3 h-3 ml-auto shrink-0 opacity-50" />
                  </div>
                );
              })}
            </div>
          )}

          {/* Recommendation pill + reasons */}
          <div className={cn("flex items-start gap-2 p-2.5 rounded-lg border text-xs", rec.bg, rec.border)}>
            <div className={cn("flex items-center gap-1.5 font-bold shrink-0 mt-0.5", rec.color)}>
              {rec.icon}
              <span>{rec.label}</span>
            </div>
            <div className="text-muted-foreground space-y-0.5">
              {camp.reasons.map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel: confidence + actions */}
        <div className="flex flex-col items-end gap-3 shrink-0">
          {/* Confidence badge */}
          <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold", conf.cls)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", conf.dot)} />
            {conf.label} Confidence
          </div>

          {/* tCPA target if applicable */}
          {camp.recommendation === "switch_tcpa" && camp.suggested_tcpa > 0 && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Suggested tCPA</p>
              <p className="text-lg font-black text-emerald-400 tabular-nums">{formatINR(camp.suggested_tcpa, 0)}</p>
              <p className="text-[9px] text-muted-foreground">Current CPA × 0.8</p>
            </div>
          )}

          {/* Bid limit if staying on Max Clicks */}
          {camp.recommendation === "stay_max_clicks" && camp.computed_bid_limit > 0 && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Bid Cap</p>
              <p className="text-lg font-black text-blue-400 tabular-nums">{formatINR(camp.computed_bid_limit, 0)}</p>
              <p className="text-[9px] text-muted-foreground">SOP Formula</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-1.5 w-full">
            {camp.recommendation !== "hold" && (
              <Button
                size="sm"
                className="gap-1.5 text-[11px] h-8 px-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() => onAction("apply")}
                data-testid={`button-apply-${camp.campaign_id}`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Auto Apply
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-[11px] h-8 px-3 w-full border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              onClick={() => onAction("manual_apply")}
              data-testid={`button-manual-${camp.campaign_id}`}
            >
              <PenLine className="w-3.5 h-3.5" />
              Manual Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-[11px] h-8 px-3 w-full text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              onClick={() => onAction("reject")}
              data-testid={`button-reject-${camp.campaign_id}`}
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </Button>
          </div>

          {/* Navigate to campaign */}
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-[10px] h-6 text-muted-foreground hover:text-primary w-full"
            onClick={() => navigate(`/campaigns?campaign_id=${camp.campaign_id}`)}
          >
            <ExternalLink className="w-3 h-3" />
            View Campaign
          </Button>
        </div>
      </div>

      {/* Expanded: Bid formula breakdown */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/30 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Bid Limit Formula Breakdown
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: "Low Top-of-Page CPC",
                value: formatINR(camp.low_top_of_page_cpc, 0),
                sub: "Google benchmark",
                color: "text-foreground",
              },
              {
                label: "× 1.35 multiplier",
                value: formatINR(camp.bid_limit_by_top_of_page, 0),
                sub: "Route A ceiling",
                color: "text-blue-400",
              },
              {
                label: "Target CPA × CVR",
                value: formatINR(camp.bid_limit_by_cpa, 0),
                sub: `₹${camp.target_cpa} × ${camp.cvr.toFixed(2)}%`,
                color: "text-purple-400",
              },
              {
                label: "Computed Bid Limit",
                value: formatINR(camp.computed_bid_limit, 0),
                sub: "MIN(Route A, Route B)",
                color: camp.avg_cpc > camp.computed_bid_limit ? "text-red-400" : "text-emerald-400",
              },
            ].map((item) => (
              <div key={item.label} className="p-2.5 rounded-lg bg-muted/20 border border-border/30">
                <p className="text-[10px] text-muted-foreground mb-1">{item.label}</p>
                <p className={cn("text-base font-extrabold tabular-nums", item.color)}>{item.value}</p>
                <p className="text-[9px] text-muted-foreground">{item.sub}</p>
              </div>
            ))}
          </div>

          {camp.recommendation === "switch_tcpa" && (
            <div className="mt-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <p className="text-xs font-bold text-emerald-400 mb-1">tCPA Seed Calculation</p>
              <p className="text-[11px] text-muted-foreground">
                Recommended tCPA = Current CPA × 0.8 = {formatINR(camp.cost_per_conversion, 0)} × 0.8 = {" "}
                <span className="font-bold text-emerald-400">{formatINR(camp.suggested_tcpa, 0)}</span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Seeds tCPA conservatively below current CPA to allow Google's algorithm to optimize without overspending.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GoogleBiddingPage() {
  const { activeClientId, apiBase, activePlatform } = useClient();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [activeLevel, setActiveLevel] = useState<"campaign" | "ad_group">("campaign");
  const [filterRec, setFilterRec] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"alerts" | "confidence" | "conversions">("alerts");
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch recommendations
  const { data, isLoading, error, refetch } = useQuery<BiddingData>({
    queryKey: ["/api/clients", activeClientId, "google/bidding-recommendations"],
    queryFn: async () => {
      const res = await apiRequest("GET", `${apiBase}/api/clients/${activeClientId}/google/bidding-recommendations`);
      return res.json();
    },
    enabled: !!activeClientId,
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // Action mutation
  const actionMutation = useMutation({
    mutationFn: async (payload: {
      campaign_id: string;
      campaign_name: string;
      action: string;
      recommendation: string;
      rationale: string;
      params: Record<string, any>;
    }) => {
      const res = await apiRequest(
        "POST",
        `${apiBase}/api/clients/${activeClientId}/google/bidding-recommendations/action`,
        payload
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({
        title: vars.action === "reject" ? "Recommendation Rejected" : "Action Recorded",
        description: `Logged with rationale. ${vars.action !== "reject" ? "Apply changes in Google Ads." : ""}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/clients", activeClientId, "google/bidding-recommendations"] });
      setActionDialog(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleAction(campaign: CampaignRecommendation, type: "apply" | "reject" | "manual_apply") {
    setActionDialog({ open: true, type, campaign });
  }

  function handleSubmitAction(rationale: string) {
    if (!actionDialog) return;
    const { campaign, type } = actionDialog;
    actionMutation.mutate({
      campaign_id: campaign.campaign_id,
      campaign_name: campaign.campaign_name,
      action: type,
      recommendation: campaign.recommendation,
      rationale,
      params:
        campaign.recommendation === "switch_tcpa"
          ? { strategy: "TARGET_CPA", target_cpa: campaign.suggested_tcpa }
          : { bid_limit: campaign.computed_bid_limit },
    });
  }

  // Filtered + sorted entities
  const processedEntities = useMemo(() => {
    if (!data?.campaigns) return [];
    let entities = activeLevel === "campaign" ? data.campaigns : (data as any).ad_groups || [];

    if (filterRec !== "all") {
      entities = entities.filter((c: any) => c.recommendation === filterRec);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      entities = entities.filter((c: any) => (c.campaign_name || c.name || "").toLowerCase().includes(q));
    }

    return [...entities].sort((a: any, b: any) => {
      if (sortBy === "alerts") {
        const aScore = (a.alerts || []).filter((x: any) => x.severity === "critical").length * 10 +
                       (a.alerts || []).filter((x: any) => x.severity === "warning").length;
        const bScore = (b.alerts || []).filter((x: any) => x.severity === "critical").length * 10 +
                       (b.alerts || []).filter((x: any) => x.severity === "warning").length;
        return bScore - aScore;
      }
      if (sortBy === "confidence") {
        const order: any = { high: 3, medium: 2, low: 1 };
        return (order[b.confidence] || 0) - (order[a.confidence] || 0);
      }
      return (b.conversions_30d || 0) - (a.conversions_30d || 0);
    });
  }, [data, activeLevel, filterRec, sortBy, searchQuery]);

  // Loading
  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px]">
        <Skeleton className="h-10 w-72 mb-6" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  if (error || !data?.meta?.data_available) {
    return (
      <div className="p-6 space-y-4 max-w-[1400px]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">Bidding Intelligence</h1>
            <p className="text-xs text-muted-foreground">Max Clicks ↔ tCPA decision engine</p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <AlertTriangle className="w-12 h-12 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium text-foreground">No Bidding Data Available</p>
              <p className="text-xs text-muted-foreground mt-1">
                Run the Google Ads agent to generate bidding analysis.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const meta = data.meta;
  const tcpaSwitchCandidates = data.campaigns.filter((c) => c.recommendation === "switch_tcpa").length;
  const holdCandidates = data.campaigns.filter((c) => c.recommendation === "hold").length;
  const criticalAlertCount = data.campaigns.reduce(
    (sum, c) => sum + c.alerts.filter((a) => a.severity === "critical").length, 0
  );

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      {/* Action Dialog */}
      {actionDialog && (
        <ActionDialog
          state={actionDialog}
          onClose={() => setActionDialog(null)}
          onSubmit={handleSubmitAction}
          isPending={actionMutation.isPending}
        />
      )}

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 shadow-sm">
            <Brain className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">
              Bidding Intelligence
            </h1>
            <p className="text-xs text-muted-foreground">
              SOP-aligned decision engine · Max Clicks ↔ tCPA · Target CPA: {formatINR(meta.target_cpa, 0)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted/30 p-1 rounded-lg border border-border/50 mr-2">
            <button
              onClick={() => setActiveLevel("campaign")}
              className={cn(
                "px-3 py-1 text-[11px] font-bold rounded-md transition-all",
                activeLevel === "campaign" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Campaigns
            </button>
            <button
              onClick={() => setActiveLevel("ad_group")}
              className={cn(
                "px-3 py-1 text-[11px] font-bold rounded-md transition-all",
                activeLevel === "ad_group" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Ad Groups
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs border-primary/20 hover:bg-primary/5"
            onClick={() => setShowRules(true)}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Rule Engine
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="w-3.5 h-3.5" />
            Action History
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ─── Overview Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Total Campaigns</p>
            <p className="text-3xl font-black tabular-nums text-foreground">{meta.total_campaigns}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Under bidding analysis</p>
          </CardContent>
        </Card>

        <Card className={cn("border-border/50", criticalAlertCount > 0 && "border-red-500/40")}>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Active Alerts</p>
            <p className={cn("text-3xl font-black tabular-nums", criticalAlertCount > 0 ? "text-red-400" : "text-emerald-400")}>
              {meta.alert_count}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {criticalAlertCount > 0 ? `${criticalAlertCount} critical` : "No critical alerts"}
            </p>
          </CardContent>
        </Card>

        <Card className={cn("border-border/50", tcpaSwitchCandidates > 0 && "border-emerald-500/40")}>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">tCPA Candidates</p>
            <p className={cn("text-3xl font-black tabular-nums", tcpaSwitchCandidates > 0 ? "text-emerald-400" : "text-foreground")}>
              {tcpaSwitchCandidates}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">Ready to switch strategy</p>
          </CardContent>
        </Card>

        <Card className={cn("border-border/50", holdCandidates > 0 && "border-amber-500/40")}>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Hold / Monitor</p>
            <p className={cn("text-3xl font-black tabular-nums", holdCandidates > 0 ? "text-amber-400" : "text-foreground")}>
              {holdCandidates}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">Budget / tracking issues</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── SOP Formula Strip ───────────────────────────────────────── */}
      <Card className="border-primary/20 bg-primary/3">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">SOP Bid Limit Formula</p>
              <p className="text-sm font-mono">
                Bid Limit = MIN(
                <span className="text-blue-400 font-bold">Low Top-of-Page CPC × 1.3–1.4</span>,{" "}
                <span className="text-purple-400 font-bold">Target CPA × CVR</span>
                )
              </p>
            </div>
            <div className="h-10 w-px bg-border/50 hidden md:block" />
            <div className="flex gap-5 text-xs">
              <div className="flex items-center gap-1.5">
                <MousePointerClick className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-muted-foreground">Default:</span>
                <span className="font-bold">Max Clicks with Bid Cap</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-muted-foreground">Upgrade:</span>
                <span className="font-bold">tCPA after ≥30 stable conversions</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Ban className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-muted-foreground">Guard:</span>
                <span className="font-bold">Never switch if budget-limited</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Action History Panel ─────────────────────────────────────── */}
      {showHistory && data.history.length > 0 && (
        <Card>
          <CardHeader className="pb-2 border-b border-border/40">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Bidding Action History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 bg-muted/20">
                    {["Time", "Campaign", "Action", "Strategy", "Rationale"].map((h) => (
                      <th key={h} className="p-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...data.history].reverse().map((entry) => (
                    <tr key={entry.id} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="p-3 tabular-nums text-muted-foreground whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="p-3 max-w-[160px]">
                        <span className="truncate block">{truncate(entry.campaign_name, 25)}</span>
                      </td>
                      <td className="p-3">
                        <Badge
                          className={cn("text-[9px] px-1.5",
                            entry.action === "apply" ? "bg-emerald-500/15 text-emerald-400" :
                            entry.action === "reject" ? "bg-red-500/15 text-red-400" :
                            "bg-blue-500/15 text-blue-400"
                          )}
                        >
                          {entry.action.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">{getRecommendationConfig(entry.recommendation).label}</td>
                      <td className="p-3 text-muted-foreground max-w-[250px]">
                        <span className="truncate block" title={entry.rationale}>{truncate(entry.rationale, 60)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Filters ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg border border-border/50">
          {[
            { key: "all", label: "All Campaigns" },
            { key: "switch_tcpa", label: `→ tCPA (${tcpaSwitchCandidates})` },
            { key: "stay_max_clicks", label: "Max Clicks" },
            { key: "hold", label: `Hold (${holdCandidates})` },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilterRec(f.key)}
              className={cn(
                "px-3 py-1.5 text-[11px] font-bold rounded-md transition-all",
                filterRec === f.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 p-1 bg-muted/30 rounded-lg border border-border/50 ml-auto">
          <span className="text-[10px] text-muted-foreground px-2">Sort:</span>
          {[
            { key: "alerts" as const, label: "Alerts" },
            { key: "confidence" as const, label: "Confidence" },
            { key: "conversions" as const, label: "Conversions" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              className={cn(
                "px-2.5 py-1 text-[11px] font-bold rounded-md transition-all",
                sortBy === s.key
                  ? "bg-background text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <Input
          placeholder="Search campaigns..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-48 h-9 text-xs border-border/50"
        />
      </div>

      {/* ─── Recommendation Cards ───────────────────────────── */}
      <div className="space-y-3">
        {processedEntities.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400/40 mb-3" />
              <p className="text-sm font-medium text-foreground">All Clear</p>
              <p className="text-xs text-muted-foreground mt-1">
                No {activeLevel === "campaign" ? "campaign" : "ad group"} recommendations found.
              </p>
            </CardContent>
          </Card>
        ) : (
          processedEntities.map((entity: any) => (
            <CampaignRecommendationRow
              key={(entity.campaign_id || "") + (entity.id || "")}
              camp={entity}
              onAction={(type) => handleAction(entity, type)}
            />
          ))
        )}
      </div>

      {/* ─── Footer info ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border/30">
        <span>
          Last computed: {new Date(meta.generated_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-primary" />
          SOP-enforced · Max Clicks → tCPA · AI Decision Engine
        </span>
      </div>
      
      <RuleEngine 
        open={showRules} 
        onClose={() => setShowRules(false)}
        platform={activePlatform}
        clientId={activeClientId || ""}
        targets={meta}
      />
    </div>
  );
}

function RuleEngine({ open, onClose, platform, clientId, targets }: any) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader className="pb-6 border-b">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-primary" />
            <SheetTitle>Bidding Rule Engine</SheetTitle>
          </div>
          <SheetDescription>
            Configure automated bidding SOPs and safety guardrails for {platform === "google" ? "Google Ads" : "Meta"}.
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-8">
          {/* Rule 1: Auto-Pause */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">1. Auto-Pause Logic</h3>
              <Badge variant="secondary" className="text-emerald-400 bg-emerald-500/10">Active</Badge>
            </div>
            <div className="grid gap-4 p-4 border rounded-lg bg-muted/20">
              <div className="flex items-center justify-between gap-10">
                <span className="text-xs text-muted-foreground">Pause Ad Groups if CPL &gt;</span>
                <div className="flex items-center gap-2">
                   <span className="text-xs font-bold text-foreground">2.0x</span>
                   <span className="text-[10px] text-muted-foreground">Target</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-10">
                <span className="text-xs text-muted-foreground">Min Impressions before pause</span>
                <span className="text-xs font-bold text-foreground">1,500</span>
              </div>
            </div>
          </div>

          {/* Rule 2: Bid Limits */}
          <div className="space-y-4">
             <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">2. Bid Limit Calculation</h3>
              <Badge variant="secondary" className="text-emerald-400 bg-emerald-500/10">Active</Badge>
            </div>
            <div className="grid gap-4 p-4 border rounded-lg bg-muted/20">
              <div className="flex items-center justify-between gap-10">
                <span className="text-xs text-muted-foreground">Default Bid Cap Multiplier</span>
                <span className="text-xs font-bold text-foreground">1.35x (Avg CPC)</span>
              </div>
              <div className="flex items-center justify-between gap-10">
                <span className="text-xs text-muted-foreground">Dynamic CVR Safety Cap</span>
                <span className="text-xs font-bold text-foreground">Target CPL × CVR</span>
              </div>
            </div>
          </div>

           {/* Rule 3: tCPA Migration */}
           <div className="space-y-4">
             <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">3. tCPA Migration</h3>
              <Badge variant="secondary" className="text-amber-400 bg-amber-500/10">Manual Approval</Badge>
            </div>
            <div className="grid gap-4 p-4 border rounded-lg bg-muted/20">
              <div className="flex items-center justify-between gap-10">
                <span className="text-xs text-muted-foreground">Min conversions (7-day) for switch</span>
                <span className="text-xs font-bold text-foreground">15+</span>
              </div>
              <div className="flex items-center justify-between gap-10">
                <span className="text-xs text-muted-foreground">Max Impression Share Loss allowed</span>
                <span className="text-xs font-bold text-foreground">20% (Budget Limited)</span>
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="mt-8 pt-6 border-t">
          <Button variant="outline" className="text-xs" onClick={onClose}>Close</Button>
          <Button className="text-xs bg-primary text-primary-foreground">Save Configuration</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
