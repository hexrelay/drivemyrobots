import asyncio
import time
import sys
import json
import bot_driver

serverIP = sys.argv[1]
greetingPort = int(sys.argv[2])

class GreetingClient(asyncio.Protocol):
    def __init__(self, loop, botID):
        self.loop = loop
        self.botID = botID
        self.transport = None
        self.assignedPort = None

    def connection_made(self, transport):
        self.transport = transport
        self.transport.write(self.botID.encode())

    def data_received(self, data):
        message = data.decode().strip()
        self.assignedPort = int(message)
        print(f"Received assigned port: {self.assignedPort}")
        self.transport.close()
        time.sleep(0.5)
        self.loop.create_task(self.connect_to_dedicated_port())

    async def connect_to_dedicated_port(self):
        try:
            transport, protocol = await self.loop.create_connection(
                lambda: DedicatedClient(self.loop),
                serverIP,
                self.assignedPort
            )
            print(f"Connected to server on port {self.assignedPort}")
        except Exception as e:
            print(f"Failed to connect to server on port {self.assignedPort}: {e}")


class DedicatedClient(asyncio.Protocol):
    def __init__(self, loop):
        self.loop = loop
        self.transport = None
        self.exiting = False
        self.lastCommandReceivedTime = 0

    def connection_made(self, transport):
        self.transport = transport
        print("Connected to server for input reception")
        self.loop.call_soon(self.runBotForever)

    def data_received(self, data):
        try:
            input_state = json.loads(data.decode())
            # print(f"Received input state: {input_state}")
            bot_driver.enactInput(input_state)
        except Exception as e:
            print(f"Error processing received input: {e}")
    
    def runBotForever(self):
        if self.lastCommandReceivedTime + 1 > time.time(): # TODO: not sure why we have a 1 second built in arbitrary lag here lol
            if self.inputState:
                bot_driver.enactInput(self.inputState)
        if not self.exiting:
            self.loop.call_soon(self.runBotForever)

    def connection_lost(self, exc):
        print("Connection to server lost")
        bot_driver.close()
        self.exiting = True
        self.loop.stop()  # Stop the loop when the connection is lost


def main():
    bot_driver.setup()
    botID = bot_driver.botID

    loop = asyncio.get_event_loop()

    connection = loop.create_connection(
        lambda: GreetingClient(loop, botID),
        serverIP,
        greetingPort
    )

    transport, protocol = loop.run_until_complete(connection)

    loop.run_forever()
    transport.close()
    loop.close()

    asyncio.run(main())

if __name__ == "__main__":
    asyncio.run(main())

