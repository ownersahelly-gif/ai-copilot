import { createServerFn } from "@tanstack/react-start";

const SYSTEM = `You are EchoPilot — an AI workflow automation coworker. You help users design, debug and run desktop/browser automation workflows.

Capabilities you have access to (talk about them naturally):
- Vision-based screen understanding (OCR, UI element detection)
- Multi-agent system: Planner, Vision, Learner, Executor, Recovery, Memory
- Recording user demonstrations and converting them to reusable workflows
- Running workflows on new files, datasets, URLs

Tone: confident, concise, friendly, slightly futuristic. Use markdown. Keep replies under 180 words unless the user asks for more detail.

When a user describes a task, propose a numbered workflow plan. When they ask "how", explain step-by-step. When they ask to debug, ask one targeted clarifying question first.`;

type Msg = { role: "user" | "assistant"; content: string };

export const chatWithAI = createServerFn({ method: "POST" })
  .inputValidator((d: { messages: Msg[] }) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { reply: "AI gateway is not configured. Please enable Lovable AI.", error: true as const };
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: SYSTEM }, ...data.messages],
      }),
    });

    if (!res.ok) {
      if (res.status === 429) return { reply: "Rate limit reached. Try again in a moment.", error: true as const };
      if (res.status === 402) return { reply: "AI credits exhausted. Top up in workspace settings.", error: true as const };
      const t = await res.text();
      console.error("AI error", res.status, t);
      return { reply: "The AI service hit an error. Please try again.", error: true as const };
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = json.choices?.[0]?.message?.content ?? "No response.";
    return { reply, error: false as const };
  });

export const generateWorkflowFromPrompt = createServerFn({ method: "POST" })
  .inputValidator((d: { prompt: string }) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { error: "AI gateway not configured", workflow: null };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You produce concise automation workflows. Respond ONLY by calling the create_workflow tool." },
          { role: "user", content: data.prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "create_workflow",
            description: "Create a structured workflow",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                variables: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      type: { type: "string", enum: ["text", "file", "url", "csv", "folder"] },
                      description: { type: "string" },
                    },
                    required: ["name", "type"],
                  },
                },
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: ["click","type","scroll","screenshot","open_app","navigate","drag","shortcut","wait","extract"] },
                      target: { type: "string" },
                      value: { type: "string" },
                      description: { type: "string" },
                    },
                    required: ["type", "target", "description"],
                  },
                },
              },
              required: ["name", "steps"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_workflow" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("AI gen error", res.status, t);
      return { error: `AI error ${res.status}`, workflow: null };
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { error: "No workflow returned", workflow: null };
    try {
      return { error: null, workflow: JSON.parse(args) };
    } catch {
      return { error: "Could not parse workflow", workflow: null };
    }
  });
