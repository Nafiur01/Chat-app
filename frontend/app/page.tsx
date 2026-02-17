"use client";

import { useEffect, useRef, useState } from "react";
import WebRTCStream from "./components/WebRTCStream";

export default function ChatApp() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState<string>("");
  const [clientId, setClientId] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8000/ws/chat");
    socketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.client_id && !data.message) {
          setClientId(data.client_id);
          if (data.history) {
            setMessages(data.history.map((m: any) => `${m.client_id.split("-")[0]}: ${m.message}`));
          }
        } else if (data.message) {
          const message = data.message;
          const sender = data.client_id.split("-")[0];
          setMessages((prev) => [...prev, `${sender}: ${message}`]);
        }
      } catch {
        setMessages((prev) => [...prev, event.data]);
      }
    };

    return () => socket.close();
  }, []);

  const sendMessage = () => {
    if (!input.trim() || !clientId) return;
    socketRef.current?.send(JSON.stringify({ client_id: clientId, message: input }));
    setInput("");
  };

  return (
    <div className="container">
      <header>
        <h1>STREAM <small>Vanilla WebRTC Chat</small></h1>
        {clientId && <div className="badge">ID: {clientId.split("-")[0]}</div>}
      </header>

      <div className="main-layout">
        {/* Left Side: Video Section */}
        <div className="video-section">
          <WebRTCStream />
        </div>

        {/* Right Side: Chat Section */}
        <div className="chat-section">
          <div className="chat-box">
            {messages.map((msg, i) => (
              <div key={i} className="message">{msg}</div>
            ))}
          </div>
          <div className="chat-input-area">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type your message..."
            />
            <button onClick={sendMessage}>Send</button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        body {
          margin: 0;
          font-family: 'Inter', system-ui, sans-serif;
          background: #4d515aff;
          color: white;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 2rem;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }
        h1 { margin: 0; font-weight: 800; letter-spacing: -1px; }
        h1 small { color: #38bdf8; font-size: 0.5em; opacity: 0.8; }
        .badge { background: #1e293b; padding: 0.5rem 1rem; border-radius: 99px; font-size: 0.8rem; border: 1px solid #334155; }
        
        .main-layout {
          display: grid;
          grid-template-columns: 1fr 400px;
          gap: 2rem;
          flex: 1;
          min-height: 0;
        }

        .video-section { display: flex; flex-direction: column; gap: 1.5rem; min-height: 0; overflow-y: auto; padding-right: 0.5rem; }

        .chat-section { display: flex; flex-direction: column; background: #1e293b; border-radius: 1rem; border: 1px solid #334155; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        .chat-box { flex: 1; padding: 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; }
        .message { background: #334155; padding: 0.75rem 1rem; border-radius: 0.75rem; font-size: 0.95rem; align-self: flex-start; }

        .chat-input-area { padding: 1.25rem; background: #0f172a; display: flex; gap: 0.75rem; border-top: 1px solid #334155; }
        input { flex: 1; background: #1e293b; border: 1px solid #334155; padding: 0.75rem 1rem; border-radius: 0.5rem; color: white; outline: none; }
        input:focus { border-color: #38bdf8; }
        button { background: #38bdf8; color: #0f172a; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: transform 0.1s; }
        button:active { transform: scale(0.95); }
      `}</style>
    </div>
  );
}


