import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Sparkles, Camera, MousePointer, Keyboard, Scroll, AppWindow, Loader2, Save, ArrowLeft, AlertTriangle, Monitor, MonitorOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { generateWorkflowFromPrompt, analyzeClickTarget } from "@/ai/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { createWorkflow, type WorkflowStep, type WorkflowVariable } from "@/lib/workflows";
import { agent, useAgentStatus, type RecordedEvent } from "@/lib/agent-bridge";
import { toast } from "sonner";

export const Route = createFileRoute("/app/studio/")({ component: Studio });

const ICONS = {
  click: MousePointer, type: Keyboard, scroll: Scroll, screenshot: Camera,
  open_app: AppWindow, navigate: AppWindow, drag: MousePointer, shortcut: Keyboard, wait: Sparkles, extract: Camera,
} as const;

// Default substrings (case-insensitive) that mark an event as happening inside
// the EchoPilot web app itself, so we filter it out of the recording.
const DEFAULT_IGNORE_PATTERNS = [
  "echopilot", "lovable.app", "lovableproject.com", "localhost", "127.0.0.1",
];

function isOwnTabEvent(e: RecordedEvent, extra: string[]): boolean {
  const hay = `${e.app ?? ""} ${e.window ?? ""}`.toLowerCase();
  if (!hay.trim()) return false;
  return [...DEFAULT_IGNORE_PATTERNS, ...extra]
    .filter(Boolean)
    .some((p) => hay.includes(p.toLowerCase()));
}

