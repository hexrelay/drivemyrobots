# Drive My Robots

Remote teleoperation of robots via browser with low-latency video streaming.

## State of the Project - 2026.03

Working prototype with synthetic video to validate the full pipeline before camera hardware arrives.

### What Works

**Video streaming:**
- Pi generates video (currently a bouncing basketball animation)
- ffmpeg encodes to H.264 and streams via RTSP to relay server
- MediaMTX on relay server converts RTSP to WebRTC
- Browser displays video with ~200-300ms latency

**Input control:**
- Arrow keys move the basketball
- Number keys 1-8 change ball color
- Persistent TCP connections for low-latency command delivery

**Live demo:** https://drivemyrobots.com

### Infrastructure

- **Relay server:** DigitalOcean droplet running MediaMTX + nginx (198.199.80.228)
- **Test Pi:** Raspberry Pi accessible via SSH

## Project Structure

```
bots/
  common/                  # Shared code for all bots
    drive_from_remote_input_template.py
  bankbot/                 # Physical robot with motors
    driver.py
    setraw.py
    drive_from_remote_input.py
  latency-test/            # Synthetic video prototype
    color-stream.py
    basketball.png

relay/                     # Server-side relay code
  serve_input_requests.py
  command-relay.py

frontend/                  # Elm browser app
  src/Main.elm
  index.html

research/                  # Documentation
  ultra-low-latency-video.md
  latency-approaches.md
  shopping-list.md
```

## Running the Latency Test Bot

### Relay server:

1. Run MediaMTX (listens for RTSP on 8554, serves WebRTC on 8889)
2. Run `python3 relay/serve_input_requests.py`
3. Serve `frontend/` via nginx

### Pi:

1. Run `python3 bots/latency-test/color-stream.py`
   - Generates bouncing ball animation
   - Streams to relay via ffmpeg/RTSP
   - Connects to relay for input commands

### Browser:

Navigate to the frontend URL. Use arrow keys to move, number keys to change color.

## Next Steps

1. When camera hardware arrives, test with real video using pi-webrtc for hardware H.264 encoding
2. Evaluate actual latency with camera vs synthetic video
3. If latency is acceptable (~150-200ms), rebuild bankbot with motor control
4. If sub-100ms latency needed, consider native app approach (see research/latency-approaches.md)
