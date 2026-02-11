"use client";

import { useEffect, useRef } from "react";
import Hls from "hls.js";

const HlsPlayer = ({ url }: { url: string }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current && url) {
            if (Hls.isSupported()) {
                const hls = new Hls({
                    maxBufferLength: 30,
                    enableWorker: true,
                    lowLatencyMode: true
                });
                hls.loadSource(url);
                hls.attachMedia(videoRef.current);
                return () => hls.destroy();
            } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
                videoRef.current.src = url;
            }
        }
    }, [url]);

    return (
        <div className="video-card">
            <div className="card-header">
                <h3>
                    <span className="source-icon">📡</span>
                    Direct HQ Source
                </h3>
                <span className="hq-tag">RAW HLS</span>
            </div>

            <div className="screen hls-container">
                <video
                    ref={videoRef}
                    controls
                    autoPlay
                    muted
                    playsInline
                    className="hls-video"
                />
                <div className="quality-label">HIGH FIDELITY</div>
            </div>

            <style jsx>{`
        .video-card {
          padding: 1.5rem;
          background: #1e293b;
          border-radius: 1.25rem;
          border: 1px solid #334155;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        h3 {
          margin: 0;
          font-size: 0.85rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .source-icon {
          font-size: 1rem;
          filter: drop-shadow(0 0 5px #38bdf844);
        }

        .hq-tag {
          background: rgba(56, 189, 248, 0.1);
          color: #38bdf8;
          font-size: 0.65rem;
          font-weight: 800;
          padding: 0.2rem 0.5rem;
          border-radius: 4px;
          border: 1px solid #38bdf844;
          letter-spacing: 0.1em;
        }

        .screen {
          width: 100%;
          aspect-ratio: 16/9;
          background: #000;
          border-radius: 1rem;
          overflow: hidden;
          position: relative;
          box-shadow: inset 0 0 40px rgba(0,0,0,0.5);
        }

        .hls-video {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .quality-label {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(4px);
          color: #fff;
          font-size: 0.55rem;
          font-weight: 700;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.1);
          pointer-events: none;
        }

        :global(.video-card h3) {
           color: #64748b;
        }
      `}</style>
        </div>
    );
};

export default HlsPlayer;
