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
