import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Eye, Workflow, Sparkles, Cpu, Shield, Mic, Repeat, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "EchoPilot — Teach AI once. Automate forever." },
      { name: "description", content: "An AI coworker that learns your workflows by watching, then runs them on any app, any data, anytime." },
    ],
  }),
});

function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-mesh" />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="hidden gap-7 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#agents" className="hover:text-foreground">Agents</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/auth"><Button variant="ghost" size="sm">Sign in</Button></Link>
          <Link to="/auth"><Button size="sm" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>Get started</Button></Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-16 pb-28 md:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl text-center"
        >
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
            <Sparkles className="h-3 w-3" /> Now with multi-agent vision reasoning
          </div>
          <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight md:text-7xl">
            Teach AI once.<br />
            <span className="text-gradient">Automate forever.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            EchoPilot watches you do a task once, understands the workflow, and replays it on any new file, dataset or website — like a real AI coworker.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth">
              <Button size="lg" className="gap-2 px-7" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
                Start free <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#how">
              <Button size="lg" variant="outline" className="gap-2 px-7">
                <Eye className="h-4 w-4" /> See how it works
              </Button>
            </a>
          </div>
        </motion.div>

        {/* Hero card */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative mx-auto mt-16 max-w-5xl"
        >
          <div className="glass shadow-elevated rounded-2xl p-2">
            <div className="rounded-xl border border-border/60 bg-card/80 p-5">
              <div className="mb-4 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
                <span className="ml-3 text-xs text-muted-foreground">EchoPilot · Live Execution</span>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  { t: "Vision Agent", d: "Detected 3 input fields, 1 submit button", c: "primary" },
                  { t: "Planner Agent", d: "Step 4 / 12 — Map column 'Total' to invoice amount", c: "accent" },
                  { t: "Executor Agent", d: "Typed value · Confidence 98%", c: "success" },
                ].map((s, i) => (
                  <motion.div
                    key={s.t}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + i * 0.15 }}
                    className="rounded-lg border border-border/60 bg-secondary/30 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">{s.t}</span>
                      <span className={`relative inline-block h-2 w-2 rounded-full bg-${s.c} text-${s.c}`}><span className="pulse-dot" /></span>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.d}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      <section id="features" className="relative z-10 mx-auto max-w-7xl px-6 pb-28">
        <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">An AI that <span className="text-gradient">understands software</span></h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">No coordinates. No fragile scripts. Vision-first reasoning that adapts when buttons move and layouts change.</p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            { icon: Eye, title: "Visual desktop understanding", desc: "OCR + UI element detection finds buttons, fields, tables, popups across any app." },
            { icon: Brain, title: "Learns by demonstration", desc: "Press record, do the task once. The AI extracts the logic — what's repeated, what changes." },
            { icon: Workflow, title: "Reusable workflows", desc: "Run the same workflow on a new CSV, folder or URL. Variables map automatically." },
            { icon: Cpu, title: "Multi-agent architecture", desc: "Planner, Vision, Learner, Executor, Recovery and Memory agents work in concert." },
            { icon: Shield, title: "Smart error recovery", desc: "Layout shifts, popups, slow loads — re-detect, retry, resume. Ask only when stuck." },
            { icon: Repeat, title: "Replay modes", desc: "Auto, step-approval, assist, or background. You choose the level of trust." },
          ].map((f) => (
            <div key={f.title} className="glass group rounded-xl p-5 transition-shadow hover:shadow-glow">
              <f.icon className="h-6 w-6 text-primary transition-transform group-hover:scale-110" />
              <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="relative z-10 mx-auto max-w-7xl px-6 pb-28">
        <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">How it works</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            { n: "01", icon: Mic, title: "Record once", desc: "Hit Watch and Learn. EchoPilot captures clicks, typing, scrolls and screen context." },
            { n: "02", icon: Brain, title: "AI extracts the logic", desc: "It identifies what's repeated, what's variable, and how data flows between apps." },
            { n: "03", icon: Zap, title: "Run anywhere, anytime", desc: "Save with a name. Replay on new files, datasets or URLs — even on a schedule." },
          ].map((s) => (
            <div key={s.n} className="glass relative rounded-xl p-6">
              <div className="mb-3 font-mono text-xs text-primary">{s.n}</div>
              <s.icon className="h-6 w-6 text-foreground" />
              <h3 className="mt-3 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="agents" className="relative z-10 mx-auto max-w-7xl px-6 pb-32">
        <div className="glass overflow-hidden rounded-2xl p-10 md:p-14">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">A team of AI specialists, working in lockstep.</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">Six agents collaborate behind every workflow — so the system reasons, recovers and improves with use.</p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Planner","Vision","Learner","Executor","Recovery","Memory"].map((a) => (
              <span key={a} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary">{a} Agent</span>
            ))}
          </div>
          <div className="mt-10">
            <Link to="/auth">
              <Button size="lg" className="gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
                Build your first workflow <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 text-xs text-muted-foreground">
          <Logo size={20} />
          <span>© {new Date().getFullYear()} EchoPilot. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
