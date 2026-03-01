# Drive My Robots - Project History

## Session 1 (2026-01-05)

**Focus:** Ultra-low-latency video research for robot teleoperation

### Summary

Initiated the drive-my-robots project with research into achieving ultra-low-latency video streaming for remote robot control. Key findings:

- **Ultra-low latency** confirmed as sub-500ms, ideally under 200ms for teleoperation
- **WebRTC** identified as the best protocol for browser-based teleoperation
- **RaspberryPi-WebRTC** (`pi-webrtc`) selected as the recommended solution—native C++, hardware encoding, <80ms LAN / ~200ms WAN latency
- **Pi 4 vs Pi 5:** Discovered that Pi 4 has hardware H.264 encoding but Pi 5 removed it—Pi 4 is actually better for this use case
- **1GB RAM Pi 4** should work for single-stream 720p with careful configuration (headless, gpu_mem=128)

### Artifacts Created

- `research/ultra-low-latency-video.md` — comprehensive research document including:
  - Protocol comparison (WebRTC vs SRT vs RTSP vs HLS)
  - Solution rankings (RaspberryPi-WebRTC, MediaMTX, GStreamer, Janus, etc.)
  - Pi hardware encoding details
  - Full architecture diagram for the video pipeline
  - Step-by-step setup guide for pi-webrtc with MQTT signaling
  - STUN/TURN server options

### Hardware Confirmed

- Raspberry Pi 4 (1GB RAM)
- Camera: TBD

### Next Steps

1. Acquire a camera (CSI Pi Camera recommended for lowest latency)
2. Set up MQTT broker (HiveMQ or EMQX free tier)
3. Flash Pi with Raspberry Pi OS Lite and install pi-webrtc
4. Test video stream on local network first

---

## Milestone: LED Feedback Prototype

**Goal:** Build the simplest possible "robot" to validate the full teleoperation pipeline before adding motors or mobility.

### Concept

- Mount an LED HAT (8 multicolor LEDs, e.g., Blinkt! or similar) on the Pi
- Point the CSI camera back at the LEDs
- Build a web interface to control the LEDs remotely
- User sees the video stream and can toggle/change LED colors
- The visual feedback loop lets us feel and measure the actual end-to-end latency

### What This Tests

- Full video encoding and streaming pipeline (pi-webrtc)
- WebRTC connection establishment
- Web interface for control input
- Round-trip latency (command sent → LED changes → video shows change)
- All infrastructure minus physical robot movement

### Hardware Required

- Raspberry Pi 4 (2GB or 4GB)
- CSI Camera Module 3 (standard or wide)
- LED HAT (Blinkt!, Unicorn pHAT, or similar 8-LED board)
- Heatsink
- Power supply, SD card, cables

### Success Criteria

- Can control LEDs from a web browser on a different machine
- Video stream shows LED changes with perceptible but acceptable lag (<200ms target)
- System runs stable for extended periods

---

## Session 2 (2026-02-27)

**Focus:** Hardware planning and research

### Summary

Resumed project after Session 1. Key decisions and findings:

- **RAM:** Upgraded target from 1GB to 2GB Pi 4 — 1GB is too fragile for comfortable development, 2GB provides headroom without being overkill
- **Camera:** CSI camera confirmed as the right choice (vs USB) due to direct GPU path and lower latency
- **Pi 4 vs Pi 5:** Reconfirmed Pi 4 is better due to hardware H.264 encoding (removed in Pi 5)
- **Pricing:** Pi 4 prices increased in 2026 due to LPDDR4 memory costs (AI infrastructure competition); $55 MSRP now closer to $75 at some retailers
- **Bandwidth research:** Estimated 3-5 robots at 720p would saturate typical 10Mbps home upload; fiber (symmetric speeds) available in Anchorage/Eagle River area via MTA or Alaska Communications
- **Architecture consideration:** Explored central encoding (streaming raw video to a hub) — feasible but bandwidth-heavy (~633Mbps per 720p stream uncompressed); on-device encoding remains cleaner

### Hardware Ordered

- Raspberry Pi 4 2GB (or 4GB depending on availability/price)
- Raspberry Pi Camera Module 3 (standard — wide was out of stock)
- Heatsink
- HDMI adapter cable
- (additional peripherals TBD)

