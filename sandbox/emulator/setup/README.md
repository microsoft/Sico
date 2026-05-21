# Emulator Service: Setup & Management

Unified script that installs prerequisites and manages the emulator API service lifecycle on **Windows** and **macOS** hosts.

## Prerequisites

### Windows

| Requirement | Details |
|-------------|---------|
| **OS** | Windows x86_64 or ARM64 (run via Git Bash / MSYS2) |
| **PowerShell** | `powershell.exe` or `pwsh` must be on PATH |
| **MuMu Player** | Auto-installed via `winget` when available, otherwise via the official MuMu installer; custom `MUMU_MANAGER_PATH` is also supported |
| **Bundled ADB** | `adb.exe` sibling to `MuMuManager.exe` (ships with MuMu Player) |
| **Python** | 3.13+ (`.venv`, `py -3`, `python3`, or `python`) |

### macOS

| Requirement | Details |
|-------------|---------|
| **OS** | macOS Apple Silicon or Intel x86_64 |
| **Android SDK** | `ANDROID_HOME` or default `~/Library/Android/sdk` |
| **Required tools** | `platform-tools/adb`, `emulator/emulator`, `cmdline-tools/latest/bin/avdmanager` |
| **Python** | 3.13+ (`.venv`, `python3`, or `python`) |

> **WSL / Linux** are not supported. The script exits with a clear error on unsupported platforms.

## Quick Start

From the repository root:

```bash
# Full install + start API service
make emulator-setup

# Bootstrap the default emulator device
make emulator-bootstrap
```

From this directory:

```bash
# Full install + start API service
./setup.sh

# Bootstrap the default emulator device
./setup.sh bootstrap

# One-step install + start + bootstrap, useful for fresh setup
./setup.sh install --bootstrap

# Install only, don't start
./setup.sh install --no-start

# Stop emulator devices explicitly
./setup.sh stop-devices

# Start / stop / restart / status the API service only
./setup.sh start
./setup.sh stop
./setup.sh restart
./setup.sh status

# Tail logs
./setup.sh logs

# Start in foreground (Ctrl+C to stop)
./setup.sh start --foreground
```

## Commands

| Command   | Description |
|-----------|-------------|
| `install` | Install all prerequisites and start the API service by default |
| `start`   | Start the emulator API service in background; does not start emulator devices |
| `stop`    | Stop the API service; does not stop emulator devices |
| `restart` | Restart the API service only |
| `status`  | Show whether the API service is running |
| `bootstrap` | Bootstrap the default emulator device and install cached APKs; requires the API service to be running |
| `stop-devices` | Stop all running emulator devices explicitly |
| `logs`    | Tail the service log file |
| `help`    | Show built-in help |

## Install Options

| Flag | Description |
|------|-------------|
| `--skip-mumu` | Skip MuMu Player download/install |
| `--skip-sdk` | Skip Android SDK installation on macOS |
| `--skip-adbkeyboard` | Skip ADBKeyboard APK installation |
| `--skip-edge` | Skip Microsoft Edge APK installation |
| `--skip-virtualization` | Skip Hyper-V / virtualization enablement |
| `--skip-deps` | Skip Python dependency installation |
| `--no-start` | Don't start the service after install |
| `--bootstrap` | After `install`, `start`, or `restart`, run the default device bootstrap |
| `--foreground` | Start service in foreground instead of background |

> `--skip-adb` is **no longer accepted** and will cause a fatal error. Bundled ADB verification is mandatory.

## Service Options

| Flag | Default | Description |
|------|---------|-------------|
| `--host <addr>` | `0.0.0.0` | Bind address |
| `--port <int>` | `8000` | Bind port (1–65535) |

## Display Options

| Flag | Default | Description |
|------|---------|-------------|
| `--width <int>` | `720` | Emulator screen width |
| `--height <int>` | `1280` | Emulator screen height |
| `--dpi <int>` | `320` | Emulator screen DPI |

## Backend Path Resolution

### Windows MuMu path

The script resolves the MuMu management tool in this order:

1. `MUMU_MANAGER_PATH` environment variable
2. `MUMU_MANAGER_PATH=` in `sandbox/emulator/.env`
3. Auto-detected installed path from Windows uninstall metadata, running MuMu processes, or common install locations
4. Default path: `C:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe`

If the configured path doesn't exist, the script first tries to auto-detect the real MuMu installation path before falling back to the default location. This allows a manual non-default installation to be picked up on the next `./setup.sh` run without editing `.env`.

Bundled ADB is automatically resolved on Windows:
- Windows: `adb.exe` in the same directory as `MuMuManager.exe`

