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

import { toast } from "@sico/ui";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { z } from "zod";

// Take-over auto-exits after 5 min of no pointer/keyboard activity (legacy
// TAKE_OVER_IDLE_TIMEOUT) so a forgotten session releases the device.
const TAKE_OVER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// Toast on every exit path (button / idle timeout / device switch), matching
// legacy's `infoNotify` so the user knows control was released.
const EXIT_COPY = "Take over ended. Device is now view-only.";

// An in-frame activity ping from the (future) cross-origin VNC page. `message`
// is an untrusted boundary (security.md), so parse `event.data` with zod rather
// than hand-narrowing — extra fields are ignored; only the discriminant gates.
const activityMessageSchema = z.object({ type: z.literal("sandboxActivity") });

function isActivityMessage(data: unknown): boolean {
  return activityMessageSchema.safeParse(data).success;
}

type IdleTimer = {
  arm: () => void;
};

// The 5-min idle timer + its activity sources. While `active`, any window
// pointer/keyboard event OR a frame-origin `sandboxActivity` postMessage re-arms
// it; on timeout it calls `onIdle`. The VNC frame is cross-origin, so the parent
// can't see in-frame interaction — the message is how the (future) VNC page
// reports it; until then it's never received and behaviour is unchanged. The
// message is origin-checked so an unrelated page can't keep the session alive.
function useIdleTimer(
  active: boolean,
  targetOrigin: string,
  onIdle: () => void,
): IdleTimer {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const arm = useCallback(() => {
    clear();
    timerRef.current = setTimeout(
      () => onIdleRef.current(),
      TAKE_OVER_IDLE_TIMEOUT_MS,
    );
  }, [clear]);

  useEffect(() => {
    if (!active) {
      clear();
      return undefined;
    }
    const onActivity = (): void => arm();
    const onMessage = (event: MessageEvent): void => {
      const fromFrame = targetOrigin === "*" || event.origin === targetOrigin;
      if (fromFrame && isActivityMessage(event.data)) {
        arm();
      }
    };
    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("click", onActivity);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
      window.removeEventListener("message", onMessage);
      clear();
    };
  }, [active, arm, clear, targetOrigin]);

  return { arm };
}

// Emulator devices render their own take-over UI from a postMessage handshake;
// mirror the boolean to the frame on change + on load. No-op for non-emulators.
function useEmulatorMirror(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  isEmulator: boolean,
  takeOver: boolean,
  targetOrigin: string,
): void {
  useEffect(() => {
    if (!isEmulator) {
      return undefined;
    }
    const iframe = iframeRef.current;
    if (!iframe) {
      return undefined;
    }
    const send = (): void => {
      // Cross-origin frames throw on contentWindow access — ignore (the frame
      // simply doesn't get the message until it is same-origin/ready).
      try {
        iframe.contentWindow?.postMessage(
          { type: "takeOver", active: takeOver },
          targetOrigin,
        );
      } catch {
        // not ready / cross-origin — no-op
      }
    };
    send();
    iframe.addEventListener("load", send);
    return () => iframe.removeEventListener("load", send);
  }, [takeOver, isEmulator, iframeRef, targetOrigin]);
}

export type UseTakeOver = {
  takeOver: boolean;
  toggleTakeOver: () => void;
  exitTakeOver: () => void;
};

/**
 * The take-over state machine for one device: the boolean, the idle timer (via
 * `useIdleTimer`), and the emulator `postMessage` mirror. Extracted from
 * `SandboxInstance` so the view stays within budget. `targetOrigin` is the
 * frame's origin (or "*"), used to scope the outbound mirror and the idle
 * timer's inbound activity ping.
 */
export function useTakeOver(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  isEmulator: boolean,
  targetOrigin: string,
): UseTakeOver {
  const [takeOver, setTakeOver] = useState(false);
  // Mirrors `takeOver` so `exitTakeOver` can no-op when it's already off (a
  // device switch from a view-only screen must not toast) without a stale
  // closure or a `takeOver` dep that re-creates every callback.
  const takeOverRef = useRef(false);

  const setTakeOverState = useCallback((next: boolean) => {
    takeOverRef.current = next;
    setTakeOver(next);
  }, []);

  // Exit is idempotent: only an active session releases control and toasts. The
  // toast lives outside any state updater (updaters must stay pure; StrictMode
  // double-runs them). Flipping `takeOver` off lets `useIdleTimer`'s effect tear
  // the timer + listeners down on its own. Reached by the button, the idle
  // timeout, and a device switch.
  const exitTakeOver = useCallback(() => {
    if (!takeOverRef.current) {
      return;
    }
    setTakeOverState(false);
    // Transient inverted feedback, no icon (matches the Figma black-toast
    // "Take over ended" example) — a bare invert toast renders plain.
    toast(EXIT_COPY, { invert: true });
  }, [setTakeOverState]);

  const idleTimer = useIdleTimer(takeOver, targetOrigin, exitTakeOver);

  const toggleTakeOver = useCallback(() => {
    if (takeOverRef.current) {
      // Exit through the shared path so the button release toasts like the idle
      // timeout and device switch do.
      exitTakeOver();
      return;
    }
    setTakeOverState(true);
    idleTimer.arm();
    requestAnimationFrame(() => iframeRef.current?.focus());
  }, [exitTakeOver, idleTimer, setTakeOverState, iframeRef]);

  useEmulatorMirror(iframeRef, isEmulator, takeOver, targetOrigin);

  return { takeOver, toggleTakeOver, exitTakeOver };
}
