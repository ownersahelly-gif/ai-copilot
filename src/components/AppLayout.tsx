import { Link, Outlet, useLocation, useNavigate, redirect } from "@tanstack/react-router";
import {
  LayoutDashboard, Library, Mic, Activity, History, MessageSquareText, Settings, LogOut, Sparkles, Plus,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { motion } from "framer-motion";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const NAV: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/app/library", label: "Workflow Library", icon: Library },
  { to: "/app/studio", label: "Recording Studio", icon: Mic },
  { to: "/app/runs", label: "Live Execution", icon: Activity },
  { to: "/app/history", label: "History & Logs", icon: History },
  { to: "/app/assistant", label: "AI Assistant", icon: MessageSquareText },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  if (!loading && !user) {
    throw redirect({ to: "/auth" });
  }

  const initials = (user?.email ?? "U").slice(0, 2).toUpperCase();

  return (
    <div className="relative min-h-screen bg-background bg-mesh">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />
      <div className="relative flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border/60 glass">
          <div className="px-5 py-5">
            <Logo />
          </div>
          <div className="px-3">
            <Link to="/app/studio">
              <Button className="w-full justify-start gap-2 font-medium" style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}>
                <Plus className="h-4 w-4" /> Teach AI a Workflow
              </Button>
            </Link>
          </div>
          <nav className="mt-6 flex-1 space-y-1 px-3">
            {NAV.map(({ to, label, icon: Icon, exact }) => {
              const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                  )}
                >
                  {active && (
                    <motion.div
                      layoutId="active-pill"
                      className="absolute inset-0 -z-0 rounded-md border border-primary/30 bg-primary/10"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <Icon className={cn("relative z-10 h-4 w-4", active && "text-primary")} />
                  <span className="relative z-10">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-border/60 p-3">
            <div className="flex items-center gap-3 rounded-md p-2">
              <Avatar className="h-8 w-8 border border-border">
                <AvatarFallback className="bg-secondary text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{user?.email}</p>
                <p className="text-[10px] text-muted-foreground">Pro · 47 runs</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={async () => { await supabase.auth.signOut(); nav({ to: "/auth" }); }}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/60 glass px-4 md:px-6">
            <div className="flex items-center gap-3">
              <span className="md:hidden"><Logo size={24} /></span>
              <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="relative inline-block h-2 w-2 rounded-full bg-success text-success">
                  <span className="pulse-dot" />
                </span>
                AI Engine online
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-2 text-xs">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">2.5 Vision · GPT-5</span>
              </Button>
            </div>
          </header>
          <div className="min-w-0 flex-1 p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
