# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import os

class EventBusSender:

    async def send(self, payload: bytes):
        raise NotImplementedError("send must be implemented by subclasses")

class EventBus:
    _instance: 'EventBus' = None

    @staticmethod
    def get_instance() -> 'EventBus':
        if EventBus._instance is None:
            event_bus_type = os.getenv("EVENT_BUS_TYPE", "kafka")
            if event_bus_type == "azure_service_bus":
                from .azure_service_bus import AzureServiceBus
                EventBus._instance = AzureServiceBus()
            elif event_bus_type == "kafka":
                from .kafka import KafkaEventBus
                EventBus._instance = KafkaEventBus()
            else:
                raise ValueError(f"Unsupported EVENT_BUS_TYPE: {event_bus_type}")
        return EventBus._instance

    def get_topic_sender(self, topic: str) -> 'EventBusSender':
        raise NotImplementedError("get_topic_sender must be implemented by subclasses")
