# GUI Agent Sandbox — Capability & Limitation Reference

> This document defines what the GUI Agent sandbox **can** and **cannot** do. It serves as the single source of truth for sandbox executability checks across all skills.

---

## Sandbox Overview

The sandbox is a **single device instance** — one Android phone. The GUI Agent controls this device by executing actions defined in the [Action Space](../../rewrite-from-doc/data/Action_Space.md).

### What the Agent CAN Do

The agent can perform **any action in the Action Space** on the sandbox device, including:

- **UI interactions**: Click, LongPress, Drag, Scroll, Type, Wait
- **Navigation**: PressBack, PressHome, PressRecent, PressEnter
- **App management**: Launch any installed app, switch between apps via PressRecent
- **Task completion**: Finished (mark task done), CallUser (return info-retrieval answer)
- **Cross-app workflows on the same device**: The agent can freely switch between multiple apps on the same device. For example: share content from App A to App B via the system share sheet, open a link in the browser, pick a file from the file manager, etc.
- **Multi-step in-app operations**: Send messages, create conversations, navigate tabs, open menus, install apps from the app store
- **General reasoning**: The agent has LLM-level understanding and can reason about what it sees on screen
- **Text input**: Type in any language, paste from clipboard

### What the Agent CANNOT Do

The sandbox has no physical sensors, controls only one device, and cannot manipulate OS-level network settings. The sections below detail each limitation category.

---

## Category 1: Hardware Sensors & Multimodal Input — 🔴 Blocked

**Root cause**: The agent's input channels are limited to the actions defined in the [Action Space](Action_Space.md). The sandbox has no physical sensors, so the agent cannot produce audio signals, video streams, location coordinates, or other non-GUI input.

### 1.1 Voice / Audio

| Scenario | Description |
|----------|-------------|
| Voice chat / voice commands | After tapping the microphone button, the device receives no audio — the flow stalls |
| Speech-to-text | Requires continuous audio stream fed to the ASR engine |
| Voice search | Launches voice search UI but no speech input is possible |
| Voice + screen sharing | Combines two blocked capabilities |

### 1.2 Camera / Vision

| Scenario | Description |
|----------|-------------|
| Photo capture | Camera opens but shows a black/blank preview — captured image is unusable |
| Burst photos (e.g., take 20 photos) | No real camera — completely infeasible |
| Real-time camera preview / Vision | Requires live video stream for model recognition |
| Screen sharing / recording | Requires system-level `MediaProjection` permission dialog + actual video stream |
| QR code / barcode scanning | Depends on live camera feed + image recognition |

### 1.3 Other Sensors & Input Methods

| Scenario | Description |
|----------|-------------|
| GPS / location | Location-based recommendations, nearby search, geofencing triggers |
| Gyroscope / accelerometer | Shake interactions, motion detection |
| NFC | Tag reading, contactless payments |
| Fingerprint / Face ID | Biometric authentication |
| Handwriting / gesture drawing | Signatures, complex multi-touch gestures |
| 3D Touch / Force Touch | Pressure-sensitive interactions |
| Screen rotation (Orientation) | Switching portrait/landscape — some sandboxes do not support programmatic rotation via adb |
| Screen lock / power button | Lock, unlock, power button operations — agent cannot press physical buttons |

**Observed behavior**:
- Agent taps the "microphone" button and enters the voice page, but the device never receives audio → flow stalls
- Agent taps "take photo" and opens the camera, but the preview is black/blank → subsequent upload and recognition steps fail
- Screen sharing requires an OS-level recording permission dialog + actual video stream — both are absent in the sandbox

---

## Category 2: Network & External Service Dependencies — 🟡 Partial

**Root cause**: The sandbox typically operates in a controlled network environment. The agent cannot toggle network settings at the OS level, and some tests depend on real-time external service responses whose stability is outside the agent's control.

