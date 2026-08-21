from .eventbus import EventBus, EventBusSender


class MockEventBusSender(EventBusSender):

    def __init__(self, topic: str):
        super().__init__()
        self.topic = topic
        self.sent_messages = []

    async def send(self, payload: bytes):
        self.sent_messages.append(payload)

class MockEventBus(EventBus):

    def __init__(self):
        super().__init__()
        self.senders = {}

    def get_topic_sender(self, topic: str) -> EventBusSender:
        if topic not in self.senders:
            self.senders[topic] = MockEventBusSender(topic)
        return self.senders[topic]
