"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Device } from "mediasoup-client";

export default function WebRTCStream() {
    const [role, setRole] = useState<"broadcaster" | "viewer" | null>(null);
    const roleRef = useRef<"broadcaster" | "viewer" | null>(null);
    useEffect(() => { roleRef.current = role; }, [role]);

    const [clientId, setClientId] = useState<string | null>(null);
    const clientIdRef = useRef<string | null>(null);
    useEffect(() => { clientIdRef.current = clientId; }, [clientId]);

    const [viewerCount, setViewerCount] = useState(0);
    const [isLive, setIsLive] = useState(false);
    const [hlsUrl, setHlsUrl] = useState("https://iowadotsfs1.us-east-1.skyvdn.com:443/rtplive/cbtv58lb/playlist.m3u8");
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

    const socketRef = useRef<WebSocket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<any>(null);
    const recvTransportRef = useRef<any>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);

    useEffect(() => {
        if (!socketRef.current) {
            const socket = new WebSocket("ws://localhost:8000/ws/stream");
            socketRef.current = socket;

            socket.onmessage = async (event) => {
                const data = JSON.parse(event.data);
                console.log("Socket message received:", data.type || "init");

                switch (data.type) {
                    case "viewer_count":
                        setViewerCount(data.count);
                        break;

                    case "transport-created":
                        handleTransportCreated(data.params);
                        break;

                    case "hls-url":
                        console.log("HLS stream available at:", data.url);
                        setHlsUrl(`http://localhost:5000${data.url}`);
                        break;

                    case "producer-list":
                        if (roleRef.current === "viewer") {
                            handleProducerList(data.producers);
                        }
                        break;

                    case "broadcast_ended":
                        alert("Broadcaster has left.");
                        stopStream();
                        break;

                    default:
                        if (data.role) {
                            setRole(data.role);
                            setClientId(data.client_id);
                            // Load Mediasoup Device
                            const device = new Device();
                            await device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
                            deviceRef.current = device;

                            if (data.role === "viewer") {
                                socket.send(JSON.stringify({ type: "request-producers" }));
                            }
                        }
                        break;
                }
            };

            socket.onclose = () => {
                console.log("Stream socket closed");
                socketRef.current = null;
            };
        }
    }, []);

    const stopStream = () => {
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();
        setIsLive(false);
        setRemoteStream(null);
    };

    const handleTransportCreated = async (params: any) => {
        const device = deviceRef.current;
        if (!device) return;

        if (roleRef.current === "broadcaster") {
            const transport = device.createSendTransport(params);
            sendTransportRef.current = transport;

            transport.on("connect", ({ dtlsParameters }, callback, errback) => {
                socketRef.current?.send(JSON.stringify({
                    type: "connect-transport",
                    transportId: transport.id,
                    dtlsParameters
                }));

                if (socketRef.current) {
                    socketRef.current.onmessage = (event) => {
                        const data = JSON.parse(event.data);
                        if (data.type === "transport-connected") {
                            callback();
                            console.log("Transport connected");
                        }
                    }
                }


                // callback();
            });

            transport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
                socketRef.current?.send(JSON.stringify({
                    type: "produce",
                    transportId: transport.id,
                    kind,
                    rtpParameters
                }));

                // Wait for 'produced' message from server
                const onMessage = (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.type === "produced" && data.kind === kind) {
                        callback({ id: data.id });
                        socketRef.current?.removeEventListener("message", onMessage);
                    }
                };
                socketRef.current?.addEventListener("message", onMessage);
            });

            // Start producing tracks
            if (localStreamRef.current) {
                for (const track of localStreamRef.current.getTracks()) {
                    await transport.produce({ track });
                }
            }
        } else {
            const transport = device.createRecvTransport(params);
            recvTransportRef.current = transport;

            transport.on("connect", ({ dtlsParameters }, callback, errback) => {
                socketRef.current?.send(JSON.stringify({
                    type: "connect-transport",
                    transportId: transport.id,
                    dtlsParameters
                }));
                callback();
            });
        }
    };

    const handleProducerList = async (producers: any) => {
        // For each producer, create a consumer
        socketRef.current?.send(JSON.stringify({ type: "create-transport" }));

        // Wait for transport to be created
        const onMessage = async (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            if (data.type === "transport-created") {
                socketRef.current?.removeEventListener("message", onMessage);
                // Now we have recvTransportRef.current
                for (const kind in producers) {
                    consumeProducer(producers[kind]);
                }
            }
        };
        socketRef.current?.addEventListener("message", onMessage);
    };

    const consumeProducer = async (producerId: string) => {
        const transport = recvTransportRef.current;
        const device = deviceRef.current;
        if (!transport || !device) return;

        socketRef.current?.send(JSON.stringify({
            type: "consume",
            transportId: transport.id,
            producerId,
            rtpCapabilities: device.rtpCapabilities
        }));

        const onMessage = async (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            if (data.type === "consumed" && data.producerId === producerId) {
                const consumer = await transport.consume({
                    id: data.id,
                    producerId: data.producerId,
                    kind: data.kind,
                    rtpParameters: data.rtpParameters
                });

                socketRef.current?.send(JSON.stringify({ type: "resume", consumerId: consumer.id }));

                setRemoteStream(prev => {
                    if (prev) {
                        prev.addTrack(consumer.track);
                        return new MediaStream(prev.getTracks());
                    }
                    return new MediaStream([consumer.track]);
                });
                setIsLive(true);
                socketRef.current?.removeEventListener("message", onMessage);
            }
        };
        socketRef.current?.addEventListener("message", onMessage);
    };

    const startBroadcast = async () => {
        const video = localVideoRef.current;
        if (!video) return;

        try {
            if (Hls.isSupported()) {
                const hls = new Hls({
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 5,
                    maxLiveSyncPlaybackRate: 1.5, // Speed up playback to catch up if lagging
                    enableWorker: true
                });
                hlsRef.current = hls;
                hls.loadSource(hlsUrl);
                hls.attachMedia(video);

                await new Promise<void>((resolve, reject) => {
                    hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
                    hls.on(Hls.Events.ERROR, (_, data) => {
                        if (data.fatal) reject(new Error("HLS playback failed"));
                    });
                });
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = hlsUrl;
            }

            await video.play();

            // Capture stream from the playing video
            // @ts-ignore
            const stream = video.captureStream ? video.captureStream(30) : (video as any).mozCaptureStream ? (video as any).mozCaptureStream(30) : null;

            if (!stream) throw new Error("Video capture not supported");

            // Wait for tracks to appear
            let attempts = 0;
            while (stream.getTracks().length === 0 && attempts < 20) {
                await new Promise(r => setTimeout(r, 100));
                attempts++;
            }

            localStreamRef.current = stream;
            socketRef.current?.send(JSON.stringify({ type: "create-transport" }));
            setIsLive(true);
        } catch (err) {
            console.error("Broadcasting failed:", err);
            stopStream();
        }
    };

    const playHLS = () => {
        if (remoteVideoRef.current && hlsUrl) {
            if (Hls.isSupported()) {
                const hls = new Hls({
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 5,
                    maxLiveSyncPlaybackRate: 2.5,
                    enableWorker: true
                });
                hls.loadSource(hlsUrl);
                hls.attachMedia(remoteVideoRef.current);
                hlsRef.current = hls;
            } else if (remoteVideoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
                remoteVideoRef.current.src = hlsUrl;
            }
        }
    };

    return (
        <div className="webrtc-container">
            <div className="video-card">
                <div className="card-header">
                    <h3>
                        <span className={`status-dot ${isLive ? 'active' : ''}`}></span>
                        {role === "broadcaster" ? "Mediasoup Broadcaster" : "SFU Viewer"}
                    </h3>
                    <span className="badge">Viewers: {viewerCount}</span>
                </div>

                <div className="screen">
                    {role === "broadcaster" ? (
                        <video ref={localVideoRef} autoPlay playsInline muted />
                    ) : (
                        <video ref={remoteVideoRef} autoPlay playsInline />
                    )}
                    {!isLive && role === "viewer" && !hlsUrl && (
                        <div className="placeholder"><p>Waiting for SFU Stream...</p></div>
                    )}
                </div>

                <div className="controls">
                    {role === "broadcaster" && !isLive && (
                        <button className="btn-primary" onClick={startBroadcast}>Start SFU Broadcast</button>
                    )}
                    {role === "broadcaster" && isLive && (
                        <button className="btn-danger" onClick={stopStream}>Stop Broadcast</button>
                    )}
                    {role === "viewer" && hlsUrl && (
                        <button className="btn-primary" onClick={playHLS}>Switch to HLS (Persistent)</button>
                    )}
                </div>
            </div>

            <style jsx>{`
                .webrtc-container { width: 100%; }
                .video-card { background: #1e293b; border-radius: 1rem; padding: 1.5rem; border: 1px solid #334155; display: flex; flex-direction: column; gap: 1rem; }
                .card-header { display: flex; justify-content: space-between; align-items: center; }
                h3 { margin: 0; font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; display: flex; align-items: center; gap: 0.5rem; }
                .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
                .status-dot.active { background: #22c55e; box-shadow: 0 0 10px #22c55e; }
                .badge { background: #334155; padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.75rem; }
                .screen { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 0.5rem; overflow: hidden; position: relative; }
                video { width: 100%; height: 100%; object-fit: cover; }
                .placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #64748b; }
                button { width: 100%; padding: 0.75rem; border-radius: 0.5rem; border: none; font-weight: 600; cursor: pointer; transition: 0.2s; }
                .btn-primary { background: #38bdf8; color: #0f172a; }
                .btn-danger { background: #ef4444; color: white; }
            `}</style>
        </div>
    );
}
