# Shopping List

## Required

### Camera
- **Raspberry Pi Camera Module 3 Wide** (~$35)
  - 120° diagonal field of view (~105° horizontal)
  - 12MP IMX708 sensor with HDR and autofocus
  - Official Pi camera = best driver support with libcamera and pi-webrtc
  - [Product page](https://www.raspberrypi.com/products/camera-module-3/)

### Camera Cable
- **Check existing ribbon cables** — CSI cables come in different lengths and connector sizes
  - Pi 4 uses a 15-pin connector (standard size)
  - Pi Zero uses a 22-pin connector (smaller)
  - Make sure the cable is CSI, not DSI (display)

## Optional

### Upgraded Pi
- **Raspberry Pi 4 (2GB or 4GB RAM)** (~$45-55)
  - Current 1GB Pi 4 should work for single-stream 720p
  - More RAM provides headroom if we add other processes later
  - Still Pi 4, not Pi 5 — Pi 4 has hardware H.264 encoding, Pi 5 does not

## Already Have
- Raspberry Pi 4 (1GB RAM)
- Battery bank (for power)
- USB cables (for power)
- Ribbon cables (verify compatibility — see note above)

## Future Considerations (Not Needed Yet)

### Motor Control
- Motor driver board (L298N, TB6612, or similar)
- DC motors or servos (depends on robot chassis)
- Robot chassis/platform

### Networking
- MQTT broker account (HiveMQ or EMQX free tier) — free, no purchase needed
- TURN server (Metered.ca free tier has 500MB/month) — free for testing

### Audio (if needed later)
- USB microphone
- Small speaker with amp