### macOS Android SDK path

The script resolves `ANDROID_HOME` in this order:

1. `ANDROID_HOME` environment variable
2. `ANDROID_HOME=` in `sandbox/emulator/.env`
3. Default path: `~/Library/Android/sdk`

ADB is expected at `platform-tools/adb`, the emulator binary at `emulator/emulator`, and `avdmanager` at `cmdline-tools/latest/bin/avdmanager`.

## Install Flow

### Windows (5 Steps)

1. **Hyper-V & Virtualization**: enables Windows features (requires admin; skippable)
2. **MuMu Player**: checks existence, tries non-interactive `winget` install first, then falls back to the official MuMu installer; downloaded installers must pass Authenticode signature verification before execution; if silent install does not work, setup waits for the installer window to finish and continues automatically after `MuMuManager.exe` is detected; fatal if still missing
3. **Bundled ADB**: validates `adb.exe` next to `MuMuManager.exe`; fatal if missing
4. **Python dependencies**: auto-creates or repairs `sandbox/emulator/.venv` when needed, bootstraps `pip` with `ensurepip`, then runs `pip install -e .` from `pyproject.toml`; fatal if packaging tooling is still unavailable
5. **Download APKs**: pre-downloads ADBKeyboard and Microsoft Edge APKs (optional)

After installation, if MuMu was installed during the current run, setup best-effort stops the installer-started reserved pad instance at device-0 before the service starts. Normal service lifecycle commands do not create, start, or stop MuMu devices. After the API service is running, run `./setup.sh bootstrap` (or use `./setup.sh install --bootstrap`) when you want the script to reuse an existing non-zero MuMu device, create one if needed, start it, apply display defaults, and install cached APKs via the API.

### macOS

The macOS flow bootstraps Java if needed, then runs these numbered steps:

1. **Android SDK command-line tools**: installs `sdkmanager` / `avdmanager`
2. **SDK packages**: installs `platform-tools`, `emulator`, and the Android 35 system image
3. **ADB validation**: verifies `platform-tools/adb`
4. **AVD creation**: creates `${AVD_NAME_PREFIX}0` when missing
5. **Python dependencies**: installs the FastAPI service package
6. **Display configuration**: writes the default screen size and DPI into the AVD config
7. **ADBKeyboard + Edge**: downloads APKs during setup. After the API service is running, run `./setup.sh bootstrap` (or use `./setup.sh install --bootstrap`) to start the default AVD and install them via the API.

`start` and `restart` validate the runtime backend before launching the API service. If the Android SDK is incomplete on macOS, startup fails early instead of advertising a healthy API.

## Device Bootstrap

Device operations are intentionally explicit. This avoids surprising open-source users by opening, creating, or closing GUI emulator instances when they only asked to manage the API daemon.

- `./setup.sh bootstrap` requires the API service to be running, then starts/creates the default emulator device and installs cached APKs.
- On Windows, bootstrap skips the reserved MuMu device-0 index, reuses an existing non-zero device when possible, and creates one phone-mode device only when needed.
- On macOS, bootstrap creates `device0` if missing, then starts it.
- `./setup.sh stop-devices` stops all running emulator devices explicitly. `./setup.sh stop` only stops the API service.

## Service Lifecycle

- **Background mode**: launches via `nohup`, writes PID to `.emulator-service.pid` and state to `.emulator-service.env`, and polls `/health` for readiness (20 attempts). If readiness fails, the orphan process is automatically terminated.
- **Foreground mode**: uses `exec` to replace the shell process. Ctrl+C to stop.
- **State files**: `.emulator-service.pid` and `.emulator-service.env` track PID, host, and port for `stop`/`status`/`restart`.
- **Process matching**: validates PID via `ps` cmdline or `lsof` port check to avoid acting on stale PIDs.
- **Graceful shutdown**: `stop` sends SIGTERM to the API service, waits 10s, and sends SIGKILL if the process is still alive. It does not stop emulator devices; use `stop-devices` for that.
- **Health semantics**: `/health` returns `503` when the emulator backend is not ready, so setup and orchestration do not treat a broken backend as healthy.

## Python Resolution

The script finds Python 3.13+ in this order:

1. `sandbox/emulator/.venv/bin/python` or `.venv/Scripts/python.exe`
2. `py -3` (Windows Python Launcher)
3. `python3`
4. `python`

A `PYTHON_CMD` array is built once and reused for all Python operations (eval, pip, uvicorn).

During `install`, if no usable local `.venv` interpreter exists, the script creates or repairs `sandbox/emulator/.venv` with the selected 3.13+ base interpreter and then installs dependencies into that local environment.
