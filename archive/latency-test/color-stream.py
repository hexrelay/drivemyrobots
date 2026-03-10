#!/usr/bin/env python3
"""
Generates a video stream with a bouncing basketball that changes color based on remote input.
Uses Pillow for simple image compositing.
"""

import asyncio
import subprocess
import json
import time
from PIL import Image
import os

# Configuration
WIDTH = 640
HEIGHT = 480
FPS = 30
RTSP_URL = "rtsp://198.199.80.228:8554/robot1"
SERVER_IP = "198.199.80.228"
GREETING_PORT = 4546
BOT_ID = "robot1"

# Ball state
ball_x = float(WIDTH // 2)
ball_y = float(HEIGHT // 2)
ball_vx = 6.0
ball_vy = 4.0

# Current color (shared state)
current_color = (255, 0, 0)

# Direction input (shared state) - None means no input, ball coasts
current_direction = None

# Load basketball image
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
basketball_original = Image.open(os.path.join(SCRIPT_DIR, "basketball.png")).convert("RGBA")
# Scale to reasonable size (60px diameter)
BALL_SIZE = 60
basketball_original = basketball_original.resize((BALL_SIZE, BALL_SIZE), Image.LANCZOS)


class InputClient(asyncio.Protocol):
    def __init__(self, loop):
        self.loop = loop
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport
        print("Connected to relay server for input reception")

    def data_received(self, data):
        global current_color, current_direction
        try:
            input_state = json.loads(data.decode())
            if 'color' in input_state:
                color_hex = input_state['color'].lstrip('#')
                r = int(color_hex[0:2], 16)
                g = int(color_hex[2:4], 16)
                b = int(color_hex[4:6], 16)
                new_color = (r, g, b)
                if new_color != current_color:
                    current_color = new_color
                    print(f"Color changed to: #{color_hex}")
            if 'direction' in input_state:
                current_direction = input_state['direction']
                print(f"Direction: {current_direction}")
        except Exception as e:
            print(f"Error processing input: {e}")

    def connection_lost(self, exc):
        print("Connection to relay server lost")
        self.loop.stop()


class GreetingClient(asyncio.Protocol):
    def __init__(self, loop, bot_id):
        self.loop = loop
        self.bot_id = bot_id
        self.transport = None
        self.assigned_port = None

    def connection_made(self, transport):
        self.transport = transport
        self.transport.write(self.bot_id.encode())
        print(f"Sent greeting as {self.bot_id}")

    def data_received(self, data):
        message = data.decode().strip()
        self.assigned_port = int(message)
        print(f"Received assigned port: {self.assigned_port}")
        self.transport.close()
        self.loop.call_later(0.5, lambda: asyncio.ensure_future(self.connect_to_dedicated_port()))

    async def connect_to_dedicated_port(self):
        try:
            transport, protocol = await self.loop.create_connection(
                lambda: InputClient(self.loop),
                SERVER_IP,
                self.assigned_port
            )
            print(f"Connected to dedicated port {self.assigned_port}")
        except Exception as e:
            print(f"Failed to connect to dedicated port: {e}")


def generate_frames(pipe):
    """Generate raw video frames with bouncing basketball."""
    global ball_x, ball_y, ball_vx, ball_vy, current_direction

    frame_duration = 1.0 / FPS
    bg_color = (20, 20, 30)
    SPEED = 8.0

    while True:
        start_time = time.time()

        # Apply direction input
        if current_direction == 'up':
            ball_vy = -SPEED
            ball_vx = 0
        elif current_direction == 'down':
            ball_vy = SPEED
            ball_vx = 0
        elif current_direction == 'left':
            ball_vx = -SPEED
            ball_vy = 0
        elif current_direction == 'right':
            ball_vx = SPEED
            ball_vy = 0
        # Clear direction after applying (single press = single movement burst)
        current_direction = None

        # Update ball position
        ball_x += ball_vx
        ball_y += ball_vy

        # Apply friction so ball slows down
        ball_vx *= 0.95
        ball_vy *= 0.95

        # Stop if very slow
        if abs(ball_vx) < 0.1:
            ball_vx = 0
        if abs(ball_vy) < 0.1:
            ball_vy = 0

        # Bounce off walls
        half = BALL_SIZE // 2
        if ball_x - half <= 0:
            ball_x = half
            ball_vx = -ball_vx * 0.5
        if ball_x + half >= WIDTH:
            ball_x = WIDTH - half
            ball_vx = -ball_vx * 0.5
        if ball_y - half <= 0:
            ball_y = half
            ball_vy = -ball_vy * 0.5
        if ball_y + half >= HEIGHT:
            ball_y = HEIGHT - half
            ball_vy = -ball_vy * 0.5

        # Create frame with background
        frame = Image.new("RGB", (WIDTH, HEIGHT), bg_color)

        # Tint the basketball with current color
        # Blend the basketball with the current color
        tinted = Image.new("RGBA", (BALL_SIZE, BALL_SIZE), current_color + (255,))
        tinted.putalpha(basketball_original.split()[3])  # Use original alpha
        # Blend: 50% original, 50% tint
        blended = Image.blend(basketball_original.convert("RGBA"), tinted, 0.5)

        # Paste basketball at current position
        pos_x = int(ball_x) - half
        pos_y = int(ball_y) - half
        frame.paste(blended.convert("RGB"), (pos_x, pos_y), blended.split()[3])

        # Write frame
        try:
            pipe.write(frame.tobytes())
            pipe.flush()
        except BrokenPipeError:
            print("Pipe broken, exiting")
            break

        # Maintain frame rate
        elapsed = time.time() - start_time
        sleep_time = frame_duration - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)


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


def main():
    # Start ffmpeg process
    ffmpeg_cmd = [
        'ffmpeg',
        '-f', 'rawvideo',
        '-pixel_format', 'rgb24',
        '-video_size', f'{WIDTH}x{HEIGHT}',
        '-framerate', str(FPS),
        '-i', '-',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-g', '15',
        '-f', 'rtsp',
        '-rtsp_transport', 'tcp',
        RTSP_URL
    ]

    print("Starting ffmpeg...")
    ffmpeg = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stderr=subprocess.DEVNULL
    )

    # Run network client in separate thread
    import threading

    def run_network():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(connect_to_server(loop))
        loop.run_forever()

    network_thread = threading.Thread(target=run_network, daemon=True)
    network_thread.start()

    # Generate frames in main thread
    try:
        generate_frames(ffmpeg.stdin)
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        ffmpeg.stdin.close()
        ffmpeg.wait()


if __name__ == '__main__':
    main()