### Next Steps

1. Build LED Feedback Prototype (see milestone above)
2. Set up MQTT broker
3. Implement basic web interface for LED control
4. Measure and document actual latency

---

## Session 3 (2026-03-01)

**Focus:** First Pi setup via pimint

### Summary

Brief session to switch context to DMR after completing pimint. Successfully minted the first DMR test Pi using the newly-created pimint system.

### What Happened

- Set active project to DMR
- The "dmr-test" Pi that was minted during pimint development is now available
- Pi is accessible at same IP/port as pimint host (216.137.239.117:2222) due to shared MAC address via port forwarding

### Current State

- dmr-test Pi is online and accessible via SSH
- Ready to begin LED Feedback Prototype work
- Hardware still pending (Pi 4 2GB/4GB and Camera Module 3 ordered but not yet arrived)

### Next Steps

Same as Session 2 - waiting for hardware to arrive to begin LED Feedback Prototype.

---

## Session 4 (2026-03-01)

**Focus:** Working LED feedback prototype with synthetic video

### Summary

Built and deployed a functional end-to-end prototype without waiting for camera hardware. Created a synthetic video source (bouncing basketball) to validate the full pipeline.

### What Was Built

**Infrastructure:**
- New droplet "dmr-relay" (198.199.80.228) running MediaMTX for RTSP→WebRTC conversion
- Input relay server (Python) with persistent TCP connections for low-latency command delivery
- Domain drivemyrobots.com pointed to relay droplet

**Pi Side:**
- Python script generating bouncing basketball animation using Pillow
- ffmpeg encoding to H.264 and streaming via RTSP to relay
- Persistent TCP connection to relay for receiving input commands

**Browser Frontend:**
- Elm app with WebRTC video playback
- Arrow key controls to move the basketball
- Number keys 1-8 to change ball color/tint
- Deployed via nginx on relay droplet

### Input System Evolution

Started with polling-based input (100ms intervals) but identified this as a latency source. Redesigned to use persistent TCP connections with instant push on HTTP POST from browser. The relay server maintains open connections to each robot and pushes commands immediately.

### Latency Research

Conducted extensive research on video latency optimization:

- **playoutDelayHint = 0**: Implemented Chrome's jitter buffer hint for minimum latency
- **MediaMTX tuning**: Researched but found it's already a pass-through; bottleneck is browser
- **SFU alternatives**: Evaluated Pion, LiveKit, mediasoup - wouldn't help, same browser bottleneck
- **Industry comparison**: Studied Parsec (<20ms), Moonlight (~50ms), pi-webrtc (~200ms)
- **WebCodecs approach**: Researched bypassing browser jitter buffer entirely

Key finding: Browser WebRTC has a latency floor of ~100-200ms due to mandatory jitter buffering. Native apps achieve lower latency by controlling the entire decode/render pipeline.

### WebCodecs Decision

Investigated WebCodecs + WebTransport as a way to bypass browser jitter buffer. Found existing projects (Facebook's webcodecs-capture-play, rtsp2browser). However:

- Safari doesn't support WebTransport
- iOS (all browsers use Safari engine) would be unsupported
- Losing iOS users not worth the ~100ms improvement

Decision: Not pursuing WebCodecs for now. If sub-100ms latency is ever required, a native app (like Parsec/Moonlight) would be the better path.

### Artifacts Created

- `frontend/` — Elm app with WebRTC video and controls
- `pi-scripts/color-stream.py` — Synthetic video generator with basketball animation
- `relay-scripts/serve_input_requests.py` — Input relay server
- `latency-approaches.md` — Comprehensive latency research and decisions
- `diagrams.md` — Architecture diagrams for current and future pipelines

### Current State

- Working prototype at drivemyrobots.com
- Can move basketball with arrow keys, change color with number keys
- Estimated latency ~200-300ms (acceptable for teleoperation)
- Git repo initialized with initial commit

### Next Steps

1. When camera arrives, implement pi-webrtc with hardware encoding
2. Evaluate latency with real camera
3. If ~150-200ms is acceptable, proceed with robot hardware
4. If sub-100ms needed in future, consider native app approach
