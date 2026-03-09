# DMR Video Streaming Setup

This document describes how to set up low-latency video streaming from a Raspberry Pi 4 to a web browser via MediaMTX relay.

## Architecture

```
Pi 4 (dmr-bot-alpha)          Relay (198.199.80.228)              Browser
┌─────────────────┐          ┌─────────────────────┐          ┌──────────┐
│ Camera Module 3 │          │ MediaMTX            │          │ WebRTC   │
│       ↓         │   RTSP   │   - RTSP in :8554   │   WHEP   │ client   │
│ GStreamer       │ ───────> │   - WebRTC :8889    │ <─────── │          │
│ (H.264 hw enc)  │          │                     │          │          │
└─────────────────┘          │ nginx (HTTPS proxy) │          └──────────┘
                             │   - :443 → :8889    │
                             └─────────────────────┘
```

## Components

### On the Pi

- **GStreamer** with libcamerasrc, v4l2h264enc (hardware encoder), rtspclientsink
- Pushes RTSP stream to MediaMTX

### On the Relay

- **MediaMTX** - receives RTSP, serves WebRTC via WHEP
- **nginx** - HTTPS proxy for WHEP endpoint (browsers require secure context)

### In the Browser

- WebRTC client connects to `https://drivemyrobots.com/robot1/whep`

---

## Pi Setup

### 1. Install GStreamer and plugins

```bash
sudo apt-get update
sudo apt-get install -y \
  gstreamer1.0-tools \
  gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad \
  gstreamer1.0-libcamera \
  gstreamer1.0-rtsp
```

### 2. Verify camera and encoder

```bash
# Check camera
gst-launch-1.0 libcamerasrc ! fakesink

# Check hardware encoder
gst-inspect-1.0 v4l2h264enc
```

### 3. Start streaming

```bash
gst-launch-1.0 \
  libcamerasrc ! \
  "video/x-raw,width=640,height=480,framerate=30/1" ! \
  queue ! \
  videoconvert ! \
  v4l2h264enc extra-controls="controls,repeat_sequence_header=1" ! \
  "video/x-h264,level=(string)4" ! \
  h264parse config-interval=-1 ! \
  queue ! \
  rtspclientsink location=rtsp://198.199.80.228:8554/robot1
```

For background operation:

```bash
nohup gst-launch-1.0 \
  libcamerasrc ! \
  "video/x-raw,width=640,height=480,framerate=30/1" ! \
  queue ! \
  videoconvert ! \
  v4l2h264enc extra-controls="controls,repeat_sequence_header=1" ! \
  "video/x-h264,level=(string)4" ! \
  h264parse config-interval=-1 ! \
  queue ! \
  rtspclientsink location=rtsp://198.199.80.228:8554/robot1 \
  > /tmp/gst-stream.log 2>&1 &
```

---

## Relay Setup

### 1. MediaMTX

MediaMTX is installed at `/opt/mediamtx/`. Key config in `/opt/mediamtx/mediamtx.yml`:

- RTSP enabled on port 8554
- WebRTC enabled on port 8889
- WHEP endpoint: `http://localhost:8889/robot1/whep`

### 2. nginx HTTPS Proxy

In `/etc/nginx/sites-available/drivemyrobots`:

```nginx
location /robot1/whep {
    # Handle preflight
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS, PATCH, DELETE" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, If-Match" always;
        add_header Access-Control-Max-Age 86400;
        return 204;
    }

    proxy_pass http://127.0.0.1:8889/robot1/whep;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # CORS headers on response
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS, PATCH, DELETE" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, If-Match" always;
    add_header Access-Control-Expose-Headers "Link, Location" always;
}
```

---

## Browser Client

The frontend at `/var/www/html/test/index.html` uses:

```javascript
const STREAM_URL = 'https://drivemyrobots.com/robot1/';
// ...
const whepUrl = streamUrl + 'whep';
const response = await fetch(whepUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp
});
```

---

## Troubleshooting

### Check if stream is running on Pi

```bash
pgrep -a gst-launch
```

### Check MediaMTX logs

```bash
journalctl -u mediamtx -n 20
```

### Test WHEP endpoint

```bash
curl -X OPTIONS https://drivemyrobots.com/robot1/whep -v
```

### Common issues

1. **"No playable streams"** in recorded MP4 - use raw H.264 output and wrap with ffmpeg
2. **libsoup2/3 conflict** with whip-client - use rtspclientsink instead of WHIP
3. **Mixed content** - ensure frontend uses HTTPS proxy, not direct HTTP to MediaMTX

---

## Performance

- Hardware H.264 encoding via VideoCore on Pi 4
- Latency: ~150-300ms end-to-end (limited by browser jitter buffer)
- Resolution: 640x480 @ 30fps (adjustable)
