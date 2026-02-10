"use client";

import { useEffect, useRef, useState } from "react";

export default function Chat() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState<string>("");
  const [clientId, setClientId] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8000/ws/chat");
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("Connected to WebSocket");
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data);

        // Handle Handshake (Initial message containing only client_id and optional history)
        if (data.client_id && data.message === undefined && !clientIdRef.current) {
          clientIdRef.current = data.client_id;
          setClientId(data.client_id);

          // Load history if it exists
          if (data.history && Array.isArray(data.history)) {
            const historyMessages = data.history.map((msg: any) => {
              const sender = msg.client_id.split("-")[0];
              return `${sender}: ${msg.message}`;
            });
            setMessages(historyMessages);
          }
          return;
        }

        // Handle incoming JSON messages
        if (data.message) {
          const sender = data.client_id ? data.client_id.split("-")[0] : "System";
          setMessages((prev) => [...prev, `${sender}: ${data.message}`]);
        } else {
          setMessages((prev) => [...prev, event.data]);
        }
      } catch (e) {
        // Handle raw text
        setMessages((prev) => [...prev, event.data]);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    socket.onclose = () => {
      console.log("WebSocket closed");
    };

    return () => {
      socket.close();
    };
  }, []);

  const sendMessage = (): void => {
    if (!input.trim() || !clientId) return;

    const payload = {
      client_id: clientId,
      message: input,
    };

    socketRef.current?.send(JSON.stringify(payload));
    setInput("");
  };

  return (
    <main style={{ padding: 20, maxWidth: "600px", margin: "0 auto" }}>
      <h1>Chat App {clientId && <small style={{ color: "gray", fontSize: "0.5em" }}>({clientId.split("-")[0]})</small>}</h1>

      <div
        style={{
          border: "1px solid #ccc",
          height: 400,
          padding: 10,
          overflowY: "auto",
          marginBottom: 10,
          borderRadius: "8px",
          background: "#f9f9f9",
          color: "black",
        }}
      >
        {messages.map((msg, index) => (
          <div key={index} style={{ marginBottom: "5px" }}>
            {msg}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message"
          style={{ flex: 1, padding: "8px", borderRadius: "4px", border: "1px solid #ccc", color: "black" }}
        />
        <button
          onClick={sendMessage}
          disabled={!clientId}
          style={{
            padding: "8px 16px",
            background: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </div>
    </main>
  );
}