function Studio() {
  const nav = useNavigate();
  const generate = useServerFn(generateWorkflowFromPrompt);
  const analyze = useServerFn(analyzeClickTarget);
  const { status: agentStatus } = useAgentStatus();
  const agentConnected = agentStatus === "connected";

  const [mode, setMode] = useState<"choose" | "demo" | "describe" | "review">("choose");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [vars, setVars] = useState<WorkflowVariable[]>([]);
  const [busy, setBusy] = useState(false);

  // New: ignore-own-tab + webcam + explain-each-step
  const [ignoreSelf, setIgnoreSelf] = useState(true);
  const [extraIgnore, setExtraIgnore] = useState("");
  const [screenOn, setScreenOn] = useState(false);
  const [explainEach, setExplainEach] = useState(true);
  const [explainQueue, setExplainQueue] = useState<RecordedEvent[]>([]);
  const [pendingExplain, setPendingExplain] = useState("");
  const pendingEvent = explainQueue[0] ?? null;
  

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTsRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Capture a frame from the live screen-share, optionally drawing a marker
  // at (markX, markY) which are in physical pixels of the captured display.
  const captureFrame = (markX?: number, markY?: number): { url: string; w: number; h: number } | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const w = video.videoWidth, h = video.videoHeight;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    if (typeof markX === "number" && typeof markY === "number") {
      const r = Math.max(14, Math.min(w, h) * 0.012);
      // Outer halo
      ctx.beginPath();
      ctx.fillStyle = "rgba(255, 64, 96, 0.25)";
      ctx.arc(markX, markY, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      // Inner ring
      ctx.beginPath();
      ctx.lineWidth = Math.max(3, r * 0.4);
      ctx.strokeStyle = "rgba(255, 64, 96, 0.95)";
      ctx.arc(markX, markY, r, 0, Math.PI * 2);
      ctx.stroke();
      // Center dot
      ctx.beginPath();
      ctx.fillStyle = "white";
      ctx.arc(markX, markY, Math.max(2, r * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }
    return { url: canvas.toDataURL("image/jpeg", 0.7), w, h };
  };

  // Screen-share preview lifecycle
  useEffect(() => {
    if (!screenOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      return;
    }
    let cancelled = false;
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        // If the user clicks the browser's "Stop sharing" button
        stream.getVideoTracks()[0]?.addEventListener("ended", () => setScreenOn(false));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch((err) => {
        toast.error(`Screen share: ${err instanceof Error ? err.message : "permission denied"}`);
        setScreenOn(false);
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [screenOn]);

  // Smart auto-explanation per event kind & app context
  const autoExplain = (e: RecordedEvent): string => {
    const appCtx = e.app ? ` in ${e.app}` : "";
    if (e.kind === "scroll") return `Scroll ${e.label.replace(/^Scroll\s+/i, "")}${appCtx} to bring more content into view.`;
    if (e.kind === "type" && e.text) return `Type "${e.text}"${appCtx}.`;
    if (e.kind === "key" && e.key) {
      const k = e.key.toLowerCase();
      if (k.includes("enter")) return `Press Enter${appCtx} to confirm.`;
      if (k.includes("tab")) return `Press Tab${appCtx} to move to the next field.`;
      if (k.includes("esc")) return `Press Escape${appCtx} to dismiss.`;
      return `Press ${e.key}${appCtx}.`;
    }
    if (e.kind === "shortcut") {
      const t = (e.label || "").toLowerCase();
      if (t.includes("c")) return `Copy selection${appCtx}.`;
      if (t.includes("v")) return `Paste${appCtx}.`;
      if (t.includes("x")) return `Cut selection${appCtx}.`;
      if (t.includes("s")) return `Save${appCtx}.`;
      if (t.includes("z")) return `Undo${appCtx}.`;
      return `Keyboard shortcut: ${e.label}${appCtx}.`;
    }
    if (e.kind === "click") return `Click${appCtx} at the highlighted element.`;
    return e.label;
  };

  // Auto-accept rules: events that don't need a question
  const shouldAutoAccept = (e: RecordedEvent): boolean => {
    if (e.kind === "scroll") return true;
    if (e.kind === "shortcut") return true;
    if (e.kind === "key") {
      const k = (e.key || "").toLowerCase();
      return ["enter", "tab", "esc", "escape", "backspace", "delete", "left", "right", "up", "down"].some((x) => k.includes(x));
    }
    return false;
  };

  // Track outstanding native prompts
  

  // Subscribe to agent events while in demo mode
  useEffect(() => {
    if (mode !== "demo") return;
    const off = agent.onEvent((e) => {
      if (e.type === "recorded_event") {
        const ev = e.event;
        // Browser-side belt-and-braces ignore filter
        if (ignoreSelf) {
          const extras = extraIgnore.split(",").map((s) => s.trim()).filter(Boolean);
          if (isOwnTabEvent(ev, extras)) return;
        }
        const auto = autoExplain(ev);
        let thumb: { url: string; w: number; h: number } | null = null;
        if (streamRef.current && videoRef.current?.videoWidth) {
          const isClick = ev.kind === "click" && typeof ev.x === "number" && typeof ev.y === "number";
          if (isClick) {
            const scale = videoRef.current.videoWidth / Math.max(1, window.screen.width);
            thumb = captureFrame(ev.x! * scale, ev.y! * scale);
          } else {
            thumb = captureFrame();
          }
        }
        const enriched: RecordedEvent = {
          ...ev,
          explanation: auto,
          thumbnail: thumb?.url,
          thumbW: thumb?.w,
          thumbH: thumb?.h,
        };
        setEvents((prev) => [...prev, enriched].slice(-200));
        if (!explainEach || shouldAutoAccept(ev)) return;
        setExplainQueue((q) => [...q, enriched]);
      } else if (e.type === "recording_started") {
        toast.success("Recording started — pop-ups will ask you to explain steps");
      } else if (e.type === "recording_stopped") {
        if (e.events?.length) setEvents((prev) => [...prev, ...e.events]);
      } else if (e.type === "error") {
        toast.error(e.msg);
      }
    });
    return () => { off(); };
  }, [mode, ignoreSelf, extraIgnore, explainEach]);

  // Build the ignore-pattern list sent to the agent
  const buildIgnorePatterns = (): string[] => {
    if (!ignoreSelf) return [];
    const extras = extraIgnore.split(",").map((s) => s.trim()).filter(Boolean);
    return [...DEFAULT_IGNORE_PATTERNS, ...extras];
  };

  // Push pattern updates to the agent live
  useEffect(() => {
    if (!recording || !agentConnected) return;
    try { agent.setIgnorePatterns(buildIgnorePatterns()); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ignoreSelf, extraIgnore, recording, agentConnected]);

  const startRecording = async () => {
    if (!agentConnected) {
      toast.error("Desktop Agent not connected. Open Settings → Desktop Agent first.");
      return;
    }
    try { agent.startRecording(buildIgnorePatterns()); }
    catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start recording");
      return;
    }
    setRecording(true);
    setEvents([]);
    setSeconds(0);
    startTsRef.current = Date.now();
    tickRef.current = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startTsRef.current) / 1000));
    }, 250);
  };

  // Crop the screen-frame data URL around (x,y) and return a small PNG data URL.
  const cropAround = async (dataUrl: string, x: number, y: number, w: number, h: number, boxPx = 220): Promise<string | null> => {
    try {
      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); });
      const half = boxPx / 2;
      const sx = Math.max(0, Math.min(w - boxPx, x - half));
      const sy = Math.max(0, Math.min(h - boxPx, y - half));
      const c = document.createElement("canvas");
      c.width = boxPx; c.height = boxPx;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, sx, sy, boxPx, boxPx, 0, 0, boxPx, boxPx);
      return c.toDataURL("image/jpeg", 0.75);
    } catch { return null; }
  };

  const stopRecording = async () => {
    setRecording(false);
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { agent.stopRecording(); } catch { /* ignore */ }

    // Build initial steps synchronously for instant UI feedback
    const draft: WorkflowStep[] = events.map((e, i) => {
      const type: WorkflowStep["type"] =
        e.kind === "click" ? "click" :
        e.kind === "type" ? "type" :
        e.kind === "scroll" ? "scroll" :
        e.kind === "shortcut" ? "shortcut" : "click";
      const label = e.explanation?.trim() || e.label;
      return { id: `s${i}`, type, target: e.label, description: label, confidence: 0.9 };
    });
    setSteps(draft);
    setVars([]);
    setName(`Recording ${new Date().toLocaleString()}`);
    setMode("review");

    // Vision pass: enrich click steps with element descriptions + crops
    const clickIndexes = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.kind === "click" && e.thumbnail && typeof e.x === "number" && typeof e.y === "number");
    if (clickIndexes.length === 0) return;

    setBusy(true);
    toast.info(`Analyzing ${clickIndexes.length} click target${clickIndexes.length > 1 ? "s" : ""}…`);

    const enriched = [...draft];
    for (const { e, i } of clickIndexes) {
      try {
        const res = await analyze({ data: {
          imageUrl: e.thumbnail!,
          x: e.x!,
          y: e.y!,
          appName: e.app,
          rawLabel: e.label,
        }});
        if (res.error || !res.description) continue;
        const crop = await cropAround(e.thumbnail!, e.x!, e.y!, e.thumbW ?? 1920, e.thumbH ?? 1080);
        enriched[i] = {
          ...enriched[i],
          description: res.description,
          target: res.description,
          visualTarget: {
            description: res.description,
            ocr: res.ocr ?? undefined,
            thumbnail: crop ?? undefined,
          },
        };
        // Stream updates so the user sees progress
        setSteps([...enriched]);
      } catch (err) {
        console.error("vision step failed", err);
      }
    }
    setBusy(false);
    toast.success("Vision analysis complete");
  };

  const submitExplanation = () => {
    if (!pendingEvent) return;
    const text = pendingExplain.trim();
    if (text) {
      setEvents((prev) => {
        const idx = prev.lastIndexOf(pendingEvent);
        if (idx < 0) return prev;
        const next = prev.slice();
        next[idx] = { ...pendingEvent, explanation: text };
        return next;
      });
    }
    setExplainQueue((q) => q.slice(1));
    setPendingExplain("");
  };

  const skipExplanation = () => {
    setExplainQueue((q) => q.slice(1));
    setPendingExplain("");
  };

  const generateFromPrompt = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const res = await generate({ data: { prompt } });
      if (res.error || !res.workflow) throw new Error(res.error ?? "AI failed");
      const w = res.workflow as { name: string; description?: string; steps: WorkflowStep[]; variables?: WorkflowVariable[] };
      setName(w.name);
      setDesc(w.description ?? "");
      setSteps(w.steps.map((s, i) => ({ ...s, id: `g${i}`, confidence: 0.9 + Math.random() * 0.08 })));
      setVars(w.variables ?? []);
      setMode("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!name.trim()) { toast.error("Give your workflow a name"); return; }
    setBusy(true);
    try {
      const w = await createWorkflow({ name, description: desc, steps, variables: vars });
      toast.success("Workflow saved");
      nav({ to: "/app/library/$id", params: { id: w.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  };

  if (mode === "choose") {
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Recording Studio</h1>
          <p className="mt-1 text-muted-foreground">Two ways to teach the AI a new workflow.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <button onClick={() => setMode("demo")} className="glass group rounded-2xl p-8 text-left transition-shadow hover:shadow-glow">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl shadow-glow" style={{ background: "var(--gradient-primary)" }}>
              <Mic className="h-5 w-5 text-background" />
            </div>
            <h3 className="font-display text-xl font-semibold">Watch and Learn</h3>
            <p className="mt-2 text-sm text-muted-foreground">Demonstrate the task once. EchoPilot captures clicks, typing, scroll and screen context — then extracts the logic.</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs text-primary">Start demonstration →</span>
          </button>
          <button onClick={() => setMode("describe")} className="glass group rounded-2xl p-8 text-left transition-shadow hover:shadow-glow">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-accent/40 bg-accent/10">
              <Sparkles className="h-5 w-5 text-accent" />
            </div>
            <h3 className="font-display text-xl font-semibold">Describe in plain English</h3>
            <p className="mt-2 text-sm text-muted-foreground">Tell the AI what you want to automate. It drafts the workflow, you refine and save.</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs text-accent">Describe a workflow →</span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "demo") {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <button onClick={() => setMode("choose")} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="glass rounded-2xl p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold">Demonstration Mode</h2>
              <p className="mt-1 text-sm text-muted-foreground">Recording your screen, mouse, keyboard and window context.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xl tabular-nums">{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</span>
              {!recording ? (
                <Button onClick={startRecording} className="gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
                  <Mic className="h-4 w-4" /> Start recording
                </Button>
              ) : (
                <Button onClick={stopRecording} variant="destructive" className="gap-2">
                  <MicOff className="h-4 w-4" /> Stop & analyze
                </Button>
              )}
            </div>
          </div>

          {!agentConnected && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Desktop Agent is not connected. Recording captures real mouse and keyboard input via the Python sidecar — go to <span className="font-semibold">Settings → Desktop Agent</span> and connect it first.
              </div>
            </div>
          )}

          {/* Settings strip */}
          <div className="mt-5 grid gap-3 rounded-xl border border-border/60 bg-card/40 p-4 sm:grid-cols-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-xs">Ignore EchoPilot tab</Label>
                <p className="text-[10px] text-muted-foreground">Drops events from this browser window.</p>
              </div>
              <Switch checked={ignoreSelf} onCheckedChange={setIgnoreSelf} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-xs">Explain each step</Label>
                <p className="text-[10px] text-muted-foreground">Pause after every action and ask why.</p>
              </div>
              <Switch checked={explainEach} onCheckedChange={setExplainEach} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {screenOn ? <Monitor className="h-4 w-4 text-primary" /> : <MonitorOff className="h-4 w-4 text-muted-foreground" />}
                <div>
                  <Label className="text-xs">Live screen preview</Label>
                  <p className="text-[10px] text-muted-foreground">Required to capture step thumbnails & click markers.</p>
                </div>
              </div>
              <Switch checked={screenOn} onCheckedChange={setScreenOn} />
            </div>
            {ignoreSelf && (
              <div className="sm:col-span-3">
                <Label className="text-xs">Extra ignore patterns (comma-separated, matched in app/window title)</Label>
                <Input
                  value={extraIgnore}
                  onChange={(e) => setExtraIgnore(e.target.value)}
                  placeholder="e.g. Slack, Notion, mycompany.com"
                  className="mt-1.5"
                />
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card/40 p-5">
              <div className="mb-3 flex items-center gap-2 text-xs">
                <span className={`relative inline-block h-2 w-2 rounded-full ${recording ? "bg-destructive" : "bg-muted-foreground"}`}>
                  {recording && <span className="pulse-dot text-destructive" />}
                </span>
                {recording ? (pendingEvent ? "Paused — waiting for your explanation" : "Recording — perform the task naturally") : "Idle"}
              </div>
              <div className="relative grid h-[260px] place-items-center overflow-hidden rounded-lg border border-dashed border-border/60 bg-background/40">
                {screenOn ? (
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className="h-full w-full object-contain bg-black"
                  />
                ) : recording ? (
                  <div className="text-center">
                    <Camera className="mx-auto h-10 w-10 animate-pulse text-primary" />
                    <p className="mt-3 text-sm text-muted-foreground">Vision agent is observing your screen…</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Press <span className="text-foreground">Start recording</span> when ready.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/40 p-5">
              <h3 className="mb-3 font-display text-sm font-semibold">Captured actions</h3>
              <div className="h-[260px] space-y-1.5 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {events.length === 0 && <p className="text-xs text-muted-foreground">No actions yet.</p>}
                  {events.map((e, i) => (
                    <motion.div
                      key={i + e.ts}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-2 rounded-md bg-secondary/40 px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">+{(e.ts/1000).toFixed(1)}s</span>
                      {e.thumbnail && (
                        <img
                          src={e.thumbnail}
                          alt=""
                          className="h-10 w-16 shrink-0 rounded border border-border/60 object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{e.label}</div>
                        {e.explanation && (
                          <div className="truncate text-[10px] text-primary">“{e.explanation}”</div>
                        )}
                        {(e.app || e.window) && (
                          <div className="truncate text-[10px] text-muted-foreground">
                            {e.app}{e.app && e.window ? " · " : ""}{e.window}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Floating, non-blocking explain-this-step card */}
        {pendingEvent && (
          <div className="fixed bottom-6 right-6 z-50 w-[360px] rounded-xl border border-border/60 bg-card/95 p-4 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-primary">Explain this step{explainQueue.length > 1 ? ` (${explainQueue.length} queued)` : ""}</div>
              <button onClick={skipExplanation} className="text-[11px] text-muted-foreground hover:text-foreground">Skip</button>
            </div>
            <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-[11px]">
              <div className="font-medium">{pendingEvent.label}</div>
              {(pendingEvent.app || pendingEvent.window) && (
                <div className="mt-0.5 text-muted-foreground">
                  {pendingEvent.app}{pendingEvent.app && pendingEvent.window ? " · " : ""}{pendingEvent.window}
                </div>
              )}
            </div>
            <Textarea
              autoFocus
              value={pendingExplain}
              onChange={(e) => setPendingExplain(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitExplanation(); } }}
              placeholder={pendingEvent.explanation || "Why did you do this?"}
              className="mt-2 min-h-[70px] text-xs"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={skipExplanation}>Skip</Button>
              <Button size="sm" onClick={submitExplanation} style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
                Save (⌘↵)
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "describe") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <button onClick={() => setMode("choose")} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="glass rounded-2xl p-8">
          <h2 className="font-display text-2xl font-semibold">Describe your workflow</h2>
          <p className="mt-1 text-sm text-muted-foreground">Be specific about apps, inputs and the outcome.</p>
          <Textarea
            className="mt-5 min-h-[160px] font-sans"
            placeholder={`e.g. "For each row in invoices.csv, open our CRM, create a new contact with the name, email and company, then upload the matching PDF from the /invoices folder."`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="mt-5 flex justify-end">
            <Button onClick={generateFromPrompt} disabled={busy || !prompt.trim()} className="gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate workflow
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // review
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <button onClick={() => setMode("choose")} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Start over
      </button>
      <div className="glass rounded-2xl p-8">
        <div className="flex items-center gap-2 text-xs text-success"><Sparkles className="h-3.5 w-3.5" /> AI extracted {steps.length} steps</div>
        <h2 className="mt-1 font-display text-2xl font-semibold">Review & save</h2>

        <div className="mt-6 grid gap-4">
          <div>
            <Label htmlFor="n" className="text-xs">Workflow name</Label>
            <Input id="n" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="d" className="text-xs">Description</Label>
            <Textarea id="d" value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1.5" placeholder="What does this workflow do?" />
          </div>
        </div>

        <h3 className="mt-7 mb-3 font-display text-sm font-semibold">Steps</h3>
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const Icon = ICONS[s.type] ?? MousePointer;
            return (
              <li key={s.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
                <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-secondary font-mono text-xs">{i + 1}</span>
                {s.visualTarget?.thumbnail ? (
                  <img src={s.visualTarget.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded border border-border/60 object-cover" />
                ) : (
                  <Icon className="mt-1.5 h-4 w-4 text-primary" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{s.description}</div>
                  <div className="text-[10px] text-muted-foreground">{s.type} · {s.target}</div>
                  {s.visualTarget?.ocr && (
                    <div className="mt-0.5 truncate text-[10px] text-accent">OCR: “{s.visualTarget.ocr}”</div>
                  )}
                </div>
                {typeof s.confidence === "number" && (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] text-success">{Math.round(s.confidence * 100)}%</span>
                )}
              </li>
            );
          })}
        </ol>

        {vars.length > 0 && (
          <>
            <h3 className="mt-7 mb-3 font-display text-sm font-semibold">Variables</h3>
            <div className="flex flex-wrap gap-2">
              {vars.map((v) => (
                <span key={v.name} className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">{v.name} · {v.type}</span>
              ))}
            </div>
          </>
        )}

        <div className="mt-8 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setMode("choose")}>Discard</Button>
          <Button onClick={save} disabled={busy} className="gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save workflow
          </Button>
        </div>
      </div>
    </div>
  );
}
