import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Play, Pause, Square, Camera, MousePointer, Keyboard, Scroll, AppWindow, Sparkles, Loader2, Monitor, MonitorOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getWorkflow, updateWorkflow, startRun, type Workflow, type WorkflowStep, type WorkflowVariable } from "@/lib/workflows";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { agent, useAgentStatus, type AgentEvent } from "@/lib/agent-bridge";

export const Route = createFileRoute("/app/library/$id")({ component: WorkflowDetail });

const ICONS = { click: MousePointer, type: Keyboard, scroll: Scroll, screenshot: Camera, open_app: AppWindow, navigate: AppWindow, drag: MousePointer, shortcut: Keyboard, wait: Sparkles, extract: Camera } as const;

function WorkflowDetail() {
  const { id } = useParams({ from: "/app/library/$id" });
  const nav = useNavigate();
  const [w, setW] = useState<Workflow | null>(null);
  const [tab, setTab] = useState<"overview" | "run">("overview");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [mode, setMode] = useState<"auto" | "step" | "assist" | "background">("auto");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<{ ts: string; level: string; msg: string }[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ runId: string; index: number } | null>(null);
  const agentStatus = useAgentStatus();

  useEffect(() => {
    getWorkflow(id).then((d) => { setW(d); setName(d.name); setDesc(d.description ?? ""); }).catch(() => {});
  }, [id]);

  if (!w) return <div className="grid h-[60vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const steps = (w.steps as unknown) as WorkflowStep[];
  const vars = (w.variables as unknown) as WorkflowVariable[];

  const saveMeta = async () => {
    await updateWorkflow(id, { name, description: desc });
    toast.success("Saved");
  };

  const log = (level: string, msg: string) => setLogs((l) => [...l, { ts: new Date().toISOString(), level, msg }]);

  const runReal = async (runRow: { id: string }) => {
    return new Promise<boolean>((resolve) => {
      const off = agent.onEvent((e: AgentEvent) => {
        if (e.type === "run_started") log("info", `Agent accepted run · ${e.total} steps`);
        else if (e.type === "step_started") { setCurrentStep(e.index + 1); log("info", `Step ${e.index + 1}: ${e.step.description}`); }
        else if (e.type === "step_done") {
          if (e.screenshot) setScreenshot(`data:image/jpeg;base64,${e.screenshot}`);
          if (!e.ok) log("error", `Step failed: ${e.error}`);
        }
        else if (e.type === "awaiting_approval") setPendingApproval({ runId: runRow.id, index: e.index });
        else if (e.type === "log") log(e.level, e.msg);
        else if (e.type === "error") log("error", e.msg);
        else if (e.type === "run_finished") {
          log(e.ok ? "success" : "error", e.ok ? "Workflow completed on this machine" : "Workflow failed");
          off(); resolve(e.ok);
        }
      });
      try {
        agent.runWorkflow({ runId: runRow.id, mode, steps, inputs });
      } catch (err) {
        log("error", (err as Error).message); off(); resolve(false);
      }
    });
  };

  const runSimulated = async () => {
    for (let i = 0; i < steps.length; i++) {
      await new Promise((res) => setTimeout(res, 800));
      setCurrentStep(i + 1);
      const s = steps[i];
      log("info", `Step ${i+1}: ${s.description}`);
      if (Math.random() < 0.12) {
        log("warn", `Recovery agent: layout shift detected, re-locating element`);
        await new Promise((res) => setTimeout(res, 500));
        log("info", `Recovered. Continuing.`);
      }
    }
    log("success", "Workflow completed (simulated — connect the desktop agent in Settings to run for real)");
    return true;
  };

  const run = async () => {
    setRunning(true); setCurrentStep(0); setLogs([]); setScreenshot(null); setPendingApproval(null);
    try {
      const r = await startRun(id, mode, inputs);
      const useReal = agentStatus.status === "connected";
      log("info", useReal ? "Dispatching to local desktop agent…" : "Running in simulator…");
      const ok = useReal ? await runReal(r) : await runSimulated();
      await supabase.from("workflow_runs").update({
        status: ok ? "completed" : "failed",
        finished_at: new Date().toISOString(),
        current_step: steps.length,
      }).eq("id", r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Run failed");
    } finally { setRunning(false); setPendingApproval(null); }
  };

  const approve = (ok: boolean) => {
    if (!pendingApproval) return;
    agent.approveStep(pendingApproval.runId, ok);
    setPendingApproval(null);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to="/app/library" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Library
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{w.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{w.description ?? "No description"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTab("overview")} className={tab === "overview" ? "border-primary text-primary" : ""}>Overview</Button>
          <Button onClick={() => setTab("run")} style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }} className="gap-2"><Play className="h-4 w-4" /> Run workflow</Button>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 glass rounded-xl p-6">
            <h2 className="mb-4 font-display text-lg font-semibold">Steps</h2>
            <ol className="space-y-2">
              {steps.map((s, i) => {
                const Icon = ICONS[s.type] ?? MousePointer;
                return (
                  <li key={s.id ?? i} className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
                    <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-secondary font-mono text-xs">{i + 1}</span>
                    <Icon className="mt-1.5 h-4 w-4 text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{s.description}</div>
                      <div className="text-[10px] text-muted-foreground">{s.type} · {s.target}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="space-y-4">
            <div className="glass rounded-xl p-5">
              <h3 className="mb-3 font-display text-sm font-semibold">Properties</h3>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1.5" />
                </div>
                <Button size="sm" onClick={saveMeta} className="w-full">Save changes</Button>
              </div>
            </div>
            <div className="glass rounded-xl p-5">
              <h3 className="mb-3 font-display text-sm font-semibold">Variables</h3>
              {vars.length === 0 ? <p className="text-xs text-muted-foreground">No variables.</p> : (
                <ul className="space-y-2 text-xs">
                  {vars.map((v) => <li key={v.name} className="flex justify-between"><span>{v.name}</span><span className="text-muted-foreground">{v.type}</span></li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-1">
            <div className="glass rounded-xl p-5">
              <h3 className="mb-3 font-display text-sm font-semibold">Replay mode</h3>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Fully automatic</SelectItem>
                  <SelectItem value="step">Step approval</SelectItem>
                  <SelectItem value="assist">Assist mode</SelectItem>
                  <SelectItem value="background">Background</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {vars.length > 0 && (
              <div className="glass rounded-xl p-5">
                <h3 className="mb-3 font-display text-sm font-semibold">Inputs</h3>
                <div className="space-y-3">
                  {vars.map((v) => (
                    <div key={v.name}>
                      <Label className="text-xs">{v.name} <span className="text-muted-foreground">· {v.type}</span></Label>
                      <Input
                        type={v.type === "file" ? "file" : "text"}
                        placeholder={v.description ?? v.name}
                        className="mt-1.5"
                        onChange={(e) => setInputs({ ...inputs, [v.name]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Button disabled={running} onClick={run} className="w-full gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
              {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {running ? "Running…" : "Start execution"}
            </Button>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="glass rounded-xl p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-sm font-semibold">Live execution</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${agentStatus.status === "connected" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                    {agentStatus.status === "connected" ? "REAL · agent" : "SIMULATED"}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{currentStep} / {steps.length}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <motion.div className="h-full" style={{ background: "var(--gradient-primary)" }} animate={{ width: `${(currentStep / Math.max(steps.length, 1)) * 100}%` }} />
              </div>
              <div className="mt-4 relative grid min-h-[200px] place-items-center overflow-hidden rounded-lg border border-dashed border-border/60 bg-background/40">
                {livePreview ? (
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="h-full max-h-[420px] w-full object-contain bg-black"
                  />
                ) : screenshot ? (
                  <img src={screenshot} alt="Agent screen" className="max-h-[320px] w-full object-contain" />
                ) : running ? (
                  <div className="text-center">
                    <Camera className="mx-auto h-8 w-8 animate-pulse text-primary" />
                    <p className="mt-2 text-xs text-muted-foreground">{agentStatus.status === "connected" ? "Agent executing on this machine…" : "Vision agent capturing screen…"}</p>
                    <p className="mt-1 text-sm">{steps[Math.max(currentStep - 1, 0)]?.description}</p>
                  </div>
                ) : <p className="text-xs text-muted-foreground">Idle — enable live preview to watch your screen</p>}

                {/* Live current-step caption overlay */}
                {livePreview && running && steps[Math.max(currentStep - 1, 0)] && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-center text-xs text-white">
                    Step {currentStep}/{steps.length} · {steps[Math.max(currentStep - 1, 0)]?.description}
                  </div>
                )}

                {/* Toggle button */}
                <button
                  onClick={() => setLivePreview((v) => !v)}
                  className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/80 px-2 py-1 text-[11px] backdrop-blur hover:bg-background"
                >
                  {livePreview ? <MonitorOff className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5 text-primary" />}
                  {livePreview ? "Stop preview" : "Live preview"}
                </button>
              </div>
              {pendingApproval && (
                <div className="mt-3 flex items-center justify-between rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
                  <span>Approve step {pendingApproval.index + 1}: <strong>{steps[pendingApproval.index]?.description}</strong></span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => approve(false)}>Skip</Button>
                    <Button size="sm" onClick={() => approve(true)}>Approve</Button>
                  </div>
                </div>
              )}
            </div>
            <div className="glass rounded-xl p-5">
              <h3 className="mb-3 font-display text-sm font-semibold">Logs</h3>
              <div className="h-[220px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                {logs.length === 0 && <p className="text-muted-foreground">No logs yet.</p>}
                {logs.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-muted-foreground">{new Date(l.ts).toLocaleTimeString()}</span>
                    <span className={l.level === "warn" ? "text-warning" : l.level === "success" ? "text-success" : "text-foreground"}>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
