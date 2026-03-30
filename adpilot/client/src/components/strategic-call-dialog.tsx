import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/format";
import {
  Brain,
  Loader2,
  Pause,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  Play,
  Zap,
  Target,
  BarChart3,
  MousePointerClick,
  Eye,
  Users,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────

interface StrategicCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: string; // "PAUSE_AD" | "SCALE_BUDGET_UP" etc.
  entityName: string;
  entityType: string; // "campaign" | "adset" | "ad" | "ad_group"
  platform: string; // "meta" | "google"
  currentMetrics?: {
    spend?: number;
    leads?: number;
    cpl?: number;
    ctr?: number;
    impressions?: number;
    cpc?: number;
    cvr?: number;
  };
  onConfirm: (strategicCall: string) => void;
  isExecuting?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getActionDisplay(actionType: string): {
  label: string;
  icon: typeof Pause;
  color: string;
  bgColor: string;
} {
  if (actionType.startsWith("PAUSE"))
    return { label: actionType.replace(/_/g, " "), icon: Pause, color: "text-red-400", bgColor: "bg-red-500/10" };
  if (actionType.includes("SCALE_BUDGET_UP") || actionType.includes("ENABLE"))
    return { label: actionType.replace(/_/g, " "), icon: TrendingUp, color: "text-emerald-400", bgColor: "bg-emerald-500/10" };
  if (actionType.includes("SCALE_BUDGET_DOWN"))
    return { label: actionType.replace(/_/g, " "), icon: TrendingDown, color: "text-amber-400", bgColor: "bg-amber-500/10" };
  if (actionType.includes("SET_BUDGET") || actionType.includes("SET_CAMPAIGN_BUDGET"))
    return { label: "SET BUDGET", icon: IndianRupee, color: "text-purple-400", bgColor: "bg-purple-500/10" };
  return { label: actionType.replace(/_/g, " "), icon: Zap, color: "text-primary", bgColor: "bg-primary/10" };
}

function getPlaceholderText(actionType: string): string {
  if (actionType.startsWith("PAUSE"))
    return "e.g., CPL has been 40% above target for 5 days with declining CTR, pausing to reallocate budget to winners";
  if (actionType.includes("SCALE_BUDGET_UP"))
    return "e.g., This winner has maintained CPL 30% below target for 7 days with consistent volume — scaling to capture more leads";
  if (actionType.includes("SCALE_BUDGET_DOWN"))
    return "e.g., Performance declining over last 3 days, reducing budget while we test new creative variants";
  return "e.g., Describe the strategic reasoning behind this action — what data supports it, what outcome do you expect?";
}

const MIN_RATIONALE_LENGTH = 20;

// ─── Component ──────────────────────────────────────────────────────

export function StrategicCallDialog({
  open,
  onOpenChange,
  actionType,
  entityName,
  entityType,
  platform,
  currentMetrics,
  onConfirm,
  isExecuting = false,
}: StrategicCallDialogProps) {
  const [rationale, setRationale] = useState("");
  const actionDisplay = getActionDisplay(actionType);
  const ActionIcon = actionDisplay.icon;
  const isValid = rationale.trim().length >= MIN_RATIONALE_LENGTH;

  function handleConfirm() {
    if (!isValid) return;
    onConfirm(rationale.trim());
    setRationale("");
  }

  function handleOpenChange(newOpen: boolean) {
    if (!newOpen) {
      setRationale("");
    }
    onOpenChange(newOpen);
  }

  const metrics = currentMetrics || {};
  const hasMetrics = Object.values(metrics).some((v) => v != null && v !== 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[560px] !overflow-visible !max-h-none gap-3 p-5" data-testid="strategic-call-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Brain className="w-4 h-4 text-amber-400" />
            Strategic Call Required
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Document your rationale before executing. This builds your decision-learning database.
          </DialogDescription>
        </DialogHeader>

        {/* Action being taken */}
        <div className="flex items-center gap-2.5 rounded-md p-2.5 border border-border/50 bg-muted/30">
          <div className={`p-1.5 rounded-md ${actionDisplay.bgColor}`}>
            <ActionIcon className={`w-3.5 h-3.5 ${actionDisplay.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${actionDisplay.color} ${actionDisplay.bgColor}`}>
                {actionDisplay.label}
              </Badge>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                {platform === "google" ? "Google" : "Meta"}
              </Badge>
            </div>
            <p className="text-xs font-medium text-foreground mt-0.5 truncate" title={entityName}>
              {entityName}
            </p>
            <p className="text-[9px] text-muted-foreground">{entityType}</p>
          </div>
        </div>

        {/* Before Metrics - compact inline */}
        {hasMetrics && (
          <div className="rounded-md border border-border/50 p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <BarChart3 className="w-3 h-3 text-muted-foreground" />
              <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                Current Metrics
              </span>
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1.5">
              {metrics.spend != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground">Spend</p>
                  <p className="text-xs font-semibold tabular-nums">{formatINR(metrics.spend, 0)}</p>
                </div>
              )}
              {metrics.leads != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground">Leads</p>
                  <p className="text-xs font-semibold tabular-nums">{metrics.leads}</p>
                </div>
              )}
              {metrics.cpl != null && metrics.cpl > 0 && (
                <div>
                  <p className="text-[9px] text-muted-foreground">CPL</p>
                  <p className="text-xs font-semibold tabular-nums">{formatINR(metrics.cpl, 0)}</p>
                </div>
              )}
              {metrics.ctr != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground">CTR</p>
                  <p className="text-xs font-semibold tabular-nums">{metrics.ctr.toFixed(2)}%</p>
                </div>
              )}
              {metrics.impressions != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground">Impressions</p>
                  <p className="text-xs font-semibold tabular-nums">
                    {metrics.impressions.toLocaleString("en-IN")}
                  </p>
                </div>
              )}
              {metrics.cpc != null && metrics.cpc > 0 && (
                <div>
                  <p className="text-[9px] text-muted-foreground">CPC</p>
                  <p className="text-xs font-semibold tabular-nums">{formatINR(metrics.cpc, 0)}</p>
                </div>
              )}
              {metrics.cvr != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground">CVR</p>
                  <p className="text-xs font-semibold tabular-nums">{metrics.cvr.toFixed(2)}%</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Strategic Rationale Input */}
        <div className="space-y-1.5 rounded-md p-2.5 border border-amber-500/30 bg-amber-500/5">
          <label className="text-[11px] font-medium text-amber-400 flex items-center gap-1.5">
            <Brain className="w-3 h-3" />
            What's your strategic rationale?
          </label>
          <Textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder={getPlaceholderText(actionType)}
            className="min-h-[80px] text-xs bg-background border-amber-500/20 focus-visible:ring-amber-500/40 placeholder:text-muted-foreground/50 resize-none"
            data-testid="input-strategic-rationale"
          />
          <div className="flex items-center justify-between">
            <span
              className={`text-[9px] ${
                rationale.trim().length >= MIN_RATIONALE_LENGTH
                  ? "text-emerald-400"
                  : "text-muted-foreground"
              }`}
            >
              {rationale.trim().length}/{MIN_RATIONALE_LENGTH} min chars
            </span>
            {rationale.trim().length > 0 && rationale.trim().length < MIN_RATIONALE_LENGTH && (
              <span className="text-[9px] text-amber-400">
                {MIN_RATIONALE_LENGTH - rationale.trim().length} more needed
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={isExecuting}
            data-testid="button-strategic-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
            onClick={handleConfirm}
            disabled={!isValid || isExecuting}
            data-testid="button-strategic-execute"
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Execute with Rationale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
