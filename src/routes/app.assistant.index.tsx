import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Loader2, Bot, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { chatWithAI } from "@/ai/ai.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/app/assistant/")({ component: Assistant });

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Automate invoice processing from a folder of PDFs",
  "How does the Vision agent handle popups?",
  "Build a CRM data-entry workflow from a CSV",
  "Schedule a workflow to run every morning",
];

function Assistant() {
  const chat = useServerFn(chatWithAI);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      const res = await chat({ data: { messages: next } });
      if (res.error) toast.error(res.reply);
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-4xl flex-col">
      <div className="mb-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">AI Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ask anything. Plan workflows. Debug runs.</p>
      </div>

      <div className="glass flex flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="grid h-full place-items-center">
              <div className="text-center">
                <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl shadow-glow" style={{ background: "var(--gradient-primary)" }}>
                  <Sparkles className="h-5 w-5 text-background" />
                </div>
                <h2 className="font-display text-xl font-semibold">How can I help?</h2>
                <p className="mt-1 text-sm text-muted-foreground">Try one of these:</p>
                <div className="mt-5 grid max-w-xl gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-lg border border-border/60 bg-card/40 p-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${m.role === "user" ? "bg-secondary" : "shadow-glow"}`}
                     style={m.role === "assistant" ? { background: "var(--gradient-primary)" } : undefined}>
                  {m.role === "user" ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4 text-background" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "border border-border/60 bg-card/60"}`}>
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {busy && (
            <div className="flex gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-full shadow-glow" style={{ background: "var(--gradient-primary)" }}>
                <Bot className="h-4 w-4 text-background" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-border/60 p-4">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Describe a workflow, ask a question, or paste an error…"
              className="min-h-[52px] resize-none"
            />
            <Button onClick={() => send()} disabled={busy || !input.trim()} className="self-end" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Powered by Lovable AI · Gemini 3 Flash</p>
        </div>
      </div>
    </div>
  );
}
