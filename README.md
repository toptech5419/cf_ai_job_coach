# cf_ai_job_coach — AI Job Interview Coach

An AI-powered job interview coaching agent built on Cloudflare's AI platform. Tell it what role you're applying for, and it coaches you through interview prep — asking targeted questions, giving feedback on your answers, tracking which topics have been covered, and surfacing weak spots.

## Live Demo

> **https://cf-ai-job-coach.alabitemitope51.workers.dev**

## What It Does

- **Role-aware coaching**: You describe the job you're applying for; the agent tailors every question and feedback to that role
- **Topic tracking**: A sidebar shows every interview topic covered so far (React hooks, System Design, Behavioural — Leadership, etc.)
- **Real feedback**: After each answer the agent tells you what was strong, what was missing, and how to sharpen it
- **Session memory**: Your job role and covered topics are persisted in Durable Object state — the agent remembers across the whole session
- **WebSocket streaming**: Responses stream in real-time via the Cloudflare Agents WebSocket protocol

## Architecture — The 4 Required Components

| Component | Implementation |
|---|---|
| **LLM** | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) via Workers AI |
| **Workflow / coordination** | `AIChatAgent` running on Durable Objects (`JobCoachAgent`) |
| **User input via chat** | React UI with WebSocket streaming via `@cloudflare/ai-chat` |
| **Memory / state** | `this.setState()` on the Durable Object — job role + topics persisted |

## Project Structure

```
cf_ai_job_coach/
├── src/
│   ├── server.ts      # JobCoachAgent (AIChatAgent) — LLM, tools, state
│   ├── app.tsx        # React chat UI with sidebar
│   └── client.tsx     # React entry point
├── wrangler.jsonc     # Cloudflare Worker + Durable Object config
├── vite.config.ts     # Vite + Cloudflare plugin
├── tsconfig.json
├── package.json
├── index.html
├── README.md
└── PROMPTS.md
```

## Running Locally

### Prerequisites

- Node.js 18+
- A Cloudflare account (free tier works)
- `wrangler` authenticated: `npx wrangler login`

### Install & Dev

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.
Workers AI calls are proxied through your Cloudflare account — no local mock needed.

> **Note**: The first time you run `npm run dev`, Wrangler may ask you to register a `workers.dev` subdomain. Visit the link it prints and create one (free, takes ~10 seconds).

### Deploy to Production

```bash
npm run deploy
```

This builds the React frontend with Vite and deploys the Worker + Durable Object to Cloudflare. The command prints your deployed URL when done.

## Tech Stack

- **Runtime**: Cloudflare Workers (edge, global)
- **AI**: Workers AI — Llama 3.3 70B Instruct (fp8 fast variant)
- **Agents SDK**: `@cloudflare/ai-chat` (`AIChatAgent`) + `agents`
- **State**: Durable Objects with SQLite-backed message history + `setState`
- **Frontend**: React 19, TypeScript, Vite with `@cloudflare/vite-plugin`
- **AI SDK**: `ai` v6 + `workers-ai-provider` v3

## How the Agent Works

1. On first message, the system prompt instructs the agent to ask for the target role
2. Once the user mentions their role, the agent calls `setJobRole` tool → stored in Durable Object state
3. The agent asks targeted questions; after covering a topic it calls `updateTopics` → appended to state
4. The React sidebar subscribes to state updates via `onStateUpdate` and renders topics live
5. All chat history is persisted in the Durable Object's SQLite store and survives restarts

## Environment Bindings (wrangler.jsonc)

| Binding | Type | Purpose |
|---|---|---|
| `AI` | Workers AI | Llama 3.3 70B inference |
| `JOB_COACH` | Durable Object | Agent instance with chat + state storage |
| `ASSETS` | Static Assets | Serves the React frontend |
