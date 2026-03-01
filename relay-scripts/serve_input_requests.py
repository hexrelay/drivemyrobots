#!/usr/bin/env python3
"""
Input relay server for Drive My Robots.

Architecture:
- Pi connects via TCP, stays connected
- Browser POSTs input changes via HTTP
- Relay immediately pushes to connected Pi(s)
- input_state.json persists state for restarts/multi-bot

No polling - instant push on input change.
"""

import asyncio
import sys
import json
import os
from collections import defaultdict
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

# Configuration
BIND_IP = "0.0.0.0"
GREETING_PORT = 4546
DEDICATED_PORT_BASE = 50000
HTTP_PORT = 8080
INPUT_STATE_FILE = "/opt/dmr/input_state.json"

next_port = DEDICATED_PORT_BASE
active_connections = defaultdict(dict)  # bot_id -> {"transport": ..., "handler": ...}
async_loop = None  # Will be set in main()

# Ensure input state file exists
os.makedirs(os.path.dirname(INPUT_STATE_FILE), exist_ok=True)
if not os.path.exists(INPUT_STATE_FILE):
    with open(INPUT_STATE_FILE, 'w') as f:
        json.dump({}, f)


def push_to_bot(bot_id, state):
    """Push state to a specific bot immediately."""
    if bot_id in active_connections:
        transport = active_connections[bot_id].get("transport")
        if transport:
            try:
                json_str = json.dumps(state)
                transport.write(json_str.encode())
                return True
            except Exception as e:
                print(f"Error pushing to bot {bot_id}: {e}")
    return False


def push_to_all_bots(full_state):
    """Push relevant state to all connected bots."""
    for bot_id in active_connections:
        bot_state = full_state.get(bot_id, {})
        push_to_bot(bot_id, bot_state)


class GreetingHandler(asyncio.Protocol):
    def __init__(self, loop):
        self.loop = loop

    def connection_made(self, transport):
        self.transport = transport

    def data_received(self, data):
        bot_id = data.decode().strip()
        print(f"Greeting received from bot: {bot_id}")

        global next_port
        assigned_port = next_port
        next_port += 1

        # Start a dedicated server for this bot
        asyncio.ensure_future(self.loop.create_server(
            lambda bid=bot_id: DedicatedHandler(self.loop, bid),
            BIND_IP,
            assigned_port
        ))

        # Confirm to the bot that the port is ready
        self.transport.write(f"{assigned_port}".encode())
        print(f"Dedicated port {assigned_port} assigned to bot {bot_id}")
        self.transport.close()


class DedicatedHandler(asyncio.Protocol):
    def __init__(self, loop, bot_id):
        self.loop = loop
        self.bot_id = bot_id
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport
        active_connections[self.bot_id]["transport"] = transport
        active_connections[self.bot_id]["handler"] = self
        print(f"Connection established with bot: {self.bot_id}")

        # Send current state immediately on connect
        try:
            with open(INPUT_STATE_FILE, 'r') as f:
                input_state = json.load(f)
            bot_state = input_state.get(self.bot_id, {})
            self.transport.write(json.dumps(bot_state).encode())
        except Exception as e:
            print(f"Error sending initial state to {self.bot_id}: {e}")

    def connection_lost(self, exc):
        print(f"Connection lost with bot {self.bot_id}")
        active_connections.pop(self.bot_id, None)

    def data_received(self, data):
        print(f"Received from bot {self.bot_id}: {data.decode()}")


class HTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"HTTP: {args[0]}")

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == '/input_state':
            try:
                with open(INPUT_STATE_FILE, 'r') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(data.encode())
            except Exception as e:
                self.send_response(500)
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        elif self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'healthy',
                'connected_bots': list(active_connections.keys())
            }).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/input_state':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                new_state = json.loads(body)

                # Read existing state and merge
                try:
                    with open(INPUT_STATE_FILE, 'r') as f:
                        current_state = json.load(f)
                except:
                    current_state = {}

                # Update with new values
                for bot_id, bot_state in new_state.items():
                    if bot_id not in current_state:
                        current_state[bot_id] = {}
                    current_state[bot_id].update(bot_state)

                # Write to file (for persistence)
                with open(INPUT_STATE_FILE, 'w') as f:
                    json.dump(current_state, f, indent=2)

                # IMMEDIATELY push to connected bots
                pushed_to = []
                for bot_id in new_state.keys():
                    bot_state = current_state.get(bot_id, {})
                    if push_to_bot(bot_id, bot_state):
                        pushed_to.append(bot_id)

                print(f"Input state updated, pushed to: {pushed_to}")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({
                    'status': 'ok',
                    'pushed_to': pushed_to,
                    'state': current_state
                }).encode())

            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        else:
            self.send_response(404)
            self.end_headers()


def run_http_server():
    server = HTTPServer((BIND_IP, HTTP_PORT), HTTPHandler)
    print(f"HTTP server listening on {BIND_IP}:{HTTP_PORT}")
    server.serve_forever()


async def main():
    global async_loop
    async_loop = asyncio.get_event_loop()

    # Start HTTP server in background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()

    # Start greeting server
    server = await async_loop.create_server(
        lambda: GreetingHandler(async_loop),
        BIND_IP,
        GREETING_PORT
    )
    print(f"Greeting server listening on {BIND_IP}:{GREETING_PORT}")
    await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
