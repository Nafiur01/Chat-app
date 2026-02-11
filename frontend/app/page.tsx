"use client";

import { useEffect, useRef, useState } from "react";
// import components
import VideoViewer from "./components/VideoViewer";
import VideoBroadcaster from "./components/VideoBroadcaster";
import HlsPlayer from "./components/HlsPlayer";


import { StreamVideoProvider } from "./components/StreamVideoProvider";

// --- Main App ---

export default function ChatApp() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState<string>("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [streamSource, setStreamSource] = useState<string>("https://iowadotsfs1.us-east-1.skyvdn.com:443/rtplive/cbtv58lb/playlist.m3u8");

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
          const sender = data.client_id.split("-")[0];
          setMessages((prev) => [...prev, `${sender}: ${data.message}`]);
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
    <StreamVideoProvider userId={clientId}>
      <div className="container">
        <header>
          <h1>STREAM <small>Video SDK Chat</small></h1>
          {clientId && <div className="badge">ID: {clientId.split("-")[0]}</div>}
        </header>

        <div className="main-layout">
          {/* Left Side: Video Section */}
          <div className="video-section">
            <div className="viewer-main-grid">
              <VideoViewer />
              <HlsPlayer url={streamSource} />
            </div>
            <div className="broadcaster-grid">
              <VideoBroadcaster streamUrl={streamSource} />
              <div className="video-card">
                <h3>External Stream Link</h3>
                <input
                  className="url-input"
                  value={streamSource}
                  onChange={(e) => setStreamSource(e.target.value)}
                  placeholder="Video URL..."
                />
                <p style={{ fontSize: '0.7rem', color: '#64748b' }}>Use the HLS player above to view this source locally.</p>
              </div>
            </div>
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
          .viewer-main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
          .broadcaster-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

          .video-card {
             background: #1e293b;
             border-radius: 1rem;
             padding: 1.25rem;
             border: 1px solid #334155;
             display: flex;
             flex-direction: column;
             gap: 0.75rem;
             transition: transform 0.2s;
          }
          .video-card:hover { border-color: #38bdf844; }
          .video-card h3 { margin: 0; font-size: 0.8rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 0.5rem; }
          video, .screen img { width: 100%; border-radius: 0.75rem; aspect-ratio: 16/9; background: #000; object-fit: cover; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); }
          .screen { position: relative; }
          
          .quality-badge { position: absolute; top: 0.75rem; right: 0.75rem; background: rgba(15, 23, 42, 0.8); padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; color: #94a3b8; border: 1px solid #334155; backdrop-filter: blur(4px); }
          .quality-badge.hq { color: #fbbf24; border-color: #fbbf2444; }
          .badge-hq { background: #fbbf24; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 0.6rem; font-weight: 800; }

          .chat-section { display: flex; flex-direction: column; background: #1e293b; border-radius: 1rem; border: 1px solid #334155; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .chat-box { flex: 1; padding: 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; }
          .message { background: #334155; padding: 0.75rem 1rem; border-radius: 0.75rem; font-size: 0.95rem; align-self: flex-start; }

          .chat-input-area { padding: 1.25rem; background: #0f172a; display: flex; gap: 0.75rem; border-top: 1px solid #334155; }
          input { flex: 1; background: #1e293b; border: 1px solid #334155; padding: 0.75rem 1rem; border-radius: 0.5rem; color: white; outline: none; }
          input:focus { border-color: #38bdf8; }
          .url-input { margin-bottom: 0.5rem; font-size: 0.8rem; }
          button { background: #38bdf8; color: #0f172a; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: transform 0.1s; }
          button:active { transform: scale(0.95); }
          .btn-danger { background: #ef4444; color: white; }

          .pülse { width: 8px; height: 8px; background: #ef4444; border-radius: 50%; box-shadow: 0 0 0 rgba(239, 68, 68, 0.4); animation: pulse 2s infinite; }
          @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
          }
        `}</style>
      </div>
    </StreamVideoProvider>
  );
}


