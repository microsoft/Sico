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
