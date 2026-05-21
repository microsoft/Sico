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
