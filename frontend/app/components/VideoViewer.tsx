"use client";

import { useState } from "react";
import { useStreamVideoClient, Call, StreamCall, LivestreamPlayer } from "@stream-io/video-react-sdk";

const VideoViewer = () => {
    const client = useStreamVideoClient();
    const [call, setCall] = useState<Call | null>(null);
    const [isJoined, setIsJoined] = useState(false);
    const [loading, setLoading] = useState(false);

    if (!client) return (
        <div className="video-card">
            <h3>Stream Viewer</h3>
            <div className="screen placeholder-screen">Connecting to Video Service...</div>
        </div>
    );

    const joinStream = async () => {
        if (!client) return;
        setLoading(true);
        try {
            const existingCall = client.call("livestream", "default-stream");
            // Join as viewer-only without hardware requests
            await existingCall.join({
                // @ts-ignore
                audio: false,
                // @ts-ignore
                video: false
            });
            setCall(existingCall);
            setIsJoined(true);
        } catch (err) {
            console.error("Failed to join stream:", err);
            alert("The stream might not be active yet.");
        } finally {
            setLoading(false);
        }
    };

    const leaveStream = async () => {
        if (call) {
            await call.leave();
            setCall(null);
        }
        setIsJoined(false);
    };

    return (
        <div className="video-card">
            <div className="card-header">
                <h3>
                    <span className={`status-dot ${isJoined ? 'active' : ''}`}></span>
                    Server Relay Feed
                </h3>
                {isJoined && <span className="viewing-tag">VIEWING</span>}
            </div>

            <div className="screen">
                {call ? (
                    <StreamCall call={call}>
                        <LivestreamPlayer callType="livestream" callId="default-stream" />
                    </StreamCall>
                ) : (
                    <div className="placeholder-screen">
                        <div className="no-stream-icon">📡</div>
                        <p>No active relay detected</p>
                        <button
                            onClick={joinStream}
                            className="btn-primary"
                            disabled={loading}
                        >
                            {loading ? "Connecting..." : "Join Stream"}
                        </button>
                    </div>
                )}
            </div>

            {isJoined && (
                <div className="controls">
                    <button onClick={leaveStream} className="btn-danger">Disconnect Relay</button>
                </div>
            )}

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
                    font-size: 0.9rem;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                }

                .status-dot {
                    width: 8px;
                    height: 8px;
                    background: #64748b;
                    border-radius: 50%;
                }

                .status-dot.active {
                    background: #22c55e;
                    box-shadow: 0 0 10px #22c55e;
                }

                .viewing-tag {
                    background: #334155;
                    color: #38bdf8;
                    font-size: 0.7rem;
                    font-weight: 800;
                    padding: 0.2rem 0.5rem;
                    border-radius: 4px;
                    border: 1px solid #38bdf844;
                }

                .screen {
                    width: 100%;
                    aspect-ratio: 16/9;
                    background: #0f172a;
                    border-radius: 1rem;
                    overflow: hidden;
                    position: relative;
                }

                .placeholder-screen {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 1.25rem;
                    color: #64748b;
                    text-align: center;
                }

                .no-stream-icon {
                    font-size: 2.5rem;
                    opacity: 0.5;
                }

                .placeholder-screen p {
                    margin: 0;
                    font-weight: 500;
                    color: #94a3b8;
                }

                .controls {
                    margin-top: 1.25rem;
                }

                button {
                    width: 100%;
                    padding: 0.75rem;
                    border-radius: 0.75rem;
                    border: none;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .btn-primary {
                    background: #38bdf8;
                    color: #0f172a;
                    max-width: 200px;
                }

                .btn-primary:hover {
                    background: #7dd3fc;
                    transform: translateY(-1px);
                }

                .btn-primary:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .btn-danger {
                    background: rgba(239, 68, 68, 0.1);
                    color: #ef4444;
                    border: 1px solid rgba(239, 68, 68, 0.2);
                }

                .btn-danger:hover {
                    background: rgba(239, 68, 68, 0.2);
                }
            `}</style>
        </div>
    );
};

export default VideoViewer;
