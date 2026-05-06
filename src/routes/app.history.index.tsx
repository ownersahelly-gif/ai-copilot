import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listRuns } from "@/lib/workflows";
import { CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";

export const Route = createFileRoute("/app/history/")({ component: HistoryPage });

type RunRow = {
  id: string; status: string; mode: string; started_at: string; finished_at: string | null;
  current_step: number; total_steps: number; workflow_id: string; error: string | null;
  workflows?: { name: string } | null;
};

function HistoryPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRuns().then((r) => { setRuns(r as unknown as RunRow[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">History & Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every run, ever. Inspect, retry or share.</p>
      </div>
      <div className="glass rounded-xl">
        {loading ? (
          <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : runs.length === 0 ? (
          <div className="grid h-40 place-items-center text-sm text-muted-foreground">No runs yet.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {runs.map((r) => {
              const Icon = r.status === "completed" ? CheckCircle2 : r.status === "failed" ? XCircle : r.status === "running" ? Loader2 : Clock;
              const c = r.status === "completed" ? "text-success" : r.status === "failed" ? "text-destructive" : r.status === "running" ? "text-primary" : "text-muted-foreground";
              return (
                <li key={r.id} className="flex items-center gap-4 px-5 py-3.5">
                  <Icon className={`h-4 w-4 ${c} ${r.status === "running" ? "animate-spin" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.workflows?.name ?? "Workflow"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(r.started_at).toLocaleString()} · {r.mode} mode · {r.current_step}/{r.total_steps} steps
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${c} bg-current/10`}>{r.status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
