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
  AlertCircle,
  Info,
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
      <DialogContent 
        className="sm:max-w-2xl bg-white rounded-2xl shadow-2xl p-0 overflow-hidden border-none" 
        data-testid="strategic-call-dialog"
      >
        {/* Premium Header */}
        <div className="p-8 pb-6 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
               <div className="p-2 rounded-xl bg-primary/5 text-primary border border-primary/10">
                  <Brain className="w-5 h-5" />
               </div>
               <DialogTitle className="text-xl font-bold tracking-tight text-slate-800">
                  {titleOverride || "Strategic Decision Audit"}
               </DialogTitle>
            </div>
            <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${actionDisplay.bgColor} ${actionDisplay.color} border border-border/40`}>
                {actionDisplay.label}
            </div>
          </div>
          <DialogDescription className="text-sm text-slate-500 font-medium">
            AI is recommending an intervention. Please provide the strategic bridge to finalize this action.
          </DialogDescription>
        </div>

        <div className="px-8 space-y-6">
           {/* Context Layer: Entity & Platform */}
           <div className="flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl shadow-sm border border-slate-200">
                 {platform === 'google' ? (
                   <img src="https://upload.wikimedia.org/wikipedia/commons/c/c7/Google_Ads_logo.svg" className="w-6 h-6" alt="Google" />
                 ) : (
                   <img src="https://upload.wikimedia.org/wikipedia/commons/e/ee/Logo_Meta_Platforms.svg" className="w-6 h-6" alt="Meta" />
                 )}
                 <span className="text-[9px] font-bold uppercase mt-1 text-slate-400">{platform}</span>
              </div>
              <div className="flex-1 min-w-0">
                 <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-0.5">{entityType}</p>
                 <h4 className="text-lg font-bold text-slate-800 truncate leading-tight">{entityName}</h4>
              </div>
           </div>

           {/* Metrics Grid */}
           {hasMetrics && (
             <div className="space-y-3">
                <div className="flex items-center gap-2">
                   <BarChart3 className="w-3.5 h-3.5 text-slate-400" />
                   <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Decision Parameters</span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                   {metrics.spend != null && (
                     <div className="space-y-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase">Spend</p>
                        <p className="text-sm font-bold text-slate-700 tabular-nums">{formatINR(metrics.spend, 0)}</p>
                     </div>
                   )}
                   {metrics.cpl != null && metrics.cpl > 0 && (
                     <div className="space-y-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase">CPL</p>
                        <p className="text-sm font-bold text-slate-700 tabular-nums">{formatINR(metrics.cpl, 0)}</p>
                     </div>
                   )}
                   {metrics.ctr != null && (
                     <div className="space-y-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase">CTR</p>
                        <p className="text-sm font-bold text-slate-700 tabular-nums">{metrics.ctr.toFixed(2)}%</p>
                     </div>
                   )}
                   {metrics.leads != null && (
                     <div className="space-y-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase">Leads</p>
                        <p className="text-sm font-bold text-slate-700 tabular-nums">{metrics.leads}</p>
                     </div>
                   )}
                </div>
             </div>
           )}

           {/* Strategic Rationale Input */}
           <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Executive Rationale</span>
                 </div>
                 <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full ${rationale.trim().length >= MIN_RATIONALE_LENGTH ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-100 text-slate-400'}`}>
                    {rationale.trim().length}/{MIN_RATIONALE_LENGTH}
                 </span>
              </div>
              <div className="relative group">
                 <Textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder={getPlaceholderText(actionType)}
                    className="min-h-[140px] p-5 text-sm font-medium bg-slate-50 border-slate-200 rounded-2xl focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all placeholder:text-slate-400 resize-none shadow-inner"
                    data-testid="input-strategic-rationale"
                 />
                 {rationale.trim().length > 0 && rationale.trim().length < MIN_RATIONALE_LENGTH && (
                    <div className="absolute right-4 bottom-4 flex items-center gap-1.5 px-3 py-1 bg-white/80 backdrop-blur rounded-lg border border-slate-200 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                       <Info className="w-3 h-3 text-primary" strokeWidth={3} />
                       <span className="text-[10px] font-bold text-primary">Provide {MIN_RATIONALE_LENGTH - rationale.trim().length} more chars</span>
                    </div>
                 )}
              </div>
           </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-10 p-8 pt-6 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-3">
           <Button
              variant="ghost"
              className="text-slate-500 font-bold text-xs uppercase tracking-widest hover:bg-slate-100"
              onClick={() => handleOpenChange(false)}
              disabled={isExecuting}
           >
              Dismiss
           </Button>
           <Button
              className="h-12 px-8 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xl shadow-slate-900/10 transition-all active:scale-95 disabled:scale-100 gap-2 overflow-hidden relative"
              onClick={handleConfirm}
              disabled={!isValid || isExecuting}
           >
              {isExecuting ? (
                 <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                 <Play className="w-4 h-4 fill-current" />
              )}
              <span className="relative z-10">{confirmLabel || "Authorize Action"}</span>
           </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
