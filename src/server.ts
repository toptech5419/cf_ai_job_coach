import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import type { StreamTextOnFinishCallback, ToolSet, UIMessage } from "ai";

export type Env = {
  AI: Ai;
  JOB_COACH_AGENT: DurableObjectNamespace;
};

export type CoachState = {
  jobRole: string;
  topicsCovered: string[];
  sessionProgress: "initial" | "role-set" | "coaching";
};

type WorkersAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

type WorkersAIResponse = {
  response?: string;
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
};

const TOOLS = [
  {
    name: "setJobRole",
    description: "Record the job role the candidate is preparing for. Call this immediately when they mention their target role.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", description: "The job role, e.g. 'Senior Frontend Engineer'" },
      },
      required: ["role"],
    },
  },
  {
    name: "updateTopics",
    description: "Record that a new interview topic has been covered in the session.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic covered, e.g. 'React hooks', 'System design'" },
      },
      required: ["topic"],
    },
  },
  {
    name: "getSessionSummary",
    description: "Return a summary of the current session progress.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

function buildSystemPrompt(state: CoachState): string {
  const lines: string[] = [
    "You are an expert job interview coach helping candidates prepare for job interviews.",
    "",
  ];

  if (state.jobRole) {
    lines.push(`The candidate is preparing for: **${state.jobRole}**`, "");
  } else {
    lines.push("Start by warmly greeting the candidate and asking what job role they are applying for.", "");
  }

  if (state.topicsCovered.length > 0) {
    lines.push(`Topics already covered this session: ${state.topicsCovered.join(", ")}`, "");
  }

  lines.push(
    "Your coaching approach:",
    "1. If no job role is set, ask what role the candidate is applying for first.",
    "2. Once you know the role, identify key interview topics for that role.",
    "3. Ask ONE focused interview question at a time.",
    "4. After each answer, give specific constructive feedback: what was strong, what was missing, how to improve.",
    "5. Vary question types: technical, behavioural (STAR format), situational, role-specific.",
    "6. Occasionally summarise progress and highlight weak areas.",
    "7. Be encouraging but honest.",
    "",
    "Tone: Professional, warm, supportive.",
    "",
    "IMPORTANT: Call setJobRole when the user mentions their target role. Call updateTopics after covering a new topic."
  );

  return lines.join("\n");
}

function getTextFromUIMessage(message: UIMessage): string {
  if (message.parts) {
    return message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

function convertToWorkersAIMessages(
  systemPrompt: string,
  messages: UIMessage[]
): WorkersAIMessage[] {
  const result: WorkersAIMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      const text = getTextFromUIMessage(msg);
      if (text) {
        result.push({ role: msg.role, content: text });
      }
    }
  }

  return result;
}

// Converts Workers AI SSE stream → plain ReadableStream of text chunks
function workersAIStreamToTextStream(stream: ReadableStream): ReadableStream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const parsed = JSON.parse(data) as { response?: string };
              if (parsed.response) {
                controller.enqueue(encoder.encode(parsed.response));
              }
            } catch {
              // skip unparseable lines
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export class JobCoachAgent extends AIChatAgent<Env, CoachState> {
  initialState: CoachState = {
    jobRole: "",
    topicsCovered: [],
    sessionProgress: "initial",
  };

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "setJobRole") {
      const role = String(args.role ?? "");
      this.setState({ ...this.state, jobRole: role, sessionProgress: "role-set" });
      return { success: true, role };
    }

    if (name === "updateTopics") {
      const topic = String(args.topic ?? "");
      if (!this.state.topicsCovered.includes(topic)) {
        this.setState({
          ...this.state,
          topicsCovered: [...this.state.topicsCovered, topic],
          sessionProgress: "coaching",
        });
      }
      return { success: true, topic };
    }

    if (name === "getSessionSummary") {
      return {
        jobRole: this.state.jobRole || "Not set",
        topicsCovered: this.state.topicsCovered,
        totalTopics: this.state.topicsCovered.length,
      };
    }

    return { error: "Unknown tool" };
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    const systemPrompt = buildSystemPrompt(this.state);
    let messages = convertToWorkersAIMessages(systemPrompt, this.messages);

    // Step 1: Non-streaming call with tools to detect and execute any tool calls
    const toolResponse = (await this.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<Ai["run"]>[0],
      {
        messages,
        tools: TOOLS as unknown as [],
        stream: false,
      }
    )) as WorkersAIResponse;

    if (toolResponse.tool_calls && toolResponse.tool_calls.length > 0) {
      // Add the assistant's tool call turn
      messages = [
        ...messages,
        {
          role: "assistant" as const,
          content: "",
          tool_calls: toolResponse.tool_calls.map((tc, i) => ({
            id: String(i),
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        },
      ];

      // Execute each tool and append result messages
      for (let i = 0; i < toolResponse.tool_calls.length; i++) {
        const tc = toolResponse.tool_calls[i];
        const result = await this.executeTool(tc.name, tc.arguments);
        messages = [
          ...messages,
          {
            role: "tool" as const,
            content: JSON.stringify(result),
            tool_call_id: String(i),
          },
        ];
      }
    }

    // Step 2: Stream the final conversational response (no tools this time)
    const stream = (await this.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as Parameters<Ai["run"]>[0],
      {
        messages,
        stream: true,
      }
    )) as ReadableStream;

    const textStream = workersAIStreamToTextStream(stream);

    return new Response(textStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await routeAgentRequest(request, env, { cors: true });
    return response ?? new Response("Not found", { status: 404 });
  },
};
