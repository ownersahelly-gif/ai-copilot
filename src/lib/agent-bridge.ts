/**
 * Browser-side bridge to the EchoPilot Desktop Agent (Python sidecar).
 * Connects to ws://localhost:8765/ws, authenticates with a pairing token
 * persisted in localStorage, and exposes a small reactive store.
 */
import type { WorkflowStep } from "@/lib/workflows";

export type AgentStatus = "disconnected" | "connecting" | "auth" | "connected" | "error";

export type AgentEvent =
  | { type: "hello"; version: string; platform: string; needs_auth: boolean }
  | { type: "auth_ok" }
  | { type: "auth_failed" }
  | { type: "run_started"; runId: string; total: number }
  | { type: "step_started"; index: number; step: WorkflowStep }
  | {
      type: "step_done";
      index: number;
      ok: boolean;
      error?: string;
      screenshot?: string;
      text?: string;
    }
  | { type: "awaiting_approval"; index: number; step: WorkflowStep }
  | { type: "run_finished"; runId: string; ok: boolean }
  | { type: "screenshot"; data: string | null }
  | { type: "recording_started" }
  | { type: "recording_stopped"; events: RecordedEvent[] }
  | { type: "recorded_event"; event: RecordedEvent }
  | { type: "log"; level: "info" | "warn" | "error" | "success"; msg: string }
  | { type: "error"; msg: string }
  | { type: "pong" };

export type RecordedEvent = {
  ts: number;
  kind: "click" | "type" | "scroll" | "key" | "shortcut";
  label: string;
  x?: number;
  y?: number;
  button?: string;
  text?: string;
  key?: string;
};

const URL_KEY = "echopilot.agent.url";
const TOKEN_KEY = "echopilot.agent.token";

const hasWindow = () => typeof window !== "undefined";
export function getAgentUrl(): string {
  if (!hasWindow()) return "ws://127.0.0.1:8765/ws";
  return localStorage.getItem(URL_KEY) || "ws://127.0.0.1:8765/ws";
}
export function setAgentUrl(u: string) {
  if (hasWindow()) localStorage.setItem(URL_KEY, u);
}
export function getAgentToken(): string {
  return hasWindow() ? localStorage.getItem(TOKEN_KEY) || "" : "";
}
export function setAgentToken(t: string) {
  if (hasWindow()) localStorage.setItem(TOKEN_KEY, t);
}

function getLocalAgentBrowserBlock(url: string): string | null {
  if (!hasWindow()) return null;
  const isSecurePreview = window.location.protocol === "https:";
  const isInsecureAgent = url.trim().startsWith("ws://");
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);

  if (isSecurePreview && isInsecureAgent && isSafari) {
    return "Safari blocks ws:// local agents from this secure preview. Open the app in Chrome with the insecure-origin flag enabled, or run the agent with TLS and use wss://127.0.0.1:8765/ws.";
  }

  return null;
}

type Listener = (
  s: AgentStatus,
  info?: { version?: string; platform?: string; error?: string },
) => void;
type EventListener = (e: AgentEvent) => void;

class AgentBridge {
  private ws: WebSocket | null = null;
  status: AgentStatus = "disconnected";
  info: { version?: string; platform?: string; error?: string } = {};
  private statusListeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();

  onStatus(fn: Listener) {
    this.statusListeners.add(fn);
    fn(this.status, this.info);
    return () => this.statusListeners.delete(fn);
  }
  onEvent(fn: EventListener) {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private setStatus(s: AgentStatus, extra: Partial<typeof this.info> = {}) {
    this.status = s;
    this.info = { ...this.info, ...extra };
    this.statusListeners.forEach((fn) => fn(s, this.info));
  }

  isConnected() {
    return this.status === "connected";
  }

  connect(url = getAgentUrl(), token = getAgentToken()): Promise<void> {
    if (
      this.ws &&
      (this.status === "connected" || this.status === "connecting" || this.status === "auth")
    )
      return Promise.resolve();
    const browserBlock = getLocalAgentBrowserBlock(url);
    if (browserBlock) {
      this.setStatus("error", { error: browserBlock });
      return Promise.reject(new Error(browserBlock));
    }
    this.setStatus("connecting", { error: undefined });
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        this.setStatus("error", { error: (e as Error).message });
        reject(e);
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => {
        if (this.status !== "connected") {
          try {
            ws.close();
          } catch {
            // Ignore close errors while reporting the original connection timeout.
          }
          this.setStatus("error", { error: "connection timed out" });
          reject(new Error("timeout"));
        }
      }, 5000);

      ws.onopen = () => {
        this.setStatus("auth");
        ws.send(JSON.stringify({ type: "auth", token }));
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.status !== "error") this.setStatus("disconnected");
      };
      ws.onerror = () => {
        this.setStatus("error", {
          error: "could not reach agent — is it running on this machine?",
        });
      };
      ws.onmessage = (m) => {
        let msg: AgentEvent;
        try {
          msg = JSON.parse(m.data);
        } catch {
          return;
        }
        if (msg.type === "hello")
          this.setStatus("auth", { version: msg.version, platform: msg.platform });
        else if (msg.type === "auth_ok") {
          clearTimeout(timeout);
          this.setStatus("connected");
          resolve();
        } else if (msg.type === "auth_failed") {
          this.setStatus("error", { error: "pairing token rejected" });
          reject(new Error("auth_failed"));
          try {
            ws.close();
          } catch {
            // Ignore close errors after an auth rejection.
          }
        }
        this.eventListeners.forEach((fn) => fn(msg));
      };
    });
  }

  disconnect() {
    try {
      this.ws?.close();
    } catch {
      // Ignore close errors during manual disconnect.
    }
    this.ws = null;
    this.setStatus("disconnected");
  }

  send(msg: object) {
    if (!this.ws || this.status !== "connected") throw new Error("agent not connected");
    this.ws.send(JSON.stringify(msg));
  }

  runWorkflow(opts: {
    runId: string;
    mode: string;
    steps: WorkflowStep[];
    inputs: Record<string, unknown>;
  }) {
    this.send({ type: "run", ...opts });
  }
  pause() {
    this.send({ type: "pause" });
  }
  resume() {
    this.send({ type: "resume" });
  }
  cancel() {
    this.send({ type: "cancel" });
  }
  approveStep(runId: string, approve: boolean) {
    this.send({ type: "step_response", runId, approve });
  }
  requestScreenshot() {
    this.send({ type: "screenshot" });
  }
  startRecording() {
    this.send({ type: "start_recording" });
  }
  stopRecording() {
    this.send({ type: "stop_recording" });
  }
}

export const agent = new AgentBridge();

// React hook
import { useEffect, useState } from "react";
export function useAgentStatus() {
  const [s, setS] = useState<{ status: AgentStatus; info: typeof agent.info }>({
    status: agent.status,
    info: agent.info,
  });
  useEffect(() => {
    const off = agent.onStatus((status, info) => setS({ status, info: info ?? {} }));
    return () => {
      off();
    };
  }, []);
  return s;
}
