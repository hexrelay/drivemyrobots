#!/usr/bin/env python3
"""
LED Feedback Prototype for Drive My Robots.

Streams camera via rpicam-vid to RTSP relay and controls Blinkt LEDs based on remote input.
"""

import asyncio
import subprocess
import json
import blinkt

# Configuration
RTSP_URL = "rtsp://198.199.80.228:8554/robot1"
SERVER_IP = "198.199.80.228"
GREETING_PORT = 4546
BOT_ID = "robot1"

# LED colors for keys 1-8
LED_COLORS = [
    (255, 0, 0),      # 1: Red
    (255, 127, 0),    # 2: Orange
    (255, 255, 0),    # 3: Yellow
    (0, 255, 0),      # 4: Green
    (0, 255, 255),    # 5: Cyan
    (0, 0, 255),      # 6: Blue
    (127, 0, 255),    # 7: Purple
    (255, 0, 255),    # 8: Magenta
]

# Initialize Blinkt
blinkt.set_clear_on_exit(True)
blinkt.set_brightness(0.2)


def set_led(led_index, color):
    """Set a specific LED to a color."""
    r, g, b = color
    blinkt.set_pixel(led_index, r, g, b)
    blinkt.show()
    print(f"LED {led_index} set to RGB({r}, {g}, {b})")


def clear_all_leds():
    """Turn off all LEDs."""
    blinkt.clear()
    blinkt.show()


def all_leds_color(color):
    """Set all LEDs to the same color."""
    r, g, b = color
    for i in range(8):
        blinkt.set_pixel(i, r, g, b)
    blinkt.show()
    print(f"All LEDs set to RGB({r}, {g}, {b})")


class InputClient(asyncio.Protocol):
    def __init__(self, loop):
        self.loop = loop
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport
        print("Connected to relay server for input reception")
        # Flash green to indicate connection
        all_leds_color((0, 255, 0))
        self.loop.call_later(0.5, clear_all_leds)

    def data_received(self, data):
        try:
            input_state = json.loads(data.decode())
            print(f"Received input: {input_state}")

            # Handle color from frontend (hex color like '#ff0000')
            if 'color' in input_state:
                color_hex = input_state['color'].lstrip('#')
                r = int(color_hex[0:2], 16)
                g = int(color_hex[2:4], 16)
                b = int(color_hex[4:6], 16)
                all_leds_color((r, g, b))

            # Handle color key (1-8) as alternative
            if 'color_key' in input_state:
                key = input_state['color_key']
                if 1 <= key <= 8:
                    color = LED_COLORS[key - 1]
                    all_leds_color(color)

            # Handle individual LED control
            if 'led' in input_state:
                led_index = input_state['led']
                color_hex = input_state.get('led_color', '#ffffff').lstrip('#')
                r = int(color_hex[0:2], 16)
                g = int(color_hex[2:4], 16)
                b = int(color_hex[4:6], 16)
                if 0 <= led_index < 8:
                    set_led(led_index, (r, g, b))

            # Handle clear command
            if input_state.get('clear'):
                clear_all_leds()

        except Exception as e:
            print(f"Error processing input: {e}")

    def connection_lost(self, exc):
        print("Connection to relay server lost, will retry...")
        # Flash red to indicate disconnection
        all_leds_color((255, 0, 0))
        self.loop.call_later(1, lambda: asyncio.ensure_future(connect_to_server(self.loop)))


class GreetingClient(asyncio.Protocol):
    def __init__(self, loop, bot_id):
        self.loop = loop
        self.bot_id = bot_id
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport
        self.transport.write(self.bot_id.encode())
        print(f"Sent greeting as {self.bot_id}")

    def data_received(self, data):
        message = data.decode().strip()
        assigned_port = int(message)
        print(f"Received assigned port: {assigned_port}")
        self.transport.close()
        self.loop.call_later(0.5, lambda: asyncio.ensure_future(self.connect_to_dedicated_port(assigned_port)))

    async def connect_to_dedicated_port(self, port):
        try:
            transport, protocol = await self.loop.create_connection(
                lambda: InputClient(self.loop),
                SERVER_IP,
                port
            )
            print(f"Connected to dedicated port {port}")
        except Exception as e:
            print(f"Failed to connect to dedicated port: {e}")
            # Retry connection
            await asyncio.sleep(5)
            await connect_to_server(self.loop)


async def connect_to_server(loop):
    """Connect to the relay server."""
    while True:
        try:
            transport, protocol = await loop.create_connection(
                lambda: GreetingClient(loop, BOT_ID),
                SERVER_IP,
                GREETING_PORT
            )
            print(f"Connected to greeting server at {SERVER_IP}:{GREETING_PORT}")
            return
        except Exception as e:
            print(f"Failed to connect to server: {e}, retrying in 5s...")
            await asyncio.sleep(5)


def start_camera_stream():
    """Start rpicam-vid streaming to RTSP server."""
    cmd = [
        'rpicam-vid',
        '-t', '0',              # Run indefinitely
        '--width', '640',
        '--height', '480',
        '--framerate', '30',
        '--codec', 'h264',
        '--profile', 'baseline',
        '--level', '4.2',
        '--intra', '15',        # Keyframe every 15 frames
        '--inline',             # Inline headers
        '-o', '-',              # Output to stdout
    ]

    ffmpeg_cmd = [
        'ffmpeg',
        '-f', 'h264',
        '-i', '-',
        '-c:v', 'copy',         # Don't re-encode, just pass through
        '-f', 'rtsp',
        '-rtsp_transport', 'tcp',
        RTSP_URL
    ]

    print("Starting camera stream pipeline...")
    print(f"  rpicam-vid -> ffmpeg -> {RTSP_URL}")

    # Pipe rpicam-vid to ffmpeg
    rpicam = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    ffmpeg = subprocess.Popen(ffmpeg_cmd, stdin=rpicam.stdout, stderr=subprocess.DEVNULL)

    return rpicam, ffmpeg


async def main():
    loop = asyncio.get_event_loop()

    # Start camera streaming in background
    rpicam, ffmpeg = start_camera_stream()

    # Connect to relay server
    await connect_to_server(loop)

    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")
        rpicam.terminate()
        ffmpeg.terminate()
        clear_all_leds()


if __name__ == '__main__':
    asyncio.run(main())
