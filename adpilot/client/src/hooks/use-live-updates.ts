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

    const invalidateSyncState = () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey.includes("sync-state"),
      });
    };

    es.addEventListener("data-refreshed", () => {
      // Invalidate all analysis queries so pages re-fetch
      queryClient.invalidateQueries();
    });

    es.addEventListener("agent-run-started", () => {
      invalidateSyncState();
      console.log("[SSE] Agent run started");
    });

    es.addEventListener("agent-run-failed", (e) => {
      invalidateSyncState();
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
