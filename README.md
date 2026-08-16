# cf_ai_job_coach

> An interview-coaching agent on Cloudflare's edge. Tell it the role you are preparing for and it
> runs the session: targeted questions, feedback on each answer, and a live record of which topics
> you have covered. State lives in a Durable Object, so the agent remembers the role and the
> coverage across the whole session.

**Live:** https://cf-ai-job-coach.alabitemitope51.workers.dev

Built in a day as a submission for a Cloudflare AI engineering application. Small on purpose, and
the one genuinely awkward part is documented below.

---

## What it does

You open the chat and say what job you are going for. From there the agent drives:

- **Role-aware questioning.** Every question and every piece of feedback is conditioned on the role
  you named, not on a generic interview script.
- **Feedback per answer.** What was strong, what was missing, how to sharpen it.
- **Live topic tracking.** A sidebar fills in as topics get covered (React hooks, system design,
  behavioural leadership, and so on), so you can see the gaps rather than guess at them.
- **Session memory.** Role and covered topics persist in Durable Object state; chat history persists
  in the Durable Object's SQLite store and survives a restart.
- **Streaming responses** over the Agents WebSocket protocol.

---

## Architecture

```
Browser (React 19 + Vite)
   │  WebSocket, Agents protocol
   ▼
routeAgentRequest()                     Cloudflare Worker, edge
   │
   ▼
JobCoachAgent  extends AIChatAgent      Durable Object (one per session)
   │
   ├── state: { jobRole, topicsCovered[], sessionProgress }
   │     └── setState() pushes to the client, sidebar re-renders via onStateUpdate
   │
   ├── SQLite-backed message history (survives restarts)
   │
   └── onChatMessage()
         ├── pass 1: AI.run(tools, stream:false)   detect + execute tool calls
         │             setJobRole / updateTopics / getProgress
         └── pass 2: AI.run(stream:true)            stream the reply
                       │
                       ▼
              Workers AI: Llama 3.3 70B Instruct (fp8-fast)
```

### Bindings

| Binding | Type | Purpose |
|---|---|---|
| `AI` | Workers AI | Llama 3.3 70B inference |
| `JOB_COACH_AGENT` | Durable Object | Per-session agent: chat history plus state |
| `ASSETS` | Static Assets | Serves the React frontend |

### Stack

Cloudflare Workers, Workers AI (Llama 3.3 70B Instruct fp8-fast), `@cloudflare/ai-chat`
(`AIChatAgent`) with `agents`, Durable Objects, React 19, TypeScript, Vite with
`@cloudflare/vite-plugin`.

---

## Technical decisions

*Chose X over Y because Z.*

- **Chose two sequential model calls over one streaming call with tools attached.**
  This is the interesting constraint in the project. Workers AI will not reliably stream *and*
  resolve tool calls in the same request. The obvious implementation, one streaming call with
  `tools` attached, produces tool calls that arrive malformed or not at all. So `onChatMessage()`
  runs pass one non-streaming with tools to detect and execute them, appends the assistant tool-call
  turn and each tool result to the message array, then runs pass two streaming with no tools to
  produce the visible reply. It costs an extra round trip before the first token. It buys tool
  calling that actually fires, which is the difference between an agent and a chatbot.

- **Chose the raw `env.AI` binding over the `workers-ai-provider` abstraction.**
  The provider layer is the tidier path and it obscured exactly the behaviour above, making it
  unclear whether tool calls were failing at the model or in the adapter. Dropping to the binding
  made the request and response shapes explicit, at the cost of hand-writing the Workers AI message
  types (`WorkersAIMessage`, `WorkersAIResponse`) that the provider would have supplied.

- **Chose Durable Object state over a database for session memory.**
  A session is one user, minutes long, holding a role string and a list of topics. A Durable Object
  already exists per session and `setState()` pushes changes to the subscribed client automatically,
  so the sidebar updates with no polling and no fetch endpoint. A database here would add a network
  hop and a schema to serve data that does not outlive the conversation.

- **Chose tool calls over parsing the model's prose for state changes.**
  `setJobRole` and `updateTopics` make the model's intent explicit and typed. Regexing "so you're
  going for a frontend role" out of generated text is quicker to write and fails silently the first
  time the model phrases it differently.

---

## Known limitations

- **No evaluation.** Coaching quality is unmeasured. There is no rubric, no scoring of the
  feedback, and no regression check that a prompt change did not make it worse.
- **The extra round trip is unconditional.** Pass one runs on every message, including messages
  that clearly need no tool. Time to first token pays for it every turn.
- **No tests.** None. A one-day build.
- **Topic tracking trusts the model.** `updateTopics` fires when the model decides a topic is
  covered, so the sidebar reflects the model's judgement rather than any objective measure.
- **Single session, no accounts.** Nothing persists across browsers and there is no way to resume
  a session later.

---

## Running it

Requires Node 18+, a Cloudflare account (free tier is fine), and `npx wrangler login`.

```bash
npm install
npm run dev      # http://localhost:5173, Workers AI proxied through your account
npm run deploy   # builds the frontend and deploys Worker + Durable Object
```

On first `npm run dev`, Wrangler may ask you to register a `workers.dev` subdomain. Follow the
link it prints; it is free and takes about ten seconds.

`PROMPTS.md` contains the system prompt and the development prompts used to build this.

---

## Author

**Temitope Alabi**, MSc Computer Science (AI), University of Lincoln
[GitHub](https://github.com/toptech5419) · [LinkedIn](https://www.linkedin.com/in/toptech5419/)
