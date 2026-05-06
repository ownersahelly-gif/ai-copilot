import { useState } from "react";
import { motion } from "framer-motion";
import { Cpu, CheckCircle2, XCircle, Loader2, Link2, Link2Off, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  agent,
  useAgentStatus,
  getAgentUrl,
  getAgentToken,
  setAgentUrl,
  setAgentToken,
} from "@/lib/agent-bridge";

export function AgentPanel() {
  const { status, info } = useAgentStatus();
  const [url, setUrl] = useState(getAgentUrl());
  const [token, setToken] = useState(getAgentToken());
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setAgentUrl(url);
    setAgentToken(token);
    try {
      await agent.connect(url, token);
      toast.success("Agent connected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = () => {
    agent.disconnect();
    toast("Disconnected");
  };

  const dot =
    status === "connected"
      ? "bg-success"
      : status === "connecting" || status === "auth"
        ? "bg-warning"
        : status === "error"
          ? "bg-destructive"
          : "bg-muted-foreground";

  return (
    <section className="glass rounded-xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Cpu className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-display text-lg font-semibold">Desktop Agent</h2>
            <p className="text-xs text-muted-foreground">
              Connect EchoPilot to a Python sidecar running on your machine to execute workflows for
              real.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <motion.span
            className={`h-2 w-2 rounded-full ${dot}`}
            animate={
              status === "connecting" || status === "auth"
                ? { opacity: [0.3, 1, 0.3] }
                : { opacity: 1 }
            }
            transition={{ repeat: Infinity, duration: 1.2 }}
          />
          <span className="capitalize">{status}</span>
        </div>
      </div>

      {status === "connected" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-xs">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span>
              Agent v{info.version} on {info.platform}. Workflows will execute on this machine.
            </span>
          </div>
          <Button variant="outline" onClick={disconnect} className="gap-2">
            <Link2Off className="h-4 w-4" /> Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {status === "error" && info.error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs">
              <XCircle className="h-4 w-4 mt-0.5 text-destructive" />
              <div>
                <div className="font-medium text-destructive">{info.error}</div>
                <div className="mt-1 text-muted-foreground">
                  If you are using Safari, open the preview in Chrome first. Keep{" "}
                  <code className="rounded bg-secondary px-1">python agent.py</code> running from
                  the <code className="rounded bg-secondary px-1">python-agent/</code> folder, then
                  connect again.
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Agent WebSocket URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="ws://127.0.0.1:8765/ws"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Pairing token</Label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="printed when the agent starts"
                className="mt-1.5 font-mono text-xs"
              />
            </div>
          </div>

          <Button
            onClick={connect}
            disabled={busy || !token}
            className="gap-2"
            style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {busy ? "Connecting…" : "Connect to agent"}
          </Button>

          <details className="rounded-md border border-border/60 bg-card/40 p-3 text-xs">
            <summary className="cursor-pointer font-medium">How to install the agent</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>
                Open <code className="rounded bg-secondary px-1">python-agent/</code> in this
                project on your computer.
              </li>
              <li>
                Run:
                <pre className="mt-1 rounded bg-background/60 p-2 font-mono text-[11px]">
                  python -m venv .venv &amp;&amp; source .venv/bin/activate pip install -r
                  requirements.txt python agent.py
                </pre>
              </li>
              <li>Copy the pairing token printed in the terminal and paste it above.</li>
              <li>
                macOS: grant Terminal <em>Accessibility</em> + <em>Screen Recording</em> in System
                Settings → Privacy.
              </li>
            </ol>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 gap-1"
              onClick={() => {
                navigator.clipboard.writeText(
                  "cd python-agent && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python agent.py",
                );
                toast.success("Copied");
              }}
            >
              <Copy className="h-3 w-3" /> Copy install command
            </Button>
          </details>
        </div>
      )}
    </section>
  );
}