| Scenario | Description |
|----------|-------------|
| **Airplane mode / disconnect network** | Agent cannot toggle airplane mode or Wi-Fi switch to simulate connectivity loss |
| **Weak / slow network simulation** | No mechanism to throttle bandwidth or inject latency |
| **Wi-Fi ↔ cellular switching** | Verifying app continuity across network transitions is not possible |
| **Long streaming responses** | Requires stable network for sustained streaming; sandbox may timeout and truncate |
| **Email / calendar service calls** | Sending email or creating calendar events requires real backend service response |
| **Real-time sync (cross-device)** | Syncing history across devices requires multi-device environment (see Category 3) |

**Observed behavior**:
- Cannot simulate "Connectivity issues" error by toggling airplane mode
- Streaming responses may be truncated if the sandbox enforces execution time limits
- External service calls may fail due to latency or service unavailability — not an agent fault

---

## Category 3: Cross-Device Interaction — 🟠 Blocked

**Root cause**: The GUI Agent controls only **one sandbox device instance**. It cannot operate a second device or coordinate actions across multiple devices.

> **Important distinction**: Cross-**device** interaction is blocked, but cross-**app** interaction on the **same device** is fully supported. The agent can freely switch between apps using PressHome, PressRecent, or Launch, and interact with system-level UI like share sheets and file pickers.

| Scenario | Description |
|----------|-------------|
| **Cross-device history sync** | Create a conversation on Device A, verify it appears on Device B |
| **Cross-device login state** | Sign in on Device A, verify login state on Device B |
| **Cross-platform consistency** | Compare the same feature's behavior on Android vs iOS |
| **Share link to another device** | Device A generates a share link, Device B opens and verifies content |
| **Multi-device concurrent editing** | Two devices editing the same conversation/page simultaneously |
| **Phone ↔ PC handoff** | Start on phone, seamlessly continue on PC |

**Observed behavior**:
- Sandbox provides a single device instance — the agent cannot "open a second phone" to receive a shared link
- Cross-device sync tests require two devices logged into the same account simultaneously, which the sandbox cannot orchestrate
- Cross-platform verification requires separate Android + iOS environments running in parallel

### Cross-App on Same Device — ✅ Supported

These are NOT limitations — the agent handles them normally:

| Scenario | How the Agent Does It |
|----------|----------------------|
| Share from App A to App B | Tap share button → system share sheet → select target app |
| Open a link in browser | Tap link → system opens default browser |
| Pick file from file manager | Tap "attach" → system file picker → select file |
| Switch between apps | PressRecent → tap target app, or PressHome → Launch target app |
| Install an app from store | Launch Play Store → search → install |

---

## Risk Level Summary

| Risk Level | Category | Impact |
|------------|----------|--------|
| 🔴 **Blocked** | Hardware sensors & multimodal input | All cases involving voice, camera, GPS, screen sharing, handwriting, or other non-GUI input |
| 🟠 **Likely blocked** | Cross-device interaction | Multi-device sync, share link reception, cross-platform verification, phone↔PC handoff |
| 🟡 **Partial** | Network & external services | Depends on sandbox network configuration and external service stability |
| 🟡 **Partial** | Screen rotation / screen lock | Depends on whether the sandbox supports adb-simulated rotation and power key |

---

## Recommendations

1. **Tag & triage**: Label cases with tags like `requires_hardware`, `requires_multi_device`, `requires_network` to auto-route them to manual testing queues.
2. **Mock strategies**: Introduce mocks for some scenarios (e.g., `adb push` pre-staged images to the gallery instead of taking photos; `adb shell` to simulate GPS coordinates) to reduce the number of fully-blocked cases.
3. **Pre-check script**: Before execution, run a precondition check to auto-skip known-blocked cases and mark them as `SKIPPED_SANDBOX_LIMITATION`.
4. **Hybrid execution**: Use the sandbox for pure UI interaction cases; route hardware/sensor cases to a real device farm. Merge both result sets into a unified report.
