# DMR Video Pipeline Diagrams

## Current System (Synthetic Video)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Pi                                                                          │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │ Python      │───▶│ ffmpeg      │───▶│ RTSP out    │──────────────────────┼──┐
│  │ (Pillow)    │raw │ (H.264 enc) │    │ (TCP)       │                      │  │
│  │ ~10ms       │RGB │ ~20ms       │    │             │                      │  │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │  │
│        ▲                                                                    │  │
│        │ direction/color                                                    │  │
│  ┌─────┴───────┐                                                            │  │
│  │ TCP client  │◀───────────────────────────────────────────────────────────┼──┼──┐
│  │ (persistent)│                                                            │  │  │
│  └─────────────┘                                                            │  │  │
│                                                                             │  │  │
└─────────────────────────────────────────────────────────────────────────────┘  │  │
                                                                                 │  │
                                                                                 │  │
┌─────────────────────────────────────────────────────────────────────────────┐  │  │
│ Relay Droplet (198.199.80.228)                                              │  │  │
│                                                                             │  │  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │  │  │
│  │ MediaMTX    │───▶│ MediaMTX    │───▶│ WebRTC out  │──────────────────────┼──┼──┼──┐
│  │ RTSP in     │    │ (passthru)  │    │ (WHEP)      │                      │  │  │  │
│  │             │◀───┼─────────────┼────┼─────────────┼──────────────────────┼──┘  │  │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │     │  │
│                                                                             │     │  │
│  ┌─────────────┐                                                            │     │  │
│  │ Input relay │ HTTP POST from browser                                     │     │  │
│  │ server      │◀───────────────────────────────────────────────────────────┼─────┼──┼──┐
│  │ (Python)    │────────────────────────────────────────────────────────────┼─────┘  │  │
│  └─────────────┘ TCP push to Pi                                             │        │  │
│                                                                             │        │  │
└─────────────────────────────────────────────────────────────────────────────┘        │  │
                                                                                       │  │
                                                                                       │  │
┌─────────────────────────────────────────────────────────────────────────────┐        │  │
│ Browser                                                                     │        │  │
│                                                                             │        │  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │        │  │
│  │ WebRTC      │───▶│ Jitter      │───▶│ <video>     │                      │        │  │
│  │ receiver    │    │ buffer      │    │ element     │                      │        │  │
│  │             │◀───┼─────────────┼────┼─────────────┼──────────────────────┼────────┘  │
│  └─────────────┘    │ 100-200ms!! │    └─────────────┘                      │           │
│                     └─────────────┘                                         │           │
│                      THE PROBLEM                                            │           │
│                                                                             │           │
│  ┌─────────────┐                                                            │           │
│  │ Elm app     │ arrow keys ──▶ HTTP POST ──────────────────────────────────┼───────────┘
│  └─────────────┘                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


Total latency: ~250-450ms
  - Frame gen:     ~10ms
  - ffmpeg encode: ~20ms
  - Network to relay: ~30ms
  - MediaMTX:      ~10ms
  - Network to browser: ~30ms
  - Jitter buffer: ~100-200ms  ◀── BIGGEST CONTRIBUTOR
  - Render:        ~5ms
```

---

## With Camera + pi-webrtc (Future - No ffmpeg)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Pi                                                                          │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │ Camera      │───▶│ VideoCore   │───▶│ pi-webrtc   │──────────────────────┼──┐
│  │ Module 3    │raw │ H.264 enc   │H264│ WebRTC send │                      │  │
│  │             │    │ (hardware)  │    │             │                      │  │
│  │             │    │ ~5-10ms     │    │             │                      │  │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │  │
│                                                                             │  │
│  (input handling same as before)                                            │  │
│                                                                             │  │
└─────────────────────────────────────────────────────────────────────────────┘  │
                                                                                 │
                                                                                 │
                      ┌──────────────────────────────────────────────────────────┘
                      │
                      │   Two options from here:
                      │
                      ▼
       ┌──────────────────────────────────┐
       │                                  │
       │  OPTION A: Direct P2P            │  OPTION B: Via relay
       │  (only if NAT allows)            │  (more reliable)
       │                                  │
       ▼                                  ▼

┌─────────────────────────┐    ┌─────────────────────────────────────────────┐
│ Browser                 │    │ Relay (MediaMTX or SFU)                     │
│                         │    │                                             │
│  ┌─────────────┐        │    │  ┌───────────┐    ┌───────────┐             │
│  │ WebRTC recv │        │    │  │ WebRTC in │───▶│ WebRTC out│─────────┐   │
│  └──────┬──────┘        │    │  └───────────┘    └───────────┘         │   │
│         │               │    │                                         │   │
│         ▼               │    └─────────────────────────────────────────┼───┘
│  ┌─────────────┐        │                                              │
│  │ Jitter      │        │    ┌─────────────────────────────────────────┼───┐
│  │ buffer      │        │    │ Browser                                 │   │
│  │ 100-200ms!! │        │    │                                         │   │
│  └──────┬──────┘        │    │  ┌─────────────┐                        │   │
│         │               │    │  │ WebRTC recv │◀───────────────────────┘   │
│         ▼               │    │  └──────┬──────┘                            │
│  ┌─────────────┐        │    │         │                                   │
│  │ <video>     │        │    │         ▼                                   │
│  └─────────────┘        │    │  ┌─────────────┐                            │
│                         │    │  │ Jitter      │                            │
└─────────────────────────┘    │  │ buffer      │                            │
                               │  │ 100-200ms!! │                            │
                               │  └──────┬──────┘                            │
                               │         │                                   │
                               │         ▼                                   │
                               │  ┌─────────────┐                            │
                               │  │ <video>     │                            │
                               │  └─────────────┘                            │
                               │                                             │
                               └─────────────────────────────────────────────┘


Total latency: ~150-300ms (improved but still limited by jitter buffer)
  - Camera capture: ~10ms
  - Hardware encode: ~5-10ms
  - Network:         ~30-60ms
  - Jitter buffer:   ~100-200ms  ◀── STILL THE PROBLEM
  - Render:          ~5ms
```

