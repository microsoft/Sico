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

"""Built-in subscribers for the task runtime event bus.

Each subscriber lives in its own module and exposes a ``register(bus)``
function that wires its handler(s) onto a :class:`RuntimeEventBus`. The
top-level :func:`register_default_subscribers` registers every built-in
subscriber against the supplied bus (or the process-wide default).

Adding a new subscriber:

1. Create ``subscribers/<name>.py`` with a module-level
   ``register(bus: RuntimeEventBus) -> Unsubscribe`` function. Keep the
   handler self-contained — no cross-subscriber state.
2. Import it from :func:`register_default_subscribers` and append the
   returned unsubscribe to the list.
3. Add a focused test module under
   ``core/tests/task_runtime/test_subscribers_<name>.py`` that drives a
   freshly-constructed :class:`RuntimeEventBus` instance (do not touch the
   module-level default — keeps tests isolated).

Subscriber contract:

* Handlers MUST NOT raise. The bus catches and logs exceptions, but a
  subscriber that always blows up is a bug.
* Handlers MUST be cheap and non-blocking. Long-running work belongs in a
  background task spawned by the handler, never inline.
* Handlers MAY ignore self-transitions (``from_status == to_status``) if
  they only care about real state changes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from . import audit_log, metrics

if TYPE_CHECKING:
    from ..event_bus import RuntimeEventBus, Unsubscribe

__all__ = [
    "audit_log",
    "metrics",
    "register_default_subscribers",
]


def register_default_subscribers(bus: "RuntimeEventBus | None" = None) -> list["Unsubscribe"]:
    """Register every built-in subscriber against ``bus``.

    When ``bus`` is ``None`` the process-wide default bus is used. Returns
    the list of unsubscribe callbacks in registration order; production
    callers typically discard them, but tests can use them to tear down.
    """

    from ..event_bus import get_default_bus

    target = bus if bus is not None else get_default_bus()
    return [
        audit_log.register(target),
        metrics.register(target),
    ]
