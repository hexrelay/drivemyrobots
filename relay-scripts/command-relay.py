#!/usr/bin/env python3
"""
Simple command relay server that runs on the droplet.
- Accepts POST /command from the web frontend
- Stores the latest command
- Pi polls GET /command to retrieve it
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading
import time

# Latest command (thread-safe)
latest_command = None
command_lock = threading.Lock()
command_timestamp = 0

class RelayHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"{time.strftime('%H:%M:%S')} - {args[0]}")

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_POST(self):
        global latest_command, command_timestamp

        if self.path == '/command':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                data = json.loads(body)
                with command_lock:
                    latest_command = data
                    command_timestamp = time.time()

                print(f"Received command: {data}")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok'}).encode())
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        global latest_command, command_timestamp

        if self.path == '/command':
            # Pi polls this endpoint
            with command_lock:
                if latest_command:
                    cmd = latest_command
                    ts = command_timestamp
                    latest_command = None  # Clear after reading
                else:
                    cmd = None
                    ts = 0

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()

            if cmd:
                self.wfile.write(json.dumps({
                    'command': cmd,
                    'timestamp': ts
                }).encode())
            else:
                self.wfile.write(json.dumps({'command': None}).encode())

        elif self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'healthy'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

def main():
    server = HTTPServer(('0.0.0.0', 8080), RelayHandler)
    print("Command relay server listening on port 8080")
    server.serve_forever()

if __name__ == '__main__':
    main()
