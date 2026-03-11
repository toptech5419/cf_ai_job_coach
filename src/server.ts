import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import {
  streamText,
  tool,
  convertToModelMessages,
  stepCountIs,
  type StreamTextOnFinishCallback,
  type ToolSet,
} from "ai";
import { z } from "zod";

export type Env = {
  AI: Ai;
  JOB_COACH: DurableObjectNamespace;
};

export type CoachState = {
  jobRole: string;
  topicsCovered: string[];
  sessionProgress: "initial" | "role-set" | "coaching";
};

function buildSystemPrompt(state: CoachState): string {
  const lines: string[] = [
    "You are an expert job interview coach helping candidates prepare for job interviews.",
    "",
  ];

  if (state.jobRole) {
    lines.push(`The candidate is preparing for: **${state.jobRole}**`, "");
  } else {
    lines.push(
      "Start by warmly greeting the candidate and asking what job role they are applying for.",
      ""
    );
  }

  if (state.topicsCovered.length > 0) {
    lines.push(
      `Topics already covered this session: ${state.topicsCovered.join(", ")}`,
      ""
    );
  }

  lines.push(
    "Your coaching approach:",
    "1. If no job role is set, ask what role the candidate is applying for first.",
    "2. Once you know the role, identify key interview topics (technical skills, behavioural questions, system design, domain knowledge, etc.).",
    "3. Ask ONE focused interview question at a time.",
    "4. After each answer, give specific, constructive feedback: what was strong, what was missing, how to improve.",
    "5. Vary question types: technical, behavioural (STAR format), situational, role-specific.",
    "6. Occasionally summarise progress and highlight weak areas.",
    "7. Be encouraging but honest — this is prep, not flattery.",
    "",
    "Tone: Professional, warm, supportive.",
    "",
    "IMPORTANT: After covering a new topic, call `updateTopics` to record it.",
    "When the user tells you their target role, call `setJobRole` immediately."
  );

  return lines.join("\n");
}

export class JobCoachAgent extends AIChatAgent<Env, CoachState> {
  initialState: CoachState = {
    jobRole: "",
    topicsCovered: [],
    sessionProgress: "initial",
  };

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const setJobRole = tool({
      description:
        "Record the job role the candidate is preparing for. Call this immediately when they mention their target role.",
      inputSchema: z.object({
        role: z
          .string()
          .describe(
            "The job role, e.g. 'Senior Frontend Engineer at a fintech startup'"
          ),
      }),
      execute: async ({ role }) => {
        this.setState({
          ...this.state,
          jobRole: role,
          sessionProgress: "role-set",
        });
        return { success: true, role };
      },
    });

    const updateTopics = tool({
      description: "Record that a new interview topic has been covered.",
      inputSchema: z.object({
        topic: z
          .string()
          .describe("The topic covered, e.g. 'React hooks', 'System design'"),
      }),
      execute: async ({ topic }) => {
        const existing = this.state.topicsCovered;
        if (!existing.includes(topic)) {
          this.setState({
            ...this.state,
            topicsCovered: [...existing, topic],
            sessionProgress: "coaching",
          });
        }
        return { success: true, topic };
      },
    });

    const getSessionSummary = tool({
      description: "Return the current session state for a progress summary.",
      inputSchema: z.object({}),
      execute: async () => ({
        jobRole: this.state.jobRole || "Not set",
        topicsCovered: this.state.topicsCovered,
        totalTopics: this.state.topicsCovered.length,
      }),
    });

    const modelMessages = await convertToModelMessages(this.messages);

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: buildSystemPrompt(this.state),
      messages: modelMessages,
      tools: { setJobRole, updateTopics, getSessionSummary },
      stopWhen: stepCountIs(5),
      onFinish: onFinish as Parameters<typeof streamText>[0]["onFinish"],
      abortSignal: options?.abortSignal,
    });

    return result.toTextStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await routeAgentRequest(request, env, { cors: true });
    return response ?? new Response("Not found", { status: 404 });
  },
};
