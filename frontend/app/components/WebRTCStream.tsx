"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export default function WebRTCStream() {
    const [role, setRole] = useState<"broadcaster" | "viewer" | null>(null);
    const roleRef = useRef<"broadcaster" | "viewer" | null>(null);
    useEffect(() => { roleRef.current = role; }, [role]);
    const [clientId, setClientId] = useState<string | null>(null);
    const clientIdRef = useRef<string | null>(null);
    useEffect(() => { clientIdRef.current = clientId; }, [clientId]);

    const [viewerCount, setViewerCount] = useState(0);
    const [isLive, setIsLive] = useState(false);
    const isLiveRef = useRef(false);
    useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
    const [hlsUrl, setHlsUrl] = useState("https://iowadotsfs1.us-east-1.skyvdn.com:443/rtplive/cbtv58lb/playlist.m3u8");
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

    const socketRef = useRef<WebSocket | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});
    const candidateQueues = useRef<{ [key: string]: RTCIceCandidateInit[] }>({});
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);

    const iceServers = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
        ],
    };

    useEffect(() => {
        if (!socketRef.current) {
            const socket = new WebSocket("ws://localhost:8000/ws/stream");
            socketRef.current = socket;

            socket.onopen = () => {
                console.log("[HMR] connected - Stream Socket");
            };

            socket.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                console.log("Socket message received:", data.type || "role_assignment");

                switch (data.type) {
                    case "viewer_count":
                        setViewerCount(data.count);
                        break;

                    case "new-viewer":
                        if (roleRef.current === "broadcaster") {
                            handleNewViewer(data.viewer_id);
                        }
                        break;

                    case "offer":
                        if (roleRef.current === "viewer") {
                            handleOffer(data.offer, data.from);
                        }
                        break;

                    case "answer":
                        if (roleRef.current === "broadcaster") {
                            handleAnswer(data.answer, data.from);
                        }
                        break;

                    case "candidate":
                        handleCandidate(data.candidate, data.from);
                        break;

                    case "viewer-list":
                        if (roleRef.current === "broadcaster" && data.viewers) {
                            data.viewers.forEach((viewerId: string) => {
                                handleNewViewer(viewerId);
                            });
                        }
                        break;

                    case "broadcast_ended":
                        if (roleRef.current === "viewer") {
                            alert("Broadcaster has left.");
                            setIsLive(false);
                            setRemoteStream(null);
                        }
                        break;

                    default:
                        if (data.role) {
                            console.log("Setting role:", data.role);
                            setRole(data.role);
                            setClientId(data.client_id);
                        }
                        break;
                }
            };

            socket.onclose = () => {
                console.log("Stream socket closed");
                socketRef.current = null;
            };
        }

        return () => {
            // Only close and stop on unmount, not when role changes
        };
    }, [role]);

    // Separate cleanup for component unmount
    useEffect(() => {
        return () => {
            socketRef.current?.close();
            stopStream();
        };
    }, []);

    // Use a separate effect to sync the remote stream to the video element
    useEffect(() => {
        if (remoteVideoRef.current && remoteStream) {
            console.log("Attaching remote stream to video element. Tracks:", remoteStream.getTracks().length);
            remoteVideoRef.current.srcObject = remoteStream;
            remoteVideoRef.current.play().catch(err => console.error("Error playing remote video:", err));
        }
    }, [remoteStream]);

    const stopStream = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
            localVideoRef.current.src = "";
        }
        Object.values(peerConnections.current).forEach(pc => pc.close());
        peerConnections.current = {};
        setIsLive(false);
        setRemoteStream(null);
    };

    const startBroadcast = async () => {
        const video = localVideoRef.current;
        if (!video) return;

        try {
            // Setup HLS
            if (Hls.isSupported()) {
                const hls = new Hls();
                hlsRef.current = hls;
                hls.loadSource(hlsUrl);
                hls.attachMedia(video);

                await new Promise<void>((resolve, reject) => {
                    hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
                    hls.on(Hls.Events.ERROR, (_, data) => {
                        console.error("HLS Error:", data);
                        if (data.fatal) reject(new Error("HLS Error"));
                    });
                });
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = hlsUrl;
            } else {
                throw new Error("HLS not supported");
            }

            await video.play();
            console.log("Video playing, waiting for frames and readyState. Current readyState:", video.readyState);

            // Wait for video to have enough data and actual dimensions
            if (video.readyState < 3 || video.videoWidth === 0) {
                await new Promise((resolve) => {
                    const checkState = () => {
                        if (video.readyState >= 3 && video.videoWidth > 0) resolve(null);
                        else setTimeout(checkState, 200);
                    };
                    checkState();
                });
            }

            // Extra delay for HLS to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log(`Video ready: ${video.videoWidth}x${video.videoHeight}, readyState: ${video.readyState}`);

            // Capture stream from video element with fixed frame rate
            // @ts-ignore
            const stream = video.captureStream ? video.captureStream(30) : (video as any).mozCaptureStream ? (video as any).mozCaptureStream(30) : null;

            if (!stream) {
                throw new Error("captureStream not supported");
            }

            // Wait a moment for tracks to be added and become "live"
            let attempts = 0;
            while (stream.getTracks().length === 0 && attempts < 20) {
                console.log("Waiting for tracks...");
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            console.log("Captured stream tracks:", stream.getTracks().map((t: MediaStreamTrack) => `${t.kind} (${t.readyState})`));

            localStreamRef.current = stream;
            setIsLive(true);
            socketRef.current?.send(JSON.stringify({ type: "request-viewers" }));
        } catch (err) {
            console.error("Error starting HLS broadcast:", err);
            alert("Could not start HLS broadcast.");
            stopStream();
        }
    };

    const handleNewViewer = async (viewerId: string) => {
        console.log("Preparing to send offer to viewer:", viewerId);
        const pc = new RTCPeerConnection(iceServers);
        peerConnections.current[viewerId] = pc;
        candidateQueues.current[viewerId] = [];

        if (localStreamRef.current) {
            console.log("Broadcaster adding tracks to PC:", localStreamRef.current.getTracks().length);
            localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current!);
            });
        } else {
            console.warn("No local stream available when handling new viewer");
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socketRef.current?.send(JSON.stringify({
                    type: "candidate",
                    candidate: event.candidate,
                    to: viewerId,
                    from: clientIdRef.current
                }));
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socketRef.current?.send(JSON.stringify({
            type: "offer",
            offer: offer,
            to: viewerId,
            from: clientIdRef.current
        }));
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit, broadcasterId: string) => {
        console.log("Viewer handling offer from broadcaster:", broadcasterId);
        const pc = new RTCPeerConnection(iceServers);
        peerConnections.current[broadcasterId] = pc;
        candidateQueues.current[broadcasterId] = [];

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socketRef.current?.send(JSON.stringify({
                    type: "candidate",
                    candidate: event.candidate,
                    to: broadcasterId,
                    from: clientIdRef.current
                }));
            }
        };

        pc.ontrack = (event) => {
            console.log("Viewer received track:", event.track.kind, "Streams:", event.streams.length);
            if (event.streams && event.streams[0]) {
                setRemoteStream(event.streams[0]);
            } else {
                setRemoteStream(prev => {
                    if (prev) {
                        if (!prev.getTracks().find(t => t.id === event.track.id)) {
                            prev.addTrack(event.track);
                        }
                        return prev;
                    } else {
                        return new MediaStream([event.track]);
                    }
                });
            }
            setIsLive(true);
        };

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            console.log("Remote description set for broadcaster:", broadcasterId);

            // Process queued candidates
            const queue = candidateQueues.current[broadcasterId];
            while (queue && queue.length > 0) {
                const cand = queue.shift();
                if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socketRef.current?.send(JSON.stringify({
                type: "answer",
                answer: answer,
                to: broadcasterId,
                from: clientIdRef.current
            }));
        } catch (err) {
            console.error("Error in handleOffer:", err);
        }
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit, viewerId: string) => {
        console.log("Broadcaster handling answer from viewer:", viewerId);
        const pc = peerConnections.current[viewerId];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));

            const queue = candidateQueues.current[viewerId];
            while (queue && queue.length > 0) {
                const cand = queue.shift();
                if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
            }
        }
    };

    const handleCandidate = async (candidate: RTCIceCandidateInit, fromId: string) => {
        const pc = peerConnections.current[fromId];
        if (pc) {
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                if (!candidateQueues.current[fromId]) candidateQueues.current[fromId] = [];
                candidateQueues.current[fromId].push(candidate);
            }
        }
    };

    return (
        <div className="webrtc-container">
            <div className="video-card">
                <div className="card-header">
                    <h3>
                        <span className={`status-dot ${isLive ? 'active' : ''}`}></span>
                        {role === "broadcaster" ? "You are Broadcaster" : "WebRTC Viewer"}
                    </h3>
                    <span className="badge">Viewers: {viewerCount}</span>
                </div>

                <div className="screen">
                    {role === "broadcaster" ? (
                        <video ref={localVideoRef} autoPlay playsInline muted crossOrigin="anonymous" />
                    ) : (
                        <video ref={remoteVideoRef} autoPlay playsInline muted />
                    )}

                    {!isLive && role === "viewer" && (
                        <div className="placeholder">
                            <p>Waiting for broadcast...</p>
                        </div>
                    )}
                </div>

                <div className="controls">
                    {role === "broadcaster" && (
                        <div className="hls-input-group">
                            <input
                                type="text"
                                value={hlsUrl}
                                onChange={(e) => setHlsUrl(e.target.value)}
                                placeholder="HLS Stream URL"
                                disabled={isLive}
                                className="hls-url-input"
                            />
                            {!isLive ? (
                                <button className="btn-primary" onClick={startBroadcast}>Go Live (HLS)</button>
                            ) : (
                                <button className="btn-danger" onClick={stopStream}>Stop Broadcast</button>
                            )}
                        </div>
                    )}
                    {role === "viewer" && (
                        <p className="status-text">{isLive ? "Watching Live" : "Disconnected"}</p>
                    )}
                </div>
            </div>

            <style jsx>{`
                .webrtc-container { width: 100%; }
                .video-card {
                    background: #1e293b;
                    border-radius: 1rem;
                    padding: 1.5rem;
                    border: 1px solid #334155;
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }
                .card-header { display: flex; justify-content: space-between; align-items: center; }
                h3 { margin: 0; font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; display: flex; align-items: center; gap: 0.5rem; }
                .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
                .status-dot.active { background: #22c55e; box-shadow: 0 0 10px #22c55e; }
                .badge { background: #334155; padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.75rem; }
                .screen { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 0.5rem; overflow: hidden; position: relative; }
                video { width: 100%; height: 100%; object-fit: cover; }
                .placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #64748b; }
                .controls { margin-top: 0.5rem; }
                button { width: 100%; padding: 0.75rem; border-radius: 0.5rem; border: none; font-weight: 600; cursor: pointer; transition: 0.2s; }
                .btn-primary { background: #38bdf8; color: #0f172a; }
                .btn-primary:hover { background: #7dd3fc; }
                .btn-danger { background: #ef4444; color: white; }
                .status-text { text-align: center; color: #64748b; font-size: 0.8rem; margin: 0; }
                .hls-input-group { display: flex; flex-direction: column; gap: 0.75rem; }
                .hls-url-input {
                    background: #0f172a;
                    border: 1px solid #334155;
                    padding: 0.75rem;
                    border-radius: 0.5rem;
                    color: white;
                    font-size: 0.8rem;
                }
                .hls-url-input:disabled { opacity: 0.5; cursor: not-allowed; }
            `}</style>
        </div>
    );
}
