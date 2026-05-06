import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Shield, Bell, Cpu, Mic, Cloud } from "lucide-react";
import { AgentPanel } from "@/components/AgentPanel";

export const Route = createFileRoute("/app/settings/")({ component: SettingsPage });

function SettingsPage() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState({
    confirmDangerous: true,
    voiceCommands: false,
    cloudSync: true,
    notifications: true,
    backgroundExec: false,
  });

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("display_name").eq("id", user.id).single().then(({ data }) => {
      if (data?.display_name) setName(data.display_name);
    });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", user.id);
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Saved");
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Profile, automation safety and AI preferences.</p>
      </div>

      <section className="glass rounded-xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input value={user?.email ?? ""} disabled className="mt-1.5 opacity-60" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </section>
      <AgentPanel />

      <section className="glass rounded-xl p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">Automation safety</h2>
        <ul className="space-y-4">
          <Toggle icon={Shield} label="Approve dangerous actions" desc="Pause before file deletes, payments and irreversible operations." checked={prefs.confirmDangerous} onChange={(v) => setPrefs({ ...prefs, confirmDangerous: v })} />
          <Toggle icon={Cpu} label="Background execution" desc="Allow workflows to run minimised." checked={prefs.backgroundExec} onChange={(v) => setPrefs({ ...prefs, backgroundExec: v })} />
          <Toggle icon={Mic} label="Voice commands" desc="Trigger workflows by saying 'Hey EchoPilot'." checked={prefs.voiceCommands} onChange={(v) => setPrefs({ ...prefs, voiceCommands: v })} />
          <Toggle icon={Bell} label="Run notifications" desc="Get notified when a workflow finishes or needs attention." checked={prefs.notifications} onChange={(v) => setPrefs({ ...prefs, notifications: v })} />
          <Toggle icon={Cloud} label="Cloud sync" desc="Sync workflows across all your devices." checked={prefs.cloudSync} onChange={(v) => setPrefs({ ...prefs, cloudSync: v })} />
        </ul>
      </section>
    </div>
  );
}

function Toggle({ icon: Icon, label, desc, checked, onChange }: { icon: typeof Shield; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <li className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <div className="text-sm font-medium">{label}</div>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </li>
  );
}
