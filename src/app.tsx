import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { CoachState } from "./server";
import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";

function TopicBadge({ topic }: { topic: string }) {
  return (
    <span className="topic-badge">
      <span className="topic-dot" />
      {topic}
    </span>
  );
}

function getMessageText(message: UIMessage): string {
  if (message.parts) {
    return message.parts
      .filter(
        (p): p is { type: "text"; text: string } => p.type === "text"
      )
      .map((p) => p.text)
      .join("");
  }
  return "";
}

function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = getMessageText(message);

  if (!text && message.role === "assistant") return null;

  return (
    <div className={`message ${isUser ? "message-user" : "message-assistant"}`}>
      <div className="message-avatar">{isUser ? "You" : "Coach"}</div>
      <div className="message-bubble">
        {text.split("\n").map((line: string, i: number, arr: string[]) => (
          <span key={i}>
            {line}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [coachState, setCoachState] = useState<CoachState>({
    jobRole: "",
    topicsCovered: [],
    sessionProgress: "initial",
  });

  const agent = useAgent<CoachState>({
    agent: "job-coach-agent",
    name: "session",
    onStateUpdate: (state) => setCoachState(state),
  });

  const { messages, sendMessage, status } = useAgentChat({ agent });

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const { jobRole, topicsCovered } = coachState;
  const hasStarted = messages.length > 0;

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5z"
                stroke="#f97316"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M2 17l10 5 10-5"
                stroke="#f97316"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M2 12l10 5 10-5"
                stroke="#f97316"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            <span>Job Coach AI</span>
          </div>
        </div>

        <div className="sidebar-section">
          <h3 className="sidebar-section-title">Target Role</h3>
          {jobRole ? (
            <div className="role-card">
              <div className="role-icon">🎯</div>
              <div className="role-text">{jobRole}</div>
            </div>
          ) : (
            <div className="role-placeholder">
              No role set yet. Tell the coach what you&apos;re applying for!
            </div>
          )}
        </div>

        <div className="sidebar-section">
          <h3 className="sidebar-section-title">
            Topics Covered
            {topicsCovered.length > 0 && (
              <span className="topic-count">{topicsCovered.length}</span>
            )}
          </h3>
          {topicsCovered.length > 0 ? (
            <div className="topics-list">
              {topicsCovered.map((topic) => (
                <TopicBadge key={topic} topic={topic} />
              ))}
            </div>
          ) : (
            <div className="topics-placeholder">
              Topics will appear here as you practice.
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-tip">
            <span className="tip-icon">💡</span>
            <span>
              Answer each question as you would in a real interview — the coach
              will give you specific feedback.
            </span>
          </div>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="chat-area">
        <header className="chat-header">
          <h1>Interview Prep Session</h1>
          {jobRole && (
            <span className="chat-header-role">Preparing for: {jobRole}</span>
          )}
        </header>

        <div className="messages-container">
          {!hasStarted && (
            <div className="welcome-screen">
              <div className="welcome-icon">🤝</div>
              <h2>Ready to ace your interview?</h2>
              <p>
                Your AI coach will guide you through targeted practice
                questions, give you honest feedback, and track your progress
                across key topics.
              </p>
              <p className="welcome-hint">
                Start by telling the coach what role you&apos;re interviewing for.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {isLoading && (
            <div className="message message-assistant">
              <div className="message-avatar">Coach</div>
              <div className="message-bubble typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className={`input-area ${inputFocused ? "focused" : ""}`}>
          <form onSubmit={handleSend} className="input-form">
            <textarea
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer or ask a question… (Enter to send, Shift+Enter for new line)"
              rows={3}
              disabled={isLoading}
            />
            <button
              type="submit"
              className="send-button"
              disabled={isLoading || !input.trim()}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22 2L11 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M22 2L15 22l-4-9-9-4 20-7z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
