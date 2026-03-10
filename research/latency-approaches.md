# DMR Latency Analysis and Approaches

## Current State (2026-03-01)

### Pipeline
```
User input -> HTTP POST -> Relay server -> TCP push -> Pi
Pi (Pillow) -> ffmpeg (software H.264) -> RTSP -> MediaMTX -> WebRTC -> Browser
```

### Estimated Latencies (current synthetic setup)

| Component | Latency |
|-----------|---------|
| Frame generation (Pillow) | ~10ms |
| ffmpeg software encode | ~15-30ms |
| RTSP to MediaMTX | ~20-50ms |
| MediaMTX processing | ~10-20ms |
| WebRTC transport | ~20-50ms |
| Browser jitter buffer | ~150-300ms |
| **Total** | **~250-450ms** |

### With Pi Camera + Hardware Encoding (future)

| Component | Latency |
|-----------|---------|
| Camera capture | ~10-15ms |
| Hardware encode (VideoCore) | ~5-10ms |
| WebRTC transport (via relay) | ~40-70ms |
| Browser jitter buffer | ~150-300ms |
| **Total** | **~200-400ms** |

### Optimistic Target (reduced jitter buffer)

| Component | Latency |
|-----------|---------|
| Camera + hardware encode | ~15-25ms |
| WebRTC via relay | ~40-70ms |
| Reduced jitter buffer | ~50ms |
| **Total** | **~100-150ms** |

## Key Insight

The browser jitter buffer accounts for 40-60% of total latency. This is the highest-value optimization target.

## Ideas Discussed

### 1. Reduce WebRTC Jitter Buffer (highest priority)
- Browsers don't expose direct jitter buffer control
- Possible approaches:
  - playsinline + low-latency hints (already implemented, marginal)
  - WebCodecs API for custom decode pipeline
  - Different WebRTC library/framework that exposes more control

### 2. Skip MediaMTX Relay
- Could save ~30-50ms
- But: relay needed for multiple viewers, NAT traversal
- Alternative: use a lighter SFU (Selective Forwarding Unit) like Janus, mediasoup, or Pion
- SFU forwards packets without full transcode, lower latency than MediaMTX

### 3. Hardware Encoding on Pi
- Pi Camera Module 3 + VideoCore hardware encoder
- pi-webrtc project handles this
- Saves ~20-30ms vs software encode
- Will be implemented when camera arrives

### 4. Direct WebRTC from Pi (pi-webrtc)
- Eliminates one network hop if no relay
- Still needs TURN server for NAT traversal
- Still needs relay/SFU for multiple viewers

## Research Findings (2026-03-01)

### playoutDelayHint / jitterBufferTarget

Chrome exposes `RTCRtpReceiver.playoutDelayHint` property (measured in seconds):
- `null` = default browser behavior (~150-300ms buffer)
- `0` = request minimum possible latency ("render as fast as possible")
- `0.5` = add 500ms of buffering

Example:
```javascript
const receivers = pc.getReceivers();
receivers.forEach(receiver => {
  receiver.playoutDelayHint = 0;  // Minimum latency
});
```

Notes:
- Chrome-specific (Firefox working on `jitterBufferTarget`)
- Good for cloud gaming use cases (sub-150ms target)
- Browser will still maintain minimum buffer for quality

### Framework Considerations

Standard browser WebRTC via RTCPeerConnection gives us access to `playoutDelayHint`. No need to change frameworks - we just need to set this property after receiving tracks.

**Status:** Implemented `playoutDelayHint = 0` in frontend. Subjectively feels better.

### MediaMTX Configuration (2026-03-01)

Researched MediaMTX settings for latency reduction. Key finding from maintainer:

> "Latency is introduced by browsers in order to increase robustness in case of network fluctuations. They choose the latency value autonomously."

**MediaMTX itself doesn't add significant buffering** - it's a pass-through for WebRTC. The latency is in the browser's jitter buffer, not MediaMTX.

Relevant settings we could tune:
- `writeQueueSize: 512` - queue of outgoing packets (current default)
- `readTimeout: 10s` / `writeTimeout: 10s` - connection timeouts

But these won't meaningfully reduce latency since MediaMTX is already just forwarding packets.

**Future:** MediaMTX plans to add WebCodecs-based transport which bypasses browser jitter buffer limitations.

### SFU Alternatives Research (2026-03-01)

Compared MediaMTX to lighter SFUs:

