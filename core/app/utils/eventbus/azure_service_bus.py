import os

from azure.identity.aio import DefaultAzureCredential
from azure.servicebus import ServiceBusMessage
from azure.servicebus.aio import ServiceBusClient, ServiceBusSender

from .eventbus import EventBus, EventBusSender


class AzureServiceBusSender(EventBusSender):

    def __init__(self, sender: ServiceBusSender):
        super().__init__()
        self._sender = sender

    async def send(self, payload: bytes):
        message = ServiceBusMessage(payload)
        message.session_id = "default-session"  # Ensure the message is sent to a session-enabled subscription
        await self._sender.send_messages(message)

class AzureServiceBus(EventBus):

    def __init__(self):
        super().__init__()
        credential = DefaultAzureCredential()
        namespace = os.getenv("AZURE_SERVICE_BUS_NAMESPACE")
        self._client = ServiceBusClient(
            fully_qualified_namespace=namespace,
            credential=credential
        )

    def get_topic_sender(self, topic: str) -> EventBusSender:
        sender = self._client.get_topic_sender(topic_name=topic)
        return AzureServiceBusSender(sender)
