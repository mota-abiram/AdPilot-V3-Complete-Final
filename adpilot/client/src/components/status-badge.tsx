import { Badge } from "@/components/ui/badge";
import { getClassificationColor } from "@/lib/format";
import type { Classification } from "@shared/classification";

export function StatusBadge({ classification }: { classification: string | Classification | undefined }) {
  const rawValue = (classification || "WATCH").toString().toUpperCase();
  const normalized = (["WINNER", "WATCH", "UNDERPERFORMER"].includes(rawValue) ? rawValue : "WATCH") as Classification;
  const colors = getClassificationColor(normalized);
  
  return (
    <Badge 
      variant="secondary" 
      className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-tight ${colors.bg} ${colors.text} border-none shadow-sm`}
    >
      {normalized}
    </Badge>
  );
}
