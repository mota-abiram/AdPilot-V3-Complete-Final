import { useEffect, useRef } from "react";
import { queryClient } from "@/lib/queryClient";

/**
 * SSE hook that listens for live server events and invalidates
 * React Query caches when data is refreshed (e.g., after scheduler run).
 */
export function useLiveUpdates() {
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;

    es.addEventListener("data-refreshed", () => {
      // Invalidate all analysis queries so pages re-fetch
      queryClient.invalidateQueries();
    });

    es.addEventListener("agent-run-started", () => {
      // Could show a toast — for now just log
      console.log("[SSE] Agent run started");
    });

    es.addEventListener("agent-run-failed", (e) => {
      console.warn("[SSE] Agent run failed:", e.data);
    });

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);
}
