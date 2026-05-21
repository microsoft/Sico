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

"""High-level helper for OpenAI Computer Use (Responses API).

Usage::

    from app.llmhubs import LLMHub
    from app.llmhubs.computer_use import ComputerUseSession

    hub = LLMHub()
    session = ComputerUseSession(hub, model="gpt-5.4")

    response = await session.start("Open Notepad and type hello")
    while True:
        call = session.get_computer_call(response)
        if call is None:
            break                           # model is done
        handle_actions(call.actions)         # execute click/type/scroll …
        screenshot_b64 = take_screenshot()   # capture screen
        response = await session.send_screenshot(call.call_id, screenshot_b64)

    print(response.text)
"""

from __future__ import annotations

from typing import Any

from app.llmhubs.hub import LLMHub
from app.llmhubs.types import (
    Input,
    InputContent,
    OutputItem,
    Request,
    Response,
)


class ComputerUseSession:
    """Manages a stateful computer-use conversation via the Responses API.

    Each ``start()`` begins a new conversation.  Subsequent
    ``send_screenshot()`` calls reference the previous response ID so the
    model retains full context without re-sending the conversation history.
    """

    def __init__(
        self,
        hub: LLMHub,
        model: str,
        *,
        tools: list[dict[str, Any]] | None = None,
        extra_options: dict[str, Any] | None = None,
    ) -> None:
        self._hub = hub
        self._model = model
        self._tools = tools or [{"type": "computer"}]
        self._extra_options = extra_options or {}
        self._previous_response_id: str = ""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self, prompt: str) -> Response:
        """Begin a new computer-use session with *prompt*."""
        request = Request(
            model=self._model,
            tools=self._tools,
            inputs=[Input(role="user", content=[InputContent(type="text", text=prompt)])],
            options=dict(self._extra_options),
        )
        response = await self._hub.generate(request)
        self._previous_response_id = response.payload.get("id", "")
        return response

    async def send_screenshot(
        self,
        call_id: str,
        screenshot_base64: str,
        *,
        detail: str = "auto",
        media_type: str = "image/png",
    ) -> Response:
        """Send a screenshot in reply to a ``computer_call`` and get
        the next model response.

        Parameters
        ----------
        call_id:
            The ``call_id`` from the ``computer_call`` output item.
        screenshot_base64:
            Base-64 encoded screenshot image.
        detail:
            Image detail level (``"auto"``, ``"low"``, ``"high"``, ``"original"``).
        media_type:
            MIME type of the screenshot (default ``image/png``).
        """
        output_data: dict[str, Any] = {
            "type": "computer_screenshot",
            "image_url": f"data:{media_type};base64,{screenshot_base64}",
        }
        if detail != "auto":
            output_data["detail"] = detail

        request = Request(
            model=self._model,
            tools=self._tools,
            previous_response_id=self._previous_response_id,
            inputs=[Input(role="user", content=[
                InputContent(
                    type="computer_call_output",
                    call_id=call_id,
                    output=output_data,
                ),
            ])],
            options=dict(self._extra_options),
        )
        response = await self._hub.generate(request)
        self._previous_response_id = response.payload.get("id", "")
        return response

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def get_computer_call(response: Response) -> OutputItem | None:
        """Extract the first ``computer_call`` from *response*, or ``None``."""
        for output in response.outputs:
            if output.type == "computer_call":
                return output
        return None

    @property
    def previous_response_id(self) -> str:
        """The ID of the last response — useful for manual continuation."""
        return self._previous_response_id
