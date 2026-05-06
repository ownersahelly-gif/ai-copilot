import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Library, Activity, Mic, Sparkles, ArrowUpRight, Zap, Brain, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listWorkflows, listRuns, type Workflow, type WorkflowRun } from "@/lib/workflows";

export const Route = createFileRoute("/app/")({ component: Dashboard });

function Stat({ icon: Icon, label, value, accent }: { icon: typeof Zap; label: string; value: string; accent?: string }) {
  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${accent ?? "text-primary"}`} />
      </div>
      <div className="mt-3 font-display text-3xl font-semibold">{value}</div>
    </div>
  );
}

function Dashboard() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  useEffect(() => {
    listWorkflows().then(setWorkflows).catch(() => {});
    listRuns().then((r) => setRuns(r as unknown as WorkflowRun[])).catch(() => {});
  }, []);

  const totalRuns = workflows.reduce((s, w) => s + w.run_count, 0);
  const succ = runs.filter((r) => r.status === "completed").length;
  const succRate = runs.length ? Math.round((succ / runs.length) * 100) : 100;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Welcome back.</h1>
            <p className="mt-1 text-muted-foreground">Your AI coworker is ready. What should we automate today?</p>
          </div>
          <div className="flex gap-2">
            <Link to="/app/studio"><Button className="gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}><Mic className="h-4 w-4" /> Teach AI</Button></Link>
            <Link to="/app/assistant"><Button variant="outline" className="gap-2"><Sparkles className="h-4 w-4" /> Ask AI</Button></Link>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Library} label="Workflows" value={workflows.length.toString()} />
        <Stat icon={Activity} label="Total runs" value={totalRuns.toString()} accent="text-accent" />
        <Stat icon={TrendingUp} label="Success rate" value={`${succRate}%`} accent="text-success" />
        <Stat icon={Brain} label="Hours saved" value={`${(totalRuns * 0.4).toFixed(1)}h`} accent="text-warning" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 glass rounded-xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Recent workflows</h2>
            <Link to="/app/library" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">View all <ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          {workflows.length === 0 ? (
            <EmptyWorkflows />
          ) : (
            <ul className="divide-y divide-border/60">
              {workflows.slice(0, 5).map((w) => (
                <li key={w.id} className="group flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <Link to="/app/library/$id" params={{ id: w.id }} className="block truncate font-medium hover:text-primary">{w.name}</Link>
                    <p className="truncate text-xs text-muted-foreground">{w.description ?? "No description"}</p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{w.run_count} runs</div>
                    <div>{new Date(w.updated_at).toLocaleDateString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass rounded-xl p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">AI agents</h2>
          <ul className="space-y-3">
            {[
              { n: "Planner", s: "idle", c: "text-muted-foreground" },
              { n: "Vision", s: "ready", c: "text-primary" },
              { n: "Learner", s: "ready", c: "text-primary" },
              { n: "Executor", s: "idle", c: "text-muted-foreground" },
              { n: "Recovery", s: "armed", c: "text-warning" },
              { n: "Memory", s: "active", c: "text-success" },
            ].map((a) => (
              <li key={a.n} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{a.n}</span>
                <span className={`flex items-center gap-2 text-xs ${a.c}`}>
                  <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-current"><span className="pulse-dot" /></span>
                  {a.s}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function EmptyWorkflows() {
  return (
    <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
      <Brain className="mx-auto h-8 w-8 text-muted-foreground/60" />
      <h3 className="mt-3 font-display font-medium">No workflows yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Press <span className="text-foreground">Teach AI</span> and demonstrate a task. EchoPilot will learn it and let you replay it on any data.</p>
      <Link to="/app/studio"><Button className="mt-4 gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}><Mic className="h-4 w-4" /> Record your first workflow</Button></Link>
    </div>
  );
}
