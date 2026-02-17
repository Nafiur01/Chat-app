const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mediasoup = require('mediasoup');
const config = require('./config');

const { spawn } = require('child_process');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());
app.use(cors());

let worker;
const routers = new Map(); // roomId -> router
const transports = new Map(); // transportId -> transport
const producers = new Map(); // producerId -> producer
const consumers = new Map(); // consumerId -> consumer
const ffmpegProcesses = new Map(); // roomId -> process

// FFmpeg HLS Recording Logic
async function startFFmpeg(roomId, videoProducer, audioProducer, videoPort, audioPort) {
    const hlsPath = path.join(__dirname, 'hls_output', roomId);
    if (!fs.existsSync(hlsPath)) {
        fs.mkdirSync(hlsPath, { recursive: true });
    }

    // Create the SDP file that FFmpeg needs to "see" the RTP stream
    // Note: Payload types (96, 101) should match your mediasoup configuration
    const sdpContent = `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup HLS
c=IN IP4 127.0.0.1
t=0 0
m=video ${videoPort} RTP/AVP 101
a=rtpmap:101 VP8/90000
m=audio ${audioPort} RTP/AVP 96
a=rtpmap:96 opus/48000/2
`.trim();

    const sdpPath = path.join(hlsPath, 'input.sdp');
    fs.writeFileSync(sdpPath, sdpContent);

    // FFmpeg command to convert RTP to HLS
    const args = [
        '-protocol_whitelist', 'file,rtp,udp',
        '-fflags', '+genpts', // Generate missing timestamps for better sync
        '-i', sdpPath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // Ultrafast for lowest encoding latency
        '-tune', 'zerolatency',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '1',    // 1-second segments 
        '-hls_list_size', '3', // Keep only 3 segments in the playlist
        '-hls_flags', 'delete_segments',
        path.join(hlsPath, 'stream.m3u8')
    ];

    console.log(`Starting FFmpeg for room ${roomId} using SDP at ${sdpPath}`);
    const process = spawn(ffmpeg, args);

    process.stderr.on('data', (data) => {
        // Log errors only (or uncomment for full logs)
        if (data.toString().includes('Error')) {
            console.error(`FFmpeg [${roomId}] error: ${data}`);
        }
    });

    process.on('close', (code) => {
        console.log(`FFmpeg [${roomId}] stopped with code ${code}`);
        ffmpegProcesses.delete(roomId);
    });

    ffmpegProcesses.set(roomId, process);
}

// Initialize Mediasoup Worker
async function runMediasoupWorker() {
    worker = await mediasoup.createWorker(config.worker);
    worker.on('died', () => {
        console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
        setTimeout(() => process.exit(1), 2000);
    });
    console.log('mediasoup worker created [pid:%d]', worker.pid);
}

runMediasoupWorker();

// --- API Endpoints ---

// Create a Room (Router)
app.post('/create-room', async (req, res) => {
    const { roomId } = req.body;
    if (routers.has(roomId)) {
        return res.json({ routerRtpCapabilities: routers.get(roomId).rtpCapabilities });
    }

    try {
        const router = await worker.createRouter(config.router);
        routers.set(roomId, router);
        res.json({ routerRtpCapabilities: router.rtpCapabilities });
    } catch (error) {
        console.error('Create room error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create a WebRtcTransport
app.post('/create-transport', async (req, res) => {
    const { roomId } = req.body;
    const router = routers.get(roomId);
    if (!router) return res.status(404).json({ error: 'Room not found' });

    try {
        const transport = await router.createWebRtcTransport(config.webRtcTransport);
        transports.set(transport.id, transport);

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') transport.close();
        });

        res.json({
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            }
        });
    } catch (error) {
        console.error('Create transport error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Connect a Transport
app.post('/connect-transport', async (req, res) => {
    const { transportId, dtlsParameters } = req.body;
    const transport = transports.get(transportId);
    if (!transport) return res.status(404).json({ error: 'Transport not found' });

    try {
        await transport.connect({ dtlsParameters });
        res.json({ success: true });
    } catch (error) {
        console.error('Connect transport error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start Producing (Broadcasting)
app.post('/produce', async (req, res) => {
    const { roomId, transportId, kind, rtpParameters } = req.body;
    const transport = transports.get(transportId);
    if (!transport) return res.status(404).json({ error: 'Transport not found' });

    try {
        const producer = await transport.produce({ kind, rtpParameters });
        producers.set(producer.id, producer);

        producer.on('transportclose', () => {
            producer.close();
            producers.delete(producer.id);
        });

        res.json({ id: producer.id });
    } catch (error) {
        console.error('Produce error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to start GStreamer recording for a room
app.post('/start-hls', async (req, res) => {
    const { roomId } = req.body;
    const router = routers.get(roomId);
    if (!router) return res.status(404).json({ error: 'Room not found' });

    try {
        // Create PlainTransports
        const videoTransport = await router.createPlainTransport({ listenIp: '127.0.0.1', rtcpMux: true });
        const audioTransport = await router.createPlainTransport({ listenIp: '127.0.0.1', rtcpMux: true });

        const videoPort = 12000;
        const audioPort = 13000;

        await videoTransport.connect({ ip: '127.0.0.1', port: videoPort });
        await audioTransport.connect({ ip: '127.0.0.1', port: audioPort });

        const roomProducers = Array.from(producers.values());
        const videoProducer = roomProducers.find(p => p.kind === 'video' && !p.closed);
        const audioProducer = roomProducers.find(p => p.kind === 'audio' && !p.closed);

        if (videoProducer) await videoTransport.consume({ producerId: videoProducer.id, rtpCapabilities: router.rtpCapabilities });
        if (audioProducer) await audioTransport.consume({ producerId: audioProducer.id, rtpCapabilities: router.rtpCapabilities });

        startFFmpeg(roomId, videoProducer, audioProducer, videoPort, audioPort);

        res.json({ success: true, url: `/hls/${roomId}/stream.m3u8` });
    } catch (error) {
        console.error('HLS Start error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start Consuming (Viewing)
app.post('/consume', async (req, res) => {
    const { roomId, transportId, producerId, rtpCapabilities } = req.body;
    const router = routers.get(roomId);
    const transport = transports.get(transportId);

    if (!router || !transport) return res.status(404).json({ error: 'Router or Transport not found' });

    if (!router.canConsume({ producerId, rtpCapabilities })) {
        return res.status(400).json({ error: 'Cannot consume' });
    }

    try {
        const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true, // Start paused, wait for client request
        });
        consumers.set(consumer.id, consumer);

        consumer.on('transportclose', () => {
            consumer.close();
            consumers.delete(consumer.id);
        });

        consumer.on('producerclose', () => {
            consumer.close();
            consumers.delete(consumer.id);
        });

        res.json({
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        });
    } catch (error) {
        console.error('Consume error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Resume Consumer
app.post('/resume-consumer', async (req, res) => {
    const { consumerId } = req.body;
    const consumer = consumers.get(consumerId);
    if (!consumer) return res.status(404).json({ error: 'Consumer not found' });

    try {
        await consumer.resume();
        res.json({ success: true });
    } catch (error) {
        console.error('Resume consumer error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'SFU service is running' });
});

app.use('/hls', express.static(path.join(__dirname, 'hls_output')));

const PORT = process.env.SFU_PORT || 5000;
const HOST = process.env.SFU_HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
    console.log(`SFU Service listening on http://${HOST}:${PORT}`);
});
