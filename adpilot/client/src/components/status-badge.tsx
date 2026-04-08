import { Badge } from "@/components/ui/badge";
import { getClassificationColor } from "@/lib/format";
import { type Classification } from "@shared/scoring";

export function StatusBadge({ classification }: { classification: string | Classification }) {
  const normalized = (classification || "WATCH").toUpperCase() as Classification;
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
