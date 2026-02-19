"use client";
import Hls from 'hls.js';
import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [streamUrl, setStreamUrl] = useState("./../big_chungus.mp4");
  const [hlsUrl, setHlsUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewers, setViewers] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const startStream = async () => {
    setLoading(true);
    setError("");

    try {
      // Connect to WebSocket
      const ws = new WebSocket("ws://127.0.0.1:8000/ws");
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected, sending URL...");
        ws.send(streamUrl);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "ready") {
          console.log("Stream is ready at:", data.url);
          setHlsUrl(data.url);
          setLoading(false);
        } else if (data.type === "error") {
          setError(data.message);
          setLoading(false);
        }else if(data.type === "viewer_count"){
          setViewers(data.count);
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setError("Failed to connect to stream server");
        setLoading(false);
      };

      ws.onclose = () => {
        console.log("WebSocket connection closed");
        setHlsUrl("");
        setLoading(false);
      };

    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const stopStream = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setHlsUrl("");
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      console.log("Loading HLS source:", hlsUrl);
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log("HLS Manifest Parsed");
        video.play().catch(e => console.error("Autoplay failed:", e));
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error("HLS Error:", data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log("Network error, trying to recover...");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log("Media error, trying to recover...");
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      video.play().catch(e => console.error("Autoplay failed:", e));
    }
  }, [hlsUrl]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4 font-sans dark:bg-black">
      <div className="mb-8 w-full max-w-4xl space-y-4">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Low Latency Stream</h1>
        <div className="flex gap-2">
          <input
            type="text"
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            placeholder="Enter Video URL"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
          {hlsUrl.length > 0 ?
            <button
              onClick={stopStream}
              disabled={loading}
              className="rounded-lg bg-red-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Stopping..." : "Stop Stream"}
            </button>
            : <button
              onClick={startStream}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Starting..." : "Start Stream"}
            </button>
          }
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      <div className="w-full max-w-4xl overflow-hidden rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 bg-black">
        <video
          ref={videoRef}
          controls
          autoPlay
          muted
          playsInline
          className="w-full aspect-video"
          loop
        />
      </div>
      <h1 className='flex mt-2 bg-amber-500 text-black px-2 py-1 text-xl rounded-lg'><span className='font-bold'>Viewers count:</span> {viewers}</h1>
    </div>
  );
}