| Option | Type | Notes |
|--------|------|-------|
| MediaMTX | Media server | Current setup. Pass-through for WebRTC, no transcoding. |
| Pion | Go WebRTC library | Can build custom SFU. Used by LiveKit. |
| LiveKit | Full SFU platform | Production-grade, more complex setup. |
| mediasoup | Node.js SFU | Popular, well-documented. |

**Conclusion:** MediaMTX is already acting as an SFU (forwarding without transcoding). Switching to Pion/mediasoup wouldn't significantly reduce latency - the bottleneck is the browser jitter buffer, not the relay.

### WebCodecs API (potential future approach)

WebCodecs provides direct access to browser's hardware video decoder, bypassing the `<video>` element's jitter buffer entirely.

Pipeline would be:
```
Server -> WebTransport/DataChannel -> WebCodecs VideoDecoder -> Canvas
```

Benefits:
- No automatic jitter buffering
- Hardware-accelerated decode
- Full control over frame timing

Challenges:
- Need to handle packet loss/reordering manually
- More complex implementation
- May need custom container format or raw H.264 NAL units

Facebook has an experimental repo: [webcodecs-capture-play](https://github.com/facebookexperimental/webcodecs-capture-play)

This is the "nuclear option" for latency but requires significant rework.

## Summary of Options

| Approach | Effort | Latency Savings | Status |
|----------|--------|-----------------|--------|
| playoutDelayHint = 0 | Low | ~50-150ms | Done |
| MediaMTX tuning | Low | Minimal | Not worth it |
| Different SFU | Medium | Minimal | Not worth it |
| WebCodecs pipeline | High | ~100-200ms | Future consideration |
| Hardware encoding (Pi) | Medium | ~20-30ms | Waiting for camera |

## Industry Research (2026-03-01)

### What Similar Projects Do

#### Parsec (Cloud Gaming) - Sub-20ms latency
Key techniques:
- **Custom protocol (BUD)**: Built on UDP+DTLS, custom congestion control. WebRTC wasn't good enough.
- **Zero-copy GPU pipeline**: Frames never touch system memory. Desktop capture -> GPU encode -> network -> GPU decode -> render, all in video memory.
- **Hardware encode/decode only**: Direct NVENC/AMF/Intel APIs, no wrappers.
- **No buffering**: V-sync + frame dropping instead of jitter buffers. "Detect congestion before it starts."
- **Native app**: Ships their own client, doesn't rely on browser.

Source: [Parsec Technology Blog](https://parsec.app/blog/description-of-parsec-technology-b2738dcc3842)

#### Moonlight/Sunshine (Open Source Game Streaming) - ~20-50ms latency
Key techniques:
- **NVIDIA GameStream protocol**: UDP streams for video/audio/control.
- **Hardware encode via NVENC**: Bypasses FFmpeg's avcodec layer, calls NVENC directly.
- **Variable frame rate**: Only encodes when screen changes.
- **Reference frame invalidation**: Recovers from packet loss without full keyframe.

Source: [Sunshine Documentation](https://docs.lizardbyte.dev/projects/sunshine/)

#### pi-webrtc (Raspberry Pi) - ~200ms latency
Key techniques:
- **Native WebRTC**: Not browser-based, runs on Pi directly.
- **Hardware H.264 encode**: Uses Pi's VideoCore.
- **P2P connection**: No relay server in the path.
- **MQTT/WebSocket signaling**: Various options for connection setup.

Source: [RaspberryPi-WebRTC GitHub](https://github.com/TzuHuanTai/RaspberryPi-WebRTC)

#### Transitive Robotics (Robot Teleoperation)
- Uses WebRTC with ~200ms typical latency
- P2P connections when possible
- Hardware acceleration where available

### Key Insights

1. **Browser WebRTC has a floor around 100-200ms** due to jitter buffering. Native apps (Parsec, Moonlight) achieve lower latency by controlling the decode/render pipeline.

2. **Zero-copy GPU pipelines matter** - any copy to system memory adds latency.

3. **Custom protocols beat WebRTC for ultra-low latency** - but WebRTC is "good enough" for teleoperation (~200ms).

4. **The decode side is as important as encode** - browser jitter buffer is our bottleneck, not the Pi.

### Implications for DMR

For ~200ms latency (acceptable for teleoperation):
- Our current approach (WebRTC via MediaMTX + playoutDelayHint) should work
- pi-webrtc with hardware encode will help when camera arrives

For sub-100ms latency (if needed):
- Would need native app OR WebCodecs to bypass browser jitter buffer
- Would need to control entire pipeline end-to-end

## WebCodecs Implementation Research (2026-03-01)

### Existing Projects

1. **Facebook Experimental** ([webcodecs-capture-play](https://github.com/facebookexperimental/webcodecs-capture-play) + [go-media-webtransport-server](https://github.com/facebookexperimental/go-media-webtransport-server))
   - Most complete implementation
   - Achieves **<60ms end-to-end** under perfect network conditions
   - Uses WebTransport (QUIC) + WebCodecs
   - Used for Media over QUIC (MoQ) experimentation

2. **rtsp2browser** ([GitHub](https://github.com/vibhav011/rtsp2browser))
   - Streams RTSP directly to browser via WebTransport
   - Rust proxy extracts H.264 NAL units from RTP
   - Browser decodes with WebCodecs, renders with WebGL
   - Uses QUIC unreliable datagrams (no head-of-line blocking)
   - Could potentially work with our existing MediaMTX RTSP output

3. **webtransport-golang-demo** ([GitHub](https://github.com/matija92/webtransport-golang-demo))
   - Simple demo streaming raw video frames to browser

### Implementation Steps (if we pursued this)

1. Set up WebTransport proxy on relay droplet (Rust or Go)
2. Connect to MediaMTX RTSP, extract H.264 NAL units
3. Rewrite browser frontend: WebTransport client + WebCodecs VideoDecoder + Canvas
4. Handle packet loss, H.264 parsing, frame timing ourselves
5. Estimated effort: 3-5 days

### Browser Support Problem

| Browser | WebTransport | WebCodecs |
|---------|--------------|-----------|
| Chrome/Edge | Yes | Yes |
| Firefox | Yes | Partial |
| Safari | **No** | Yes |
| iOS (all browsers) | **No** | Yes |

**Critical issue:** Safari doesn't support WebTransport. On iOS, all browsers use Safari's engine, so iOS would be completely unsupported.

For a teleoperation app where mobile control is important, losing iOS is a significant limitation.

### Decision: Not Worth It (For Now)

Even after implementing WebCodecs, we would:
- Lose Safari/iOS users entirely
- Still need a fallback path for unsupported browsers
- Add significant complexity

The latency improvement (~100-150ms savings) doesn't justify losing a chunk of the browser-based user market.

### Alternative: Native App

For users who truly need sub-100ms latency, a dedicated native app (like Parsec/Moonlight) could bypass browser limitations entirely. This would:
- Achieve <50ms latency with full pipeline control
- Work on all platforms (iOS, Android, desktop)
- Coexist with the browser version for casual use

This is a larger undertaking but avoids the browser compatibility issues while delivering better results.

## WebCodecs Experiment Results (2026-03-10)

**We built and tested the WebCodecs + WebTransport approach.**

### What We Built

- **rtsp2browser proxy** (Rust): Connects to MediaMTX RTSP, forwards RTP packets over WebTransport datagrams
- **Browser client**: WebTransport + WebCodecs VideoDecoder + Canvas rendering
- Handles H.264 NAL unit parsing, FU-A defragmentation, avcC format conversion
- Custom datagram fragmentation for large keyframes (~50KB)

### Technical Challenges Solved

1. Consecutive UDP port allocation for RTSP compliance
2. IPv6 dual-stack socket binding
3. WebTransport datagram size limits (~1200 bytes)
4. H.264 avcC vs Annex-B format conversion
5. Frame boundary detection without AUD NAL units

### Result: No Visible Latency Improvement

Despite bypassing the WebRTC jitter buffer entirely, **there was no perceptible difference in latency** compared to the standard WebRTC/WHEP player.

### Possible Explanations

1. **Network latency dominates**: The Pi-to-relay-to-browser path adds ~100-150ms regardless of decode pipeline
2. **Hardware encoding latency**: The Pi's v4l2h264enc may buffer frames
3. **Our implementation overhead**: Custom parsing/reassembly may negate gains
4. **WebRTC jitter buffer isn't the bottleneck**: Modern browsers may be smarter than assumed

### Conclusion

The browser jitter buffer theory was incorrect, or its impact is smaller than other pipeline components. The standard WebRTC/WHEP approach is simpler and performs equally well.

**Code preserved at tag:** `webcodecs-experiment-2026-03-10`

---

## Next Steps

1. ~~Implement playoutDelayHint = 0~~ Done
2. ~~WebCodecs experiment~~ Done - no improvement
3. ~~When camera arrives, implement hardware encoding~~ Done (v4l2h264enc)
4. Current latency (~200ms) is acceptable for teleoperation
5. If sub-100ms needed in future: consider native app rather than browser optimizations
