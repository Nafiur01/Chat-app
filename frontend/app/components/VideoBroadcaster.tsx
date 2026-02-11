"use client";

import { useRef, useState, useEffect } from "react";
import Hls from "hls.js";
import {
    useStreamVideoClient,
    Call,
    StreamCall,
    ParticipantView,
    useCallStateHooks,
} from "@stream-io/video-react-sdk";

interface Props {
    streamUrl?: string;
}

// Sub-component to ensure we use hooks within a StreamCall context
const BroadcastPreview = () => {
    const { useLocalParticipant } = useCallStateHooks();
    const localParticipant = useLocalParticipant();

    if (!localParticipant) return (
        <div className="placeholder">
            <div className="loader-container">
                <div className="loader"></div>
                <p>Syncing Participant...</p>
            </div>
        </div>
    );

    return <ParticipantView participant={localParticipant} />;
};

export default function VideoBroadcaster({ streamUrl }: Props) {
    const client = useStreamVideoClient();
    const videoRef = useRef<HTMLVideoElement>(null);
    const callRef = useRef<Call | null>(null);
    const hlsRef = useRef<Hls | null>(null);

    const [isLive, setIsLive] = useState(false);
    const [loading, setLoading] = useState(false);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanup();
        };
    }, []);

    const cleanup = async () => {
        if (callRef.current) {
            const call = callRef.current;
            try {
                await call.stopLive();
            } catch (e) {
                console.warn("Failed to stop live session:", e);
            }
            try {
                await call.leave();
            } catch (e) {
                console.warn("Failed to leave call:", e);
            }
            callRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.src = "";
            videoRef.current.load();
        }
    };

    if (!client) {
        return (
            <div className="video-card">
                <h3>Connecting to Stream...</h3>
            </div>
        );
    }

    const startBroadcast = async () => {
        if (!streamUrl) {
            alert("Please provide a valid HLS stream URL.");
            return;
        }

        try {
            setLoading(true);

            // Create call
            const call = client.call("livestream", "default-stream");
            callRef.current = call;

            // Join WITHOUT automatic device capture to avoid permission prompts
            // This is the CRITICAL fix for the "Permission denied" error
            await call.join({
                create: true,
                // @ts-ignore
                audio: false,
                // @ts-ignore
                video: false,
            });

            // Explicitly disable just in case dashboard settings try to turn them on
            await call.camera.disable();
            await call.microphone.disable();

            const video = videoRef.current!;
            video.muted = true;
            video.playsInline = true;
            video.crossOrigin = "anonymous";

            // ---- Setup HLS ----
            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                });
                hlsRef.current = hls;

                hls.loadSource(streamUrl);
                hls.attachMedia(video);

                await new Promise<void>((resolve, reject) => {
                    hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
                    hls.on(Hls.Events.ERROR, (_, data) => {
                        if (data.fatal) reject(new Error("HLS Loading Error"));
                    });
                    setTimeout(() => reject(new Error("HLS Timeout")), 10000);
                });
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = streamUrl;
            } else {
                throw new Error("HLS not supported in this browser.");
            }

            // Wait until metadata ready
            await new Promise<void>((resolve) => {
                if (video.readyState >= 1) resolve();
                video.onloadedmetadata = () => resolve();
            });

            await video.play();

            // ---- Capture stream from video ----
            // @ts-ignore
            const mediaStream = video.captureStream ? video.captureStream() : (video as any).mozCaptureStream ? (video as any).mozCaptureStream() : null;

            if (!mediaStream) {
                throw new Error("captureStream not supported in this browser.");
            }

            // Publish custom track to Stream using the official publish method
            // 2 is TrackType.VIDEO
            await call.publish(mediaStream, 2 as any);

            await call.goLive();

            setIsLive(true);
        } catch (err) {
            console.error("Broadcast failed:", err);
            alert("Failed to start broadcast. Check console for details.");
            await cleanup();
        } finally {
            setLoading(false);
        }
    };

    const stopBroadcast = async () => {
        setLoading(true);
        await cleanup();
        setIsLive(false);
        setLoading(false);
    };

    return (
        <div className="video-card">
            <div className="card-header">
                <h3>
                    <span className={`status-dot ${isLive ? 'live' : ''}`}></span>
                    HLS Broadcaster
                </h3>
                {isLive && <span className="live-tag">LIVE</span>}
            </div>

            <div className="screen">
                {isLive && callRef.current ? (
                    <StreamCall call={callRef.current}>
                        <BroadcastPreview />
                    </StreamCall>
                ) : (
                    <div className="placeholder">
                        {loading ? (
                            <div className="loader-container">
                                <div className="loader"></div>
                                <p>Establishing Stream...</p>
                            </div>
                        ) : (
                            <div className="standby-text">
                                <p>Stream Standby</p>
                                <span>Enter a URL and click Go Live</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <video
                ref={videoRef}
                style={{ display: "none" }}
            />

            <div className="controls">
                {!isLive ? (
                    <button className="btn-primary" onClick={startBroadcast} disabled={loading}>
                        {loading ? "Connecting..." : "Go Live"}
                    </button>
                ) : (
                    <button className="btn-danger" onClick={stopBroadcast} disabled={loading}>
                        Stop Broadcast
                    </button>
                )}
            </div>

            <style jsx>{`
                .video-card {
                    padding: 1.5rem;
                    background: #1e293b;
                    border-radius: 1.25rem;
                    border: 1px solid #334155;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
                }
                .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
                h3 { margin: 0; font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 0.75rem; }
                .status-dot { width: 8px; height: 8px; background: #64748b; border-radius: 50%; }
                .status-dot.live { background: #ef4444; box-shadow: 0 0 10px #ef4444; animation: pulse 2s infinite; }
                @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
                .live-tag { background: #ef4444; color: white; font-size: 0.7rem; font-weight: 800; padding: 0.2rem 0.5rem; border-radius: 4px; }
                .screen { width: 100%; aspect-ratio: 16/9; background: #0f172a; border-radius: 1rem; overflow: hidden; position: relative; }
                .placeholder { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #64748b; text-align: center; }
                .standby-text p { font-size: 1.2rem; font-weight: 600; margin: 0; color: #94a3b8; }
                .standby-text span { font-size: 0.8rem; opacity: 0.6; }
                .loader-container { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
                .loader { width: 40px; height: 40px; border: 3px solid #334155; border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite; }
                @keyframes spin { to { transform: rotate(360deg); } }
                .controls { margin-top: 1.25rem; }
                button { width: 100%; padding: 0.75rem; border-radius: 0.75rem; border: none; font-weight: 600; cursor: pointer; transition: all 0.2s; }
                .btn-primary { background: #38bdf8; color: #0f172a; }
                .btn-primary:hover { background: #7dd3fc; transform: translateY(-1px); }
                .btn-primary:disabled { background: #1e293b; color: #64748b; cursor: not-allowed; border: 1px solid #334155; }
                .btn-danger { background: #ef4444; color: white; }
                .btn-danger:hover { background: #f87171; }
            `}</style>
        </div>
    );
}
