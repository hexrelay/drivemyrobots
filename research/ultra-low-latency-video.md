# Ultra-Low-Latency Video Research

## What is "Ultra-Low Latency"?

**Confirmed:** Ultra-low latency does mean latency on the order of milliseconds.

Industry definitions vary, but the consensus is:
- **Ultra-low latency:** Sub-1 second, typically **200-500ms** for interactive applications
- **True real-time (glass-to-glass):** Under **200ms** (less than ~6 frames at 30fps)
- **Best achievable:** **35-65ms** over wired/5G, **100-200ms** over 4G/WAN

For teleoperation specifically, even 500ms is considered dangerous for driving scenarios. The target should be **under 200ms**, ideally under 100ms.

---

## Protocol Comparison

| Protocol | Typical Latency | Pros | Cons |
|----------|----------------|------|------|
| **WebRTC** | 50-500ms | Lowest latency, browser-native, P2P capable, congestion control | Requires signaling server, complex setup |
| **SRT** | Configurable, low | Reliable over bad networks, open-source, AES encryption | Not browser-native, needs transcoding for web |
| **RTSP** | ~2 seconds | Simple, widespread in IP cameras | Higher latency, doesn't scale, no browser support |
| **HLS/DASH** | 10-30+ seconds | Universal browser support, CDN-friendly | Far too slow for teleoperation |

**Winner for teleoperation: WebRTC**

---

## Recommended Solutions (Ranked)

### 1. RaspberryPi-WebRTC (Best for Pi-based robots)
- **GitHub:** https://github.com/TzuHuanTai/RaspberryPi-WebRTC
- Native C++ WebRTC implementation
- Hardware encoding support (H.264)
- **~200ms latency** over WAN, **<80ms** on LAN
- Supports MQTT or WHEP signaling
- Works on Pi and NVIDIA Jetson

### 2. MediaMTX (Best all-in-one server)
- **GitHub:** https://github.com/bluenviron/mediamtx
- Zero-dependency Go binary
- Supports RTSP → WebRTC conversion
- WHIP/WHEP protocol support
- **100-200ms latency** via WebRTC
- Easy Docker deployment: `docker run --network=host bluenviron/mediamtx`

### 3. GStreamer + webrtcsink (Best for custom pipelines)
- Mature, flexible multimedia framework
- Rust-based webrtcsink handles multiple peers
- Hardware acceleration on Nvidia, Intel, Rockchip
- **142-159ms latency** reported
- WHIP/WHEP support in recent versions

### 4. Janus WebRTC Gateway (Best for complex deployments)
- **GitHub:** https://github.com/meetecho/janus-gateway
- Full-featured WebRTC server
- Plugin architecture for custom logic
- **<1 second** glass-to-glass, typically ~400ms
- Good for multi-user scenarios

### 5. RTCBot (Best for Python-based robots)
- **GitHub:** https://github.com/dkumor/rtcbot
- Python asyncio + aiortc
- Designed specifically for robot teleoperation
- Tutorials for Pi + browser control over 4G
- Good for prototyping, may have higher latency than native solutions

### 6. FlowRTC (Commercial option)
- **Website:** https://flowrtc.com/
- Claims sub-100ms for robotics
- Purpose-built for teleoperation
- May simplify infrastructure

---

## Technical Considerations

### Hardware Encoding is Critical
- Software encoding adds significant latency
- Use H.264 hardware encoder on Pi (`h264_v4l2m2m`)
- NVIDIA Jetson has excellent hardware encoding support

#### Pi 4 vs Pi 5: Critical Difference

**Pi 4:** Has built-in H.264 hardware encoder in the VideoCore VI GPU
- Can encode 1080p30 comfortably, 1080p60 with optimization
- ~38 FPS real-world for 1080p encoding
- Encoding latency: ~22ms at 720p60, ~50ms at 1080p30
- Access via `h264_v4l2m2m` (V4L2) — the old `h264_omx` is deprecated
- Max resolution: 2032px wide
- **No extra hardware needed**

**Pi 5:** NO hardware H.264 encoder!
- The VideoCore VII dropped the legacy H.264 encode block
- Must use software encoding (libx264)
- Can still do 4K30 in software, but with higher CPU load and latency
- **For low-latency teleoperation, Pi 4 is actually better than Pi 5**

#### External Encoder Options
No widely-available USB/HAT H.264 encoder peripherals found. The built-in Pi 4 encoder is the practical choice. Alternatives:
- NVIDIA Jetson Nano/Orin (excellent hardware encode, more expensive)
- Orange Pi / Rockchip boards (some have hardware encode)

### Congestion Control Matters
- Pre-encoded streams (fixed bitrate) lose WebRTC's adaptive bitrate
- If bandwidth drops, latency spikes or frames drop
- Native WebRTC encoding adjusts dynamically

### Network Path
- Edge servers reduce latency
- TURN servers add latency (keep under 50ms to TURN)
- P2P connections (when possible) are fastest
- 5G generally outperforms 4G significantly

### Signaling Options
- **MQTT:** Good for IoT, robot already likely has MQTT
- **WHIP/WHEP:** Standardized HTTP-based, simpler than custom signaling
- **WebSocket:** Traditional approach, works well

---

## Recommended Architecture for Drive My Robots

```
[Robot Camera]
    ↓ (hardware H.264 encode)
[Pi/Jetson running WebRTC endpoint]
    ↓ (WebRTC over cellular/WiFi)
[STUN/TURN server for NAT traversal]
    ↓
[Operator's Browser]
```

**Suggested starting point:** Try RaspberryPi-WebRTC or MediaMTX first—both are relatively simple to deploy and should achieve sub-200ms latency.

---

## RaspberryPi-WebRTC Setup Guide

