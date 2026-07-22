/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// 16 MiB cap. Reject when `file.size >` this, so exactly 16 MiB passes.
// User-facing copy rounds to "16 MB" (collab.composer.file.tooLarge).
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

// Shared failure copy for a turn that errored / truncated — raised by both the
// live-send path (chat.ts) and the reconnect settle path (use-reconnect), so the
// user sees the same message whichever transport observed the failure.
export const SEND_FAILED_COPY = "Something went wrong. Try sending again.";

// The `AbortController.abort(reason)` sentinel for the live-send→reconnect
// hand-off. When recovery aborts a dead live-send stream to resume the turn over
// the reconnect transport, it passes THIS reason so `sendMessage` (chat.ts) can
// tell a hand-off abort (leave the turn `streaming` for reconnect) from a user
// Stop (settle the turn `done`). A module `Symbol`, not a string: `abort(reason)`
// keeps the reference intact, and a unique Symbol can never collide with some
// other caller's `abort("...")` the way a magic string could. Shared here (like
// SEND_FAILED_COPY) so neither orchestrator imports the other.
export const HANDOFF_ABORT_REASON = Symbol("reconnect-handoff");

// Placeholder title the backend returns from `POST /conversation` before it has
// asynchronously generated a real title from the first message. The sidebar
// polls `GET /conversation?id=` while a row still reads this, and stops as soon
// as the fetched title differs — so this doubles as both the "still pending"
// marker and the comparison baseline.
export const CONVERSATION_TITLE_PENDING = "New Session";

// Title polling cadence: every 2s, capped at 30 attempts (2s × 30 = 1min). The
// cap is a hard stop so a conversation whose title never generates (or an
// endpoint that keeps erroring) stops hitting the backend instead of polling
// forever (mirrors the skill-status poll bound).
export const CONVERSATION_TITLE_POLL_INTERVAL_MS = 2000;
export const CONVERSATION_TITLE_POLL_MAX_ATTEMPTS = 30;
