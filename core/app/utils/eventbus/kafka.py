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

import asyncio
import os

from kafka import KafkaProducer

from .eventbus import EventBus, EventBusSender


class KafkaEventBusSender(EventBusSender):

    def __init__(self, topic: str, producer: KafkaProducer):
        super().__init__()
        self._topic = topic
        self._producer = producer

    def _send_blocking(self, payload: bytes):
        future = self._producer.send(
            topic=self._topic,
            value=payload,
        )
        return future.get(timeout=10)

    async def send(self, payload: bytes):
        # kafka-python send/get is blocking, so move it off the event loop.
        await asyncio.to_thread(self._send_blocking, payload)

class KafkaEventBus(EventBus):

    def __init__(self):
        super().__init__()
        broker_servers = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9094").split(";")
        self._producer = KafkaProducer(
            bootstrap_servers=broker_servers,
        )

    def get_topic_sender(self, topic: str) -> EventBusSender:
        return KafkaEventBusSender(topic, self._producer)
