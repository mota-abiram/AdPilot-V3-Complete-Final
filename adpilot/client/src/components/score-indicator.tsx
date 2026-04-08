import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHealthBgColor, getHealthBarBg } from "@/lib/format";

interface ScoreIndicatorProps {
  score: number;
  breakdown?: Record<string, number>;
  label?: string;
  description?: string;
}

export function ScoreIndicator({ score, breakdown, label, description }: ScoreIndicatorProps) {
  const safeScore = Math.round(Math.max(0, Math.min(100, score || 0)));
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 group cursor-help">
          <div className={`w-14 h-1.5 rounded-full overflow-hidden ${getHealthBarBg(safeScore)}`}>
            <div 
              className={`h-full rounded-full transition-all duration-500 ${getHealthBgColor(safeScore)}`} 
              style={{ width: `${safeScore}%` }} 
            />
          </div>
          <span className="tabular-nums text-[11px] font-bold text-muted-foreground group-hover:text-foreground transition-colors w-6">
            {safeScore}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs p-3">
        <div className="text-xs space-y-1.5">
          <div className="flex items-center justify-between border-b border-border/50 pb-1.5 mb-1.5">
            <p className="font-bold">{label || "Scoring Breakdown"}</p>
            <span className={`text-[11px] font-black ${getHealthBgColor(safeScore).replace('bg-', 'text-')}`}>
              {safeScore}/100
            </span>
          </div>
          
          {description && <p className="text-[10px] text-muted-foreground pb-1">{description}</p>}
          
          {breakdown ? (
            <div className="space-y-1">
              {Object.entries(breakdown).map(([k, v]) => {
                const val = typeof v === "number" ? Math.round(v) : 0;
                let color = "text-muted-foreground";
                if (val >= 85) color = "text-emerald-400";
                else if (val >= 70) color = "text-emerald-500/80";
                else if (val >= 40) color = "text-amber-400";
                else color = "text-red-400";

                return (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="uppercase text-[9px] font-bold opacity-70">{k.replace(/_/g, ' ')}</span>
                    <span className={`font-bold tabular-nums ${color}`}>{val}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground italic text-[10px]">Detailed breakdown unavailable</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
