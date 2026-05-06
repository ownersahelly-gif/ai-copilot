import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Workflow = Database["public"]["Tables"]["workflows"]["Row"];
export type WorkflowRun = Database["public"]["Tables"]["workflow_runs"]["Row"];

export type VisualTarget = {
  description: string;          // "the green Save button in the top toolbar"
  thumbnail?: string;           // cropped data-URL of the element area (for visual matching)
  ocr?: string;                 // any text the model read on/near the element
};

export type WorkflowStep = {
  id: string;
  type: "click" | "type" | "scroll" | "screenshot" | "open_app" | "navigate" | "drag" | "shortcut" | "wait" | "extract";
  target: string;
  value?: string;
  description: string;
  confidence?: number;
  visualTarget?: VisualTarget;
};

export type WorkflowVariable = {
  name: string;
  type: "text" | "file" | "url" | "csv" | "folder";
  description?: string;
};

export async function listWorkflows() {
  const { data, error } = await supabase.from("workflows").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getWorkflow(id: string) {
  const { data, error } = await supabase.from("workflows").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createWorkflow(input: { name: string; description?: string; steps?: WorkflowStep[]; variables?: WorkflowVariable[]; tags?: string[] }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not authenticated");
  const { data, error } = await supabase.from("workflows").insert({
    user_id: u.user.id,
    name: input.name,
    description: input.description ?? null,
    steps: (input.steps ?? []) as never,
    variables: (input.variables ?? []) as never,
    tags: input.tags ?? [],
    status: input.steps?.length ? "ready" : "draft",
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateWorkflow(id: string, patch: Partial<Pick<Workflow, "name" | "description" | "tags" | "is_favorite" | "status" | "steps" | "variables">>) {
  const { data, error } = await supabase.from("workflows").update(patch as never).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteWorkflow(id: string) {
  const { error } = await supabase.from("workflows").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateWorkflow(id: string) {
  const w = await getWorkflow(id);
  return createWorkflow({
    name: `${w.name} (copy)`,
    description: w.description ?? undefined,
    steps: (w.steps as unknown) as WorkflowStep[],
    variables: (w.variables as unknown) as WorkflowVariable[],
    tags: w.tags,
  });
}

export async function startRun(workflowId: string, mode: "auto" | "step" | "assist" | "background", inputs: Record<string, unknown>) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not authenticated");
  const wf = await getWorkflow(workflowId);
  const steps = (wf.steps as unknown) as WorkflowStep[];
  const { data, error } = await supabase.from("workflow_runs").insert({
    user_id: u.user.id,
    workflow_id: workflowId,
    mode,
    inputs: inputs as never,
    total_steps: steps.length,
    status: "running",
    logs: [{ ts: new Date().toISOString(), level: "info", msg: "Run started" }] as never,
  }).select().single();
  if (error) throw error;
  await supabase.from("workflows").update({ run_count: wf.run_count + 1, last_run_at: new Date().toISOString() }).eq("id", workflowId);
  return data;
}

export async function listRuns(workflowId?: string) {
  let q = supabase.from("workflow_runs").select("*, workflows(name)").order("started_at", { ascending: false }).limit(50);
  if (workflowId) q = q.eq("workflow_id", workflowId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
