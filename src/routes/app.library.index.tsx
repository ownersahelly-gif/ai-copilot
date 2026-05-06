import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Search, Star, Play, Copy, Trash2, MoreHorizontal, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listWorkflows, deleteWorkflow, duplicateWorkflow, updateWorkflow, type Workflow } from "@/lib/workflows";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app/library/")({ component: LibraryPage });

function LibraryPage() {
  const [items, setItems] = useState<Workflow[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "fav">("all");

  const load = () => listWorkflows().then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = items.filter((w) => {
    if (filter === "fav" && !w.is_favorite) return false;
    if (q && !w.name.toLowerCase().includes(q.toLowerCase()) && !(w.description?.toLowerCase().includes(q.toLowerCase()) ?? false)) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Workflow Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saved automations you can run anytime, on anything.</p>
        </div>
        <Link to="/app/studio"><Button className="gap-2" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}><Plus className="h-4 w-4" /> New workflow</Button></Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search workflows…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="inline-flex rounded-md border border-border/60 p-1">
          {(["all","fav"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs ${filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f === "all" ? "All" : "Favorites"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <p className="text-muted-foreground">{items.length === 0 ? "No workflows yet. Record your first one in the Recording Studio." : "No matches."}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((w, i) => (
            <motion.div
              key={w.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="glass group relative flex flex-col rounded-xl p-5 transition-shadow hover:shadow-glow"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--gradient-primary)" }}>
                  <Play className="h-4 w-4 text-background" />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={async () => { await updateWorkflow(w.id, { is_favorite: !w.is_favorite }); load(); }}
                    className={`rounded p-1.5 transition-colors ${w.is_favorite ? "text-warning" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Star className="h-4 w-4" fill={w.is_favorite ? "currentColor" : "none"} />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="rounded p-1.5 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-popover">
                      <DropdownMenuItem onClick={async () => { await duplicateWorkflow(w.id); toast.success("Duplicated"); load(); }}>
                        <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={async () => { await deleteWorkflow(w.id); toast.success("Deleted"); load(); }}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <Link to="/app/library/$id" params={{ id: w.id }} className="block">
                <h3 className="line-clamp-1 font-display text-base font-semibold group-hover:text-primary">{w.name}</h3>
                <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs text-muted-foreground">{w.description ?? "—"}</p>
              </Link>
              <div className="mt-3 flex flex-wrap gap-1">
                {w.tags.slice(0, 3).map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                    <Tag className="h-2.5 w-2.5" /> {t}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[10px] text-muted-foreground">
                <span>{w.run_count} runs</span>
                <span>{(w.steps as unknown as unknown[]).length} steps</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
