// DMR Experimental WebCodecs Client
// Connects to rtsp2browser proxy for low-latency video

const PROXY_URL = 'https://drivemyrobots.com:4434/';
const RTSP_URL = 'rtsp://localhost:8554/robot1';  // Pi camera stream
const WS_FALLBACK_PORT = '8081';

function log(msg, level = 'info') {
    const logDiv = document.getElementById('log');
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (level === 'error') entry.style.color = '#ff6b6b';
    if (level === 'warn') entry.style.color = '#feca57';
    logDiv.prepend(entry);
    console.log(msg);
}

function updateStatus(text, color = '#888') {
    const status = document.getElementById('status');
    status.textContent = text;
    status.style.color = color;
}

document.getElementById('connect').onclick = () => {
    const canvas = document.getElementById('canvas');

    updateStatus('Connecting...', '#feca57');
    log('Starting connection...');

    // Create worker
    const worker = new Worker('worker.js');

    // Transfer canvas control to worker
    const offscreen = canvas.transferControlToOffscreen();

    worker.postMessage({
        type: 'init',
        url: PROXY_URL,
        rtspUrl: RTSP_URL,
        wsFallbackPort: WS_FALLBACK_PORT,
        canvas: offscreen
    }, [offscreen]);

    worker.onmessage = (e) => {
        const { type, msg, level } = e.data;
        if (type === 'log') {
            log(msg, level);

            // Update status based on log messages
            if (msg.includes('WebTransport connected') || msg.includes('WebSocket connected')) {
                updateStatus('Connected', '#00d9ff');
            } else if (msg.includes('error') || msg.includes('failed')) {
                updateStatus('Error', '#ff6b6b');
            }
        } else if (type === 'connected') {
            updateStatus('Streaming', '#00ff88');
        }
    };

    // Disable connect button after first click
    document.getElementById('connect').disabled = true;
    document.getElementById('connect').textContent = 'Connecting...';

    log('Initialized Web Worker');
};