### Overview

RaspberryPi-WebRTC (`pi-webrtc`) is a native C++ application that turns a Pi into a low-latency WebRTC streaming endpoint. It's lightweight, uses hardware encoding, and achieves **<80ms on LAN, ~200ms over WAN**.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SIGNALING LAYER                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │ MQTT Broker │ OR  │ WHEP Server │ OR  │  WebSocket  │       │
│  │ (HiveMQ/    │     │ (requires   │     │    (SFU)    │       │
│  │  EMQX)      │     │  HTTPS)     │     │             │       │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘       │
└─────────┼───────────────────┼───────────────────┼───────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NAT TRAVERSAL LAYER                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              STUN Server (Google, free)                  │   │
│  │    stun:stun.l.google.com:19302 — discovers public IP    │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         TURN Server (fallback, relays traffic)           │   │
│  │    Metered.ca free tier (500MB/mo) or self-host Coturn   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │                                       │
          ▼                                       ▼
┌──────────────────┐                    ┌──────────────────┐
│   ROBOT (Pi 4)   │◄──── WebRTC P2P ──►│  OPERATOR        │
│                  │      (encrypted)    │  (Browser)       │
│ ┌──────────────┐ │                    │                  │
│ │ CSI Camera   │ │                    │ picamera-web or  │
│ └──────┬───────┘ │                    │ custom JS client │
│        ▼         │                    │                  │
│ ┌──────────────┐ │                    └──────────────────┘
│ │ H.264 HW Enc │ │
│ │ (VideoCore)  │ │
│ └──────┬───────┘ │
│        ▼         │
│ ┌──────────────┐ │
│ │  pi-webrtc   │ │
│ └──────────────┘ │
└──────────────────┘
```

### Signaling Options Explained

**Option A: MQTT (Recommended for prototyping)**
- Pi and browser both connect to an MQTT broker
- They exchange WebRTC connection info (SDP offers/answers, ICE candidates)
- Free cloud options: HiveMQ Cloud, EMQX Serverless (1M free session-mins/month)
- Self-host with Mosquitto if needed

**Option B: WHEP (Simpler, but needs HTTPS)**
- HTTP-based protocol, no broker needed
- Pi runs an HTTP server, browser fetches stream via WHEP
- Requires public hostname + TLS certificate (nginx + Let's Encrypt)
- Better for production, harder for quick testing

**Option C: WebSocket/SFU (One-to-many)**
- For broadcasting to multiple viewers
- Requires an SFU server

### Pi Setup Steps

1. **Flash Raspberry Pi OS Lite** (headless, no desktop)

2. **Configure GPU memory** — Add to `/boot/config.txt`:
   ```
   gpu_mem=128
   ```

3. **Install dependencies:**
   ```bash
   sudo apt update
   sudo apt install libmosquitto1 pulseaudio libavformat61 libswscale8 libprotobuf32t64
   ```

4. **Download pi-webrtc binary:**
   ```bash
   wget https://github.com/TzuHuanTai/RaspberryPi-WebRTC/releases/latest/download/pi-webrtc-armv7.tar.gz
   tar -xzf pi-webrtc-armv7.tar.gz
   ```

5. **Run with MQTT signaling:**
   ```bash
   ./pi-webrtc \
     --camera=libcamera:0 \
     --fps=30 \
     --width=1280 --height=720 \
     --hw-accel \
     --no-audio \
     --use-mqtt \
     --mqtt-host=broker.hivemq.com \
     --mqtt-port=8883 \
     --mqtt-username=<your-user> \
     --mqtt-password=<your-pass> \
     --uid=robot-1
   ```

### Browser Client Setup

The project provides `picamera-web` — a web client that connects via MQTT:

1. Open the web client (hosted or run locally)
2. Enter MQTT broker details (same as Pi)
3. Enter the UID (`robot-1`)
4. Video stream appears in browser

For custom integration, use the `picamera.js` library in your own web app.

### STUN/TURN Configuration

**Free STUN (usually sufficient):**
- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

**Free TURN (for restrictive NATs):**
- Metered.ca — 500MB/month free, requires API key
- Open Relay Project — free, may require API key
- Self-host Coturn — free, you pay for server

### Memory Considerations (1GB Pi 4)

- Run headless (no desktop)
- Set `gpu_mem=128` in config.txt
- Use `--no-audio` if audio not needed
- Target 720p rather than 1080p
- Single viewer only

---

## Next Steps

1. ✅ Hardware: Pi 4 (1GB) confirmed
2. **Camera:** What camera module do we have? (CSI Pi Camera recommended)
3. **Network:** WiFi testing first, then cellular?
4. **MQTT broker:** Use HiveMQ/EMQX free tier for testing

---

## Sources

- [Red5: What is Ultra-Low Latency?](https://www.red5.net/blog/what-is-ultra-low-latency-why-does-it-matter/)
- [Soliton: Ultra Low Latency - The Real Definition](https://blog.solitonsystems.com/blog/ultra-low-latency-the-real-definition)
- [GetStream: Video Streaming Protocols Comparison](https://getstream.io/blog/streaming-protocols/)
- [RaspberryPi-WebRTC GitHub](https://github.com/TzuHuanTai/RaspberryPi-WebRTC)
- [MediaMTX GitHub](https://github.com/bluenviron/mediamtx)
- [Janus WebRTC Gateway](https://github.com/meetecho/janus-gateway)
- [RTCBot GitHub](https://github.com/dkumor/rtcbot)
- [GStreamer WebRTC Documentation](https://blogs.igalia.com/llepage/webrtc-gstreamer-and-html5-part-1/)
- [Transitive Robotics WebRTC Video](https://transitiverobotics.com/caps/transitive-robotics/webrtc-video/)
