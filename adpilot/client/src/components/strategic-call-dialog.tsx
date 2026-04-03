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
  BarChart3,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────

interface StrategicCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: string; // "PAUSE_AD" | "SCALE_BUDGET_UP" | "REJECT" | "MARK_COMPLETE" etc.
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
  /** Override the confirm button label */
  confirmLabel?: string;
  /** Override the dialog title */
  titleOverride?: string;
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
  confirmLabel,
  titleOverride,
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
      <DialogContent className="sm:max-w-[620px] !overflow-visible !max-h-none gap-4 p-6" data-testid="strategic-call-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            {titleOverride || "Strategic Call Required"}
          </DialogTitle>
          <DialogDescription className="type-sm">
            Document your rationale before acting. This builds your decision-learning database.
          </DialogDescription>
        </DialogHeader>

        {/* Action being taken */}
        <div className="flex items-center gap-3 rounded-[10px] p-4 border border-border/70 bg-card/82 shadow-xs">
          <div className={`p-2 rounded-lg ${actionDisplay.bgColor}`}>
            <ActionIcon className={`w-3.5 h-3.5 ${actionDisplay.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Badge
                variant={
                  actionType.startsWith("PAUSE")
                    ? "destructive"
                    : actionType.includes("SCALE_BUDGET_DOWN")
                    ? "warning"
                    : "success"
                }
                className="text-[10px]"
              >
                {actionDisplay.label}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {platform === "google" ? "Google" : "Meta"}
              </Badge>
            </div>
            <p className="text-base font-semibold text-foreground mt-1 truncate" title={entityName}>
              {entityName}
            </p>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{entityType}</p>
          </div>
        </div>

        {/* Before Metrics - compact inline */}
        {hasMetrics && (
          <div className="rounded-[10px] border border-border/70 bg-muted/25 p-3.5">
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Current Metrics
              </span>
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1.5">
              {metrics.spend != null && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">Spend</p>
                  <p className="text-sm font-semibold tabular-nums">{formatINR(metrics.spend, 0)}</p>
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
        <div className="space-y-2 rounded-[10px] p-4 border border-primary/30 bg-primary/10">
          <label className="text-xs font-bold uppercase tracking-[0.08em] text-foreground flex items-center gap-1.5">
            <Brain className="w-3 h-3" />
            What's your strategic rationale?
          </label>
          <Textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder={getPlaceholderText(actionType)}
            className="min-h-[120px] text-sm bg-background border-primary/20 focus-visible:ring-primary/45 placeholder:text-muted-foreground/55 resize-none"
            data-testid="input-strategic-rationale"
          />
          <div className="flex items-center justify-between">
            <span
              className={`text-[9px] ${
                rationale.trim().length >= MIN_RATIONALE_LENGTH
                  ? "text-emerald-500"
                  : "text-muted-foreground"
              }`}
            >
              {rationale.trim().length}/{MIN_RATIONALE_LENGTH} min chars
            </span>
            {rationale.trim().length > 0 && rationale.trim().length < MIN_RATIONALE_LENGTH && (
              <span className="text-[10px] text-primary">
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
            className="gap-1.5"
            onClick={handleConfirm}
            disabled={!isValid || isExecuting}
            data-testid="button-strategic-execute"
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {confirmLabel || "Execute with Rationale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
