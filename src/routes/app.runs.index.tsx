import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Play, ArrowRight } from "lucide-react";
import { listRuns, listWorkflows, type Workflow } from "@/lib/workflows";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/runs/")({ component: RunsPage });

type RunRow = {
  id: string; status: string; mode: string; started_at: string; finished_at: string | null;
  current_step: number; total_steps: number; workflow_id: string; workflows?: { name: string } | null;
};

function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);

  useEffect(() => {
    listRuns().then((r) => setRuns(r as unknown as RunRow[])).catch(() => {});
    listWorkflows().then(setWorkflows).catch(() => {});
  }, []);

  const active = runs.filter((r) => r.status === "running" || r.status === "queued");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Live Execution</h1>
        <p className="mt-1 text-sm text-muted-foreground">Monitor active runs and queue new ones.</p>
      </div>

      <div className="glass rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Active</h2>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`relative inline-block h-2 w-2 rounded-full ${active.length ? "bg-success text-success" : "bg-muted-foreground"}`}>
              {!!active.length && <span className="pulse-dot" />}
            </span>
            {active.length} running
          </span>
        </div>
        {active.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
            <Activity className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">Nothing running. Start a workflow from your library.</p>
            <Link to="/app/library"><Button variant="outline" className="mt-3 gap-2">Open library <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {active.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 p-3 text-sm">
                <span>{r.workflows?.name ?? "Workflow"}</span>
                <span className="text-xs text-muted-foreground">{r.current_step}/{r.total_steps}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="glass rounded-xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Quick run</h2>
        {workflows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workflows yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {workflows.slice(0, 6).map((w) => (
              <Link key={w.id} to="/app/library/$id" params={{ id: w.id }} className="group flex items-center justify-between rounded-lg border border-border/60 bg-card/40 p-3 transition-colors hover:border-primary/50">
                <span className="truncate text-sm">{w.name}</span>
                <Play className="h-4 w-4 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
