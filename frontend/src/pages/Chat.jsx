import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar.jsx";

const SUGGESTIONS = [
  "Senior product designer roles in NL that don't need Dutch",
  "Remote UX jobs across Europe that match my CV",
  "Which companies hire product managers in Belgium?",
];

export default function Chat() {
  const [messages, setMessages] = useState([]); // { role, content, jobs? }
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const endRef = useRef();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    // Backend only uses the last 4 turns — cap the payload to match.
    const history = messages.slice(-4).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/search/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setMessages((m) => [...m, { role: "assistant", content: data.answer, jobs: data.jobs || [] }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Navbar />
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Ask your job market</h1>
        </div>
        <p className="analyze-hint">
          Ask in plain language — answers are grounded in the jobs we've collected (and your CV, if uploaded).
        </p>

        <div className="chat-log">
          {messages.length === 0 && !loading && (
            <div className="chat-empty">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat-suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="chat-bubble">{m.content}</div>
              {m.jobs?.length > 0 && (
                <div className="chat-refs">
                  {m.jobs.map((j) => (
                    <Link key={j.id} to={`/jobs/${j.id}`} className="chat-ref">
                      {j.title} — {j.company}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="chat-msg assistant">
              <div className="chat-bubble">Thinking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="chat-input-bar">
          <input
            className="analyze-title"
            placeholder="Ask about the job market…"
            aria-label="Ask about the job market"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          />
          <button className="apply-btn" onClick={() => send()} disabled={loading || !input.trim()}>
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
