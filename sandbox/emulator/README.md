# Emulator Service

FastAPI service for controlling MuMu Android emulators via `MuMuManager.exe`. Runs on the Windows host alongside MuMu Player.

## Features

- Emulator lifecycle: create, delete, start, stop, restart, reset, soft-reset
- App management: install, uninstall, launch, close APKs
- ADB actions: tap, swipe, input text, key events
- Live view: H264 video streaming via WebSocket (scrcpy-based)
- Snapshots (PNG) and screen recording (MP4)
- Device listing and settings

## Prerequisites

- Windows host with MuMu Player installed
- `MuMuManager.exe` path configured in [app/settings.py](app/settings.py)
- Python 3.13+
- Hyper-V enabled (see below)

## Setup Scripts

### Enable Virtualization

Run in **elevated PowerShell** to enable Hyper-V and virtualization features:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
./scripts/enable-virtualization.ps1
```

To skip auto-restart: `./scripts/enable-virtualization.ps1 -Restart:$false`

### Install ADB

Installs Android Platform-Tools (includes `adb.exe`) via `winget`:

```powershell
./scripts/install-adb.ps1
```

Skip install, detect only: `./scripts/install-adb.ps1 -SkipInstall`

### Install ADBKeyboard

Required for Unicode/CJK text input via ADB:

```powershell
./scripts/install-adbkeyboard.ps1
```

For a specific device: `./scripts/install-adbkeyboard.ps1 -DeviceSerial "127.0.0.1:16384"`

## Run

```bash
pip install -r requirements.txt
python -m app.main
# or: uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Build (PyInstaller)

### onedir

macOS/Linux:

```bash
pyinstaller --noconfirm --clean --onedir -n mumu-api app/main.py \
    --paths . --collect-submodules app \
    --add-data "app/scrcpy/scrcpy-server:app/scrcpy"
```

Windows:

```powershell
pyinstaller --noconfirm --clean --onedir -n mumu-api app\main.py `
    --paths . --collect-submodules app `
    --add-data "app\scrcpy\scrcpy-server;app\scrcpy"
```

> The `--add-data` flag bundles `scrcpy-server` for H264 streaming. Path separator is `:` on macOS/Linux, `;` on Windows.

## Key Endpoints

Notes:

- `POST /api/v1/emulators/{id}/stop` is idempotent and succeeds even if the emulator is already stopped.
- `POST /api/v1/emulators/{id}/reset`, `POST /api/v1/emulators/{id}/soft-reset`, and `POST /api/v1/emulators/{id}/restart` require the emulator to already be running.

| Endpoint                                 | Method | Description                                                                       |
| ---------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `POST /api/v1/emulators`                 | POST   | Create emulator                                                                   |
| `POST /api/v1/emulators/{id}/start`      | POST   | Start emulator                                                                    |
| `POST /api/v1/emulators/{id}/stop`       | POST   | Stop emulator (idempotent: returns success if already stopped)                    |
| `POST /api/v1/emulators/start-batch`     | POST   | Start multiple emulators with host-load throttling                                |
| `POST /api/v1/emulators/{id}/reset`      | POST   | Soft-reset emulator: close third-party apps and return to Home without restarting |
| `POST /api/v1/emulators/{id}/soft-reset` | POST   | Soft-reset emulator: close third-party apps and return to Home without restarting |
| `GET /api/v1/emulators/devices`          | GET    | List devices                                                                      |
| `GET /api/v1/devices/{index}/snapshot`   | GET    | Screenshot (PNG)                                                                  |
| `WS /api/v1/devices/{index}/ws/h264`     | WS     | H264 live stream                                                                  |
| `/vnc/view/{deviceId}`                   | GET    | VNC viewer (H264 + JMuxer)                                                        |
