"""In-process event bus feeding the browser WebSocket (/ws/events).

Each event is {boot_id, sequence, type, occurred_at, payload}. Sequences are
monotonic within one server boot; a reconnecting client that sees a new boot_id
(or a sequence gap) must re-fetch authoritative REST state. Unreal does not use
this; it polls /api/simulation/state.
"""

import asyncio
import itertools
import threading
import uuid
from typing import Any

from .clock import utc_iso

SUBSCRIBER_QUEUE_LIMIT = 200


class EventBus:
    def __init__(self, clock):
        self.clock = clock
        self.boot_id = uuid.uuid4().hex
        self._seq = itertools.count(1)
        self._lock = threading.Lock()
        self._subscribers: set["Subscription"] = set()
        self._revision = 0
        self.last_sequence = 0

    # Revision: bumps on every published state change; exposed in the snapshot.
    @property
    def revision(self) -> int:
        return self._revision

    def bump_revision(self) -> int:
        with self._lock:
            self._revision += 1
            return self._revision

    def publish(self, type_: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._revision += 1
            seq = next(self._seq)
            self.last_sequence = seq
            event = {
                "boot_id": self.boot_id,
                "sequence": seq,
                "type": type_,
                "occurred_at": utc_iso(self.clock.now()),
                "payload": payload,
            }
            subscribers = list(self._subscribers)
        for sub in subscribers:
            sub.deliver(event)
        return event

    def subscribe(self, loop: asyncio.AbstractEventLoop) -> "Subscription":
        sub = Subscription(self, loop)
        with self._lock:
            self._subscribers.add(sub)
        return sub

    def unsubscribe(self, sub: "Subscription") -> None:
        with self._lock:
            self._subscribers.discard(sub)


class Subscription:
    def __init__(self, bus: EventBus, loop: asyncio.AbstractEventLoop):
        self.bus = bus
        self.loop = loop
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_LIMIT)
        self.overflowed = False

    def deliver(self, event: dict) -> None:
        def put():
            if self.overflowed:
                return
            try:
                self.queue.put_nowait(event)
            except asyncio.QueueFull:
                # Slow client: drop it; it reconnects and re-fetches REST state.
                self.overflowed = True

        try:
            self.loop.call_soon_threadsafe(put)
        except RuntimeError:
            pass  # loop closed
