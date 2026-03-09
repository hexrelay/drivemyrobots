#!/usr/bin/env python3
"""
LED Control for Drive My Robots.

Connects to relay server and controls Blinkt LEDs based on input_state.
Video streaming is handled separately by GStreamer.
"""

import asyncio
import json
import blinkt

# Configuration
SERVER_IP = "198.199.80.228"
GREETING_PORT = 4546
BOT_ID = "robot1"

# Initialize Blinkt
blinkt.set_clear_on_exit(True)
blinkt.set_brightness(0.5)


def all_leds_color(r, g, b):
    """Set all LEDs to the same color."""
    for i in range(8):
        blinkt.set_pixel(i, r, g, b)
    blinkt.show()
    print(f"All LEDs set to RGB({r}, {g}, {b})")


def clear_all_leds():
    """Turn off all LEDs."""
    blinkt.clear()
    blinkt.show()
    print("LEDs cleared")


def hex_to_rgb(hex_color):
    """Convert hex color string to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return r, g, b


class InputClient(asyncio.Protocol):
    def __init__(self, loop):
        self.loop = loop
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport
        print("Connected to relay server")
        # Flash green to indicate connection
        all_leds_color(0, 255, 0)
        self.loop.call_later(0.5, clear_all_leds)

    def data_received(self, data):
        try:
            input_state = json.loads(data.decode())
            print(f"Received: {input_state}")

            # Handle color from frontend (hex color like '#ff0000')
            if 'color' in input_state:
                r, g, b = hex_to_rgb(input_state['color'])
                all_leds_color(r, g, b)

            # Handle clear command
            if input_state.get('clear'):
                clear_all_leds()

        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
        except Exception as e:
            print(f"Error processing input: {e}")

    def connection_lost(self, exc):
        print("Connection lost, will retry...")
        # Flash red to indicate disconnection
        all_leds_color(255, 0, 0)
        self.loop.call_later(2, lambda: asyncio.ensure_future(connect_to_server(self.loop)))


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
        assigned_port = int(data.decode().strip())
        print(f"Assigned port: {assigned_port}")
        self.transport.close()
        self.loop.call_later(0.5, lambda: asyncio.ensure_future(
            self.connect_to_dedicated_port(assigned_port)
        ))

    async def connect_to_dedicated_port(self, port):
        try:
            await self.loop.create_connection(
                lambda: InputClient(self.loop),
                SERVER_IP,
                port
            )
            print(f"Connected to dedicated port {port}")
        except Exception as e:
            print(f"Failed to connect to dedicated port: {e}")
            await asyncio.sleep(5)
            await connect_to_server(self.loop)


async def connect_to_server(loop):
    """Connect to the relay server."""
    while True:
        try:
            await loop.create_connection(
                lambda: GreetingClient(loop, BOT_ID),
                SERVER_IP,
                GREETING_PORT
            )
            print(f"Connected to {SERVER_IP}:{GREETING_PORT}")
            return
        except Exception as e:
            print(f"Connection failed: {e}, retrying in 5s...")
            await asyncio.sleep(5)


async def main():
    loop = asyncio.get_event_loop()

    print("LED Control starting...")
    print(f"Connecting to relay at {SERVER_IP}:{GREETING_PORT}")

    await connect_to_server(loop)

    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down...")
        clear_all_leds()


if __name__ == '__main__':
    asyncio.run(main())