---

## WebCodecs Approach (Bypasses Jitter Buffer)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Pi                                                                          │
│                                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │
│  │ Camera      │───▶│ VideoCore   │───▶│ RTSP out    │──────────────────────┼──┐
│  │ Module 3    │    │ H.264 enc   │    │             │                      │  │
│  │             │    │ (hardware)  │    │             │                      │  │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │  │
│                                                                             │  │
└─────────────────────────────────────────────────────────────────────────────┘  │
                                                                                 │
                                                                                 │
┌─────────────────────────────────────────────────────────────────────────────┐  │
│ Relay (NEW: WebTransport proxy - replaces MediaMTX WebRTC)                  │  │
│                                                                             │  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │  │
│  │ RTSP in     │───▶│ Extract     │───▶│ WebTransport│──────────────────────┼──┼──┐
│  │             │    │ H.264 NAL   │    │ server      │                      │  │  │
│  │             │◀───┼─ units ─────┼────│ (QUIC)      │                      │  │  │
│  └─────────────┘    └─────────────┘    └─────────────┘                      │  │  │
│                                                                             │  │  │
│  Key: sends raw H.264 frames, not WebRTC                                    │◀─┘  │
│       uses QUIC unreliable datagrams (no head-of-line blocking)             │     │
│                                                                             │     │
└─────────────────────────────────────────────────────────────────────────────┘     │
                                                                                    │
                                                                                    │
┌─────────────────────────────────────────────────────────────────────────────┐     │
│ Browser                                                                     │     │
│                                                                             │     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                      │     │
│  │ WebTransport│───▶│ WebCodecs   │───▶│ <canvas>    │                      │     │
│  │ client      │NALs│ VideoDecoder│    │ render      │                      │     │
│  │ (receives   │    │             │    │             │                      │     │
│  │  H.264)     │◀───┼─────────────┼────┼─────────────┼──────────────────────┼─────┘
│  └─────────────┘    │             │    └─────────────┘                      │
│                     │ NO JITTER   │                                         │
│                     │ BUFFER!     │                                         │
│                     │             │                                         │
│                     │ Hardware-   │                                         │
│                     │ accelerated │                                         │
│                     │ ~5-10ms     │                                         │
│                     │             │                                         │
│                     └─────────────┘                                         │
│                                                                             │
│  Key changes:                                                               │
│  - WebTransport instead of WebRTC (no mandatory jitter buffer)              │
│  - WebCodecs VideoDecoder instead of <video> element                        │
│  - Render to <canvas> instead of <video>                                    │
│  - WE control buffering (or lack thereof)                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘


Total latency: ~50-100ms (dramatic improvement!)
  - Camera capture: ~10ms
  - Hardware encode: ~5-10ms
  - Network:         ~30-50ms
  - VideoDecoder:    ~5-10ms   ◀── NO JITTER BUFFER
  - Canvas render:   ~5ms


Tradeoffs:
  - More complex implementation
  - Need to handle packet loss ourselves
  - Browser support: Chrome yes, Safari/Firefox limited
  - Existing project "rtsp2browser" does the relay part
```

---

## Summary Comparison

```
┌────────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Approach           │ Total Latency   │ Complexity      │ Status          │
├────────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ Current            │ 250-450ms       │ Low             │ Working now     │
│ (ffmpeg + WebRTC)  │                 │                 │                 │
├────────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ pi-webrtc + camera │ 150-300ms       │ Medium          │ When camera     │
│ (hardware encode)  │                 │                 │ arrives         │
├────────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ WebCodecs          │ 50-100ms        │ High            │ Future option   │
│ (bypass jitter)    │                 │                 │                 │
└────────────────────┴─────────────────┴─────────────────┴─────────────────┘

The jitter buffer in browser WebRTC accounts for 100-200ms alone.
WebCodecs is the only browser-based way to eliminate it.
Native apps (Parsec, Moonlight) achieve <50ms by not using browsers at all.
```
