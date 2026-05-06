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

/**
 * Vision analysis of a single recorded step. Receives a screenshot (data URL
 * or https URL) of the screen at the moment the user clicked, plus optional
 * pixel coordinates of the click. Returns a short element description + the
 * text on/near the element so the executor can find it again later.
 */
export const analyzeClickTarget = createServerFn({ method: "POST" })
  .inputValidator((d: { imageUrl: string; x?: number; y?: number; appName?: string; rawLabel?: string }) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { error: "AI gateway not configured", description: null, ocr: null };

    const coordHint = (typeof data.x === "number" && typeof data.y === "number")
      ? ` The user clicked at pixel (${data.x}, ${data.y}) — a red bullseye marker has been drawn on the image at that point.`
      : "";
    const appHint = data.appName ? ` The active application is "${data.appName}".` : "";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are a UI vision analyst for an automation tool.${appHint}${coordHint}\n\n` +
                      `Identify the UI element being interacted with and respond ONLY by calling describe_target. ` +
                      `Be specific about the element's role, text label, and visual location (e.g. "the blue 'Send' button at the bottom-right of the compose window"). ` +
                      `If you can read text on or directly next to the element, include it verbatim in 'ocr'.`,
              },
              { type: "image_url", image_url: { url: data.imageUrl } },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "describe_target",
            description: "Describe the UI element the user clicked",
            parameters: {
              type: "object",
              properties: {
                description: { type: "string", description: "Human-readable, specific description of the element" },
                ocr: { type: "string", description: "Text visible on or directly next to the element (empty if none)" },
                element_type: { type: "string", description: "e.g. button, link, input, menu item, cell, tab" },
              },
              required: ["description"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "describe_target" } },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) return { error: "rate_limited", description: null, ocr: null };
      if (res.status === 402) return { error: "credits_exhausted", description: null, ocr: null };
      const t = await res.text();
      console.error("vision error", res.status, t);
      return { error: `vision_${res.status}`, description: null, ocr: null };
    }
    const json = await res.json() as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { error: "no_tool_call", description: null, ocr: null };
    try {
      const parsed = JSON.parse(args) as { description: string; ocr?: string; element_type?: string };
      return { error: null, description: parsed.description, ocr: parsed.ocr ?? null, elementType: parsed.element_type ?? null };
    } catch {
      return { error: "parse_failed", description: null, ocr: null };
    }
  });
