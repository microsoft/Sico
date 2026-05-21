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

from __future__ import annotations

import json
import platform
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple, Union

from app.settings import detect_android_home


@dataclass
class MuMuPaths:
    manager_path: Path
    adb_path: Path


class MuMuClient:
    def __init__(self, mumu_manager_path: str, android_home: str = "", avd_headless: bool = False,
                 avd_name_prefix: str = "device", avd_base_port: int = 5554):
        self._is_macos = sys.platform == "darwin"
        self._use_avd = False
        self._avd_headless = avd_headless
        self._vm_index: Optional[str] = None

        if self._is_macos:
            ah = Path(android_home) if android_home else detect_android_home()
            if ah and (ah / "platform-tools" / "adb").exists():
                adb_path = ah / "platform-tools" / "adb"
                emulator_bin = ah / "emulator" / "emulator"
                avdmanager_bin = ah / "cmdline-tools" / "latest" / "bin" / "avdmanager"
                missing_tools = [
                    str(path)
                    for path in (adb_path, emulator_bin, avdmanager_bin)
                    if not path.exists()
                ]
                if missing_tools:
                    raise RuntimeError(
                        "Android SDK is incomplete. Missing required tool(s): "
                        + ", ".join(missing_tools)
                    )

                self._use_avd = True
                self._android_home = ah
                self._paths = MuMuPaths(manager_path=adb_path, adb_path=adb_path)
                self._emulator_bin = emulator_bin
                self._avdmanager_bin = avdmanager_bin
                self._avd_prefix = avd_name_prefix
                self._base_port = avd_base_port
                arch = platform.machine()
                if arch == "arm64":
                    self._system_image = "system-images;android-35;google_apis;arm64-v8a"
                else:
                    self._system_image = "system-images;android-35;google_apis;x86_64"
                return

        # MuMu mode (Windows, or macOS fallback)
        manager_path = Path(mumu_manager_path)
        if not manager_path.exists():
            if self._is_macos:
                raise RuntimeError(
                    "Neither Android SDK nor MuMu Player found. "
                    "Run ./setup.sh install to set up the Android SDK."
                )
            raise RuntimeError(f"MuMuManager.exe not found at {manager_path}")

        if self._is_macos:
            adb_path = manager_path.parent / "MuMuEmulator.app" / "Contents" / "MacOS" / "tools" / "adb"
        else:
            adb_path = manager_path.parent / "adb.exe"

        self._paths = MuMuPaths(manager_path=manager_path, adb_path=adb_path)

    def select(self, vm_index: Union[int, List[int], Tuple[int, ...]] = None, *args: int):
        if vm_index is None:
            self._vm_index = "all"
            return self

        indices: List[int] = []
        if isinstance(vm_index, int):
            indices.append(vm_index)
        else:
            indices.extend(list(vm_index))

        if args:
            indices.extend(args)

        self._vm_index = ",".join(sorted({str(i) for i in indices}))
        return self

    def all(self):
        self._vm_index = "all"
        return self

    @property
    def is_avd(self) -> bool:
        return self._use_avd

    @property
    def adb_path(self) -> Path:
        return self._paths.adb_path

    @property
    def core(self) -> "Core":
        return AVDCore(self) if self._use_avd else Core(self)

    @property
    def power(self) -> "Power":
        return AVDPower(self) if self._use_avd else Power(self)

    @property
    def app(self) -> "App":
        return AVDApp(self) if self._use_avd else App(self)

    @property
    def adb(self) -> "Adb":
        return AVDAdb(self) if self._use_avd else Adb(self)

    @property
    def setting(self) -> "Setting":
        return AVDSetting(self) if self._use_avd else Setting(self)

    def _run_command(self, operate: Union[str, List[str]], args: List[str]) -> Tuple[int, str, str]:
        if self._is_macos:
            command = self._build_mac_command(operate, args)
        else:
            command = self._build_win_command(operate, args)

        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
        )

        return result.returncode, result.stdout, result.stderr

    def _build_win_command(self, operate: Union[str, List[str]], args: List[str]) -> List[str]:
        command: List[str] = [str(self._paths.manager_path)]
        if isinstance(operate, list):
            command.extend(operate)
        else:
            command.append(operate)
        if self._vm_index is not None:
            command.extend(["-v", self._vm_index])
        command.extend(args)
        return command

    def _build_mac_command(self, operate: Union[str, List[str]], args: List[str]) -> List[str]:
        """Translate Windows-style MuMuManager commands to macOS mumutool format."""
        base = str(self._paths.manager_path)
        device = self._vm_index or "0"

        op_parts = operate if isinstance(operate, list) else [operate]
        op = op_parts[0]

        if op == "create":
            # mumutool create [--count N] — no positional <device> arg
            count = _extract_flag_value(args, "-n")
            cmd = [base, "create"]
            if count and int(count) >= 2:
                cmd.extend(["--count", count])
            return cmd

        if op == "clone":
            # mumutool clone <device> — clones the specified device; no count support
            count = _extract_flag_value(args, "-n")
            if count and int(count) > 1:
                raise NotImplementedError("macOS mumutool clone does not support creating multiple copies at once")
            return [base, "clone", device]

        if op == "delete":
            return [base, "delete", device]

        if op == "rename":
            raise NotImplementedError("rename is not supported by macOS mumutool")

        if op == "control":
            sub_args = list(op_parts[1:]) + list(args)
            return self._build_mac_control(base, device, sub_args)

        if op == "adb":
            return self._build_mac_adb_proxy(base, device, args)

        if op == "setting":
            return self._build_mac_setting(base, device, args)

        return [base, op, device] + list(args)

    def _build_mac_control(self, base: str, device: str, args: List[str]) -> List[str]:
        if not args:
            return [base, "control", device]

        action = args[0]

        if action == "launch":
            pkg = _extract_flag_value(args, "-pkg")
            if pkg:
                return [base, "control", device, "--action", "open_app", "--package", pkg]
            return [base, "open", device]

        if action == "shutdown":
            return [base, "close", device]

        if action == "restart":
            return [base, "restart", device]

        if action == "app" and len(args) > 1:
            sub = args[1]
            if sub == "install":
                path = _extract_flag_value(args, "-apk")
                if path:
                    return [base, "control", device, "--action", "install_apk", "--path", path]
            elif sub == "uninstall":
                pkg = _extract_flag_value(args, "-pkg")
                if pkg:
                    return [base, "control", device, "--action", "uninstall_app", "--package", pkg]
            elif sub == "launch":
                pkg = _extract_flag_value(args, "-pkg")
                if pkg:
                    return [base, "control", device, "--action", "open_app", "--package", pkg]
            elif sub == "close":
                pkg = _extract_flag_value(args, "-pkg")
                if pkg:
                    return [base, "control", device, "--action", "close_app", "--package", pkg]
            elif sub == "info":
                return [base, "control", device, "--action", "app_status"]

        return [base, "control", device] + args

    def _build_mac_adb_proxy(self, base: str, device: str, args: List[str]) -> List[str]:
        if not args:
            return [base, "info", device]

        if args[0] == "-c":
            cmd_str = " ".join(args[1:])
            return [base, "control", device, "--action", "run_cmd", "--cmd", cmd_str]

        raise NotImplementedError(f"Unsupported macOS adb proxy args: {args}")

    # Windows → macOS config key mapping for mumutool
    _MAC_SETTINGS_MAP: Dict[str, str] = {
        "resolution_dpi.custom": "resolutionDPI",
        "window_auto_rotate": "windowAutoRotationEnable",
    }

    @staticmethod
    def _translate_mac_settings(settings: Dict[str, str]) -> Dict[str, str]:
        """Translate Windows-style setting keys/values to macOS mumutool format."""
        result: Dict[str, str] = {}
        width = settings.pop("resolution_width.custom", None)
        height = settings.pop("resolution_height.custom", None)
        settings.pop("resolution_mode", None)  # implicit on macOS
        settings.pop("window_size_fixed", None)  # not available on macOS

        if width and height:
            result["resolutionWidthHeight"] = f"{width}x{height}"

        for key, value in settings.items():
            mac_key = MuMuClient._MAC_SETTINGS_MAP.get(key, key)
            result[mac_key] = value

        return result

    def _build_mac_setting(self, base: str, device: str, args: List[str]) -> List[str]:
        if "-a" in args or "-aw" in args:
            raise NotImplementedError("Listing all settings is not supported by macOS mumutool")

        settings: Dict[str, str] = {}
        get_keys: List[str] = []
        i = 0
        while i < len(args):
            if args[i] == "-k" and i + 1 < len(args):
                key = args[i + 1]
                if i + 2 < len(args) and args[i + 2] == "-val" and i + 3 < len(args):
                    settings[key] = args[i + 3]
                    i += 4
                else:
                    get_keys.append(key)
                    i += 2
            else:
                i += 1

        if get_keys and not settings:
            raise NotImplementedError("Getting individual settings is not supported by macOS mumutool")

        if settings:
            translated = self._translate_mac_settings(settings)
            return [base, "config", device, "--setting", json.dumps(translated)]

        return [base, "config", device]

    def _run_adb(self, args: List[str]) -> Tuple[int, str, str]:
        if not self._paths.adb_path.exists():
            raise FileNotFoundError(f"adb not found in {self._paths.adb_path}")

        command = [str(self._paths.adb_path)] + args
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
        )
        return result.returncode, result.stdout, result.stderr

    def _run_adb_bytes(self, args: List[str]) -> Tuple[int, bytes, str]:
        """Run adb and return raw stdout bytes.

        Some adb commands (e.g. `exec-out screencap -p`) produce binary output and must not
        be decoded as UTF-8.
        """

        if not self._paths.adb_path.exists():
            raise FileNotFoundError(f"adb not found in {self._paths.adb_path}")

        command = [str(self._paths.adb_path)] + args
        result = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stderr_text = (result.stderr or b"").decode("utf-8", errors="replace")
        return result.returncode, result.stdout or b"", stderr_text

    # ---- AVD helpers (only used when _use_avd=True) ----

    def _run_avdmanager(self, args: List[str]) -> Tuple[int, str, str]:
        cmd = [str(self._avdmanager_bin)] + args
        result = subprocess.run(
            cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8",
        )
        return result.returncode, result.stdout or "", result.stderr or ""

    def _avd_name(self, index: int) -> str:
        return f"{self._avd_prefix}{index}"

    def _console_port(self, index: int) -> int:
        return self._base_port + 2 * index

    def _adb_port(self, index: int) -> int:
        return self._console_port(index) + 1

    def _avd_serial(self, index: int) -> str:
        return f"emulator-{self._console_port(index)}"

    def _list_avd_names(self) -> List[str]:
        code, out, _ = self._run_avdmanager(["list", "avd", "-c"])
        if code != 0:
            return []
        return [line.strip() for line in out.strip().splitlines() if line.strip()]

    def _avd_indices(self) -> set[int]:
        indices: set[int] = set()
        prefix = self._avd_prefix
        for name in self._list_avd_names():
            if name.startswith(prefix):
                try:
                    indices.add(int(name[len(prefix):]))
                except ValueError:
                    pass
        return indices

    def _emulator_state(self, index: int) -> Optional[str]:
        """Return the ADB state of the emulator (e.g. 'device', 'offline'), or None if not listed."""
        serial = self._avd_serial(index)
        code, out, _ = self._run_adb(["devices"])
        if code != 0:
            return None
        for line in out.strip().splitlines():
            if line.startswith(serial):
                parts = line.split("\t")
                if len(parts) >= 2:
                    return parts[1]
        return None

    def _is_emulator_running(self, index: int) -> bool:
        state = self._emulator_state(index)
        return state in ("device", "offline")

    def _is_emulator_booted(self, index: int) -> bool:
        return self._emulator_state(index) == "device"


class Core:
    def __init__(self, client: MuMuClient):
        self.client = client

    def create(self, number: int = 1) -> List[int]:
        if number < 1:
            number = 1

        code, out, err = self.client._run_command("create", ["-n", str(number)])
        if code != 0:
            raise RuntimeError(err or out)

        data = json.loads(out)
        created = []
        for key, value in data.items():
            if value.get("errcode") == 0:
                created.append(int(key))
        return created

    def clone(self, number: int = 1) -> List[int]:
        if number < 1:
            number = 1

        code, out, err = self.client._run_command("clone", ["-n", str(number)])
        if code != 0:
            raise RuntimeError(err or out)

        data = json.loads(out)
        created = []
        for key, value in data.items():
            if value.get("errcode") == 0:
                created.append(int(key))
        return created

    def delete(self) -> bool:
        code, out, err = self.client._run_command("delete", [])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def rename(self, name: str) -> bool:
        code, out, err = self.client._run_command("rename", ["-n", name])
        if code == 0:
            return True
        raise RuntimeError(err or out)


class Power:
    def __init__(self, client: MuMuClient):
        self.client = client

    def start(self, package: Optional[str] = None) -> bool:
        args = ["launch"]
        if package:
            args.extend(["-pkg", package])
        code, out, err = self.client._run_command("control", args)
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def shutdown(self) -> bool:
        code, out, err = self.client._run_command("control", ["shutdown"])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def restart(self) -> bool:
        code, out, err = self.client._run_command("control", ["restart"])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def stop(self) -> bool:
        return self.shutdown()


class App:
    def __init__(self, client: MuMuClient):
        self.client = client

    def install(self, apk_path: str) -> bool:
        apk_file = Path(apk_path)
        if not apk_file.exists() or not apk_file.is_file():
            raise FileNotFoundError(f"apk_path:{apk_path} not found")

        code, out, err = self.client._run_command("control", ["app", "install", "-apk", str(apk_file)])
        if code == 0:
            return True

        targets = list(_adb_targets(self.client.adb.get_connect_info()))
        if not targets:
            raise RuntimeError(err or out)

        for host, port in targets:
            _ensure_adb_connected(self.client, host, port)
            adb_code, adb_out, adb_err = self.client._run_adb(
                ["-s", f"{host}:{port}", "install", "-r", str(apk_file)]
            )
            if adb_code != 0:
                raise RuntimeError(adb_err or adb_out)

        return True

    def uninstall(self, package: str) -> bool:
        code, out, err = self.client._run_command("control", ["app", "uninstall", "-pkg", package])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def launch(self, package: str) -> bool:
        code, out, err = self.client._run_command("control", ["app", "launch", "-pkg", package])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def close(self, package: str) -> bool:
        code, out, err = self.client._run_command("control", ["app", "close", "-pkg", package])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def get_installed(self, third_party_only: bool = True) -> List[Dict[str, str]]:
        code, out, err = self.client._run_command("control", ["app", "info", "-i"])
        if code != 0:
            raise RuntimeError(err or out)

        data = json.loads(out)
        installed = []
        for key, value in data.items():
            if key == "active":
                continue
            installed.append(
                {
                    "package": key,
                    "app_name": value.get("app_name"),
                    "version": value.get("version"),
                }
            )
        if installed:
            return installed

        targets = list(_adb_targets(self.client.adb.get_connect_info()))
        if not targets:
            return []

        packages = []
        for host, port in targets:
            _ensure_adb_connected(self.client, host, port)

            adb_args = ["-s", f"{host}:{port}", "shell", "pm", "list", "packages"]
            if third_party_only:
                adb_args.append("-3")

            adb_code, adb_out, adb_err = self.client._run_adb(
                adb_args
            )
            if adb_code != 0:
                raise RuntimeError(adb_err or adb_out)
            for line in adb_out.splitlines():
                if line.startswith("package:"):
                    packages.append({"package": line.replace("package:", "", 1)})

        return packages


class Adb:
    def __init__(self, client: MuMuClient):
        self.client = client

    def get_connect_info(self):
        code, out, err = self.client._run_command("adb", [])
        if code != 0:
            return None, None

        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            return None, None

        # macOS: mumutool info returns {"errcode":0, "return":{...}}
        # with no adb_host/adb_port when device is stopped.
        if "errcode" in data and "return" in data:
            ret = data["return"]
            if isinstance(ret, dict) and "adb_host" in ret:
                return ret["adb_host"], ret.get("adb_port")
            return None, None

        # Windows: direct {"adb_host": ..., "adb_port": ...} or {"0": {"adb_host": ...}}
        adb_info = {}
        for key, value in data.items():
            if key == "adb_host" and "adb_port" in data:
                return data["adb_host"], data["adb_port"]

            if not isinstance(value, dict):
                continue

            if "errcode" in value:
                adb_info[key] = (None, None)
            else:
                adb_info[key] = (value.get("adb_host"), value.get("adb_port"))

        return adb_info if adb_info else (None, None)

    def click(self, x: int, y: int) -> bool:
        code, out, err = self.client._run_command(
            "adb",
            ["-c", "shell", "input", "tap", str(x), str(y)],
        )
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def swipe(self, from_x: int, from_y: int, to_x: int, to_y: int, duration: int = 500) -> bool:
        code, out, err = self.client._run_command(
            "adb",
            [
                "-c",
                "shell",
                "input",
                "swipe",
                str(from_x),
                str(from_y),
                str(to_x),
                str(to_y),
                str(duration),
            ],
        )
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def input_text(self, text: str) -> bool:
        code, out, err = self.client._run_command("adb", ["-c", "shell", "input", "text", text])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def key_event(self, key: Union[int, str]) -> bool:
        code, out, err = self.client._run_command("adb", ["-c", "shell", "input", "keyevent", str(key)])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def set_display(self, width: int = 720, height: int = 1280, dpi: int = 320) -> bool:
        try:
            if width == 720 and height == 1280 and dpi == 320:
                self.client.setting.set(
                    resolution_mode="phone",
                    window_auto_rotate=False,
                    window_size_fixed=True,
                )
            else:
                self.client.setting.set(
                    resolution_mode="custom",
                    resolution_width__custom=width,
                    resolution_height__custom=height,
                    resolution_dpi__custom=dpi,
                    window_auto_rotate=False,
                    window_size_fixed=True,
                )
        except Exception:
            pass

        targets = list(_adb_targets(self.get_connect_info()))
        if not targets:
            return False

        for host, port in targets:
            code, out, err = self.client._run_adb(["connect", f"{host}:{port}"])
            if code != 0 and "already connected" not in (out or "").lower():
                raise RuntimeError(err or out)

            code, out, err = self.client._run_adb(
                [
                    "-s",
                    f"{host}:{port}",
                    "shell",
                    "settings",
                    "put",
                    "system",
                    "accelerometer_rotation",
                    "0",
                ]
            )
            if code != 0:
                raise RuntimeError(err or out)

            code, out, err = self.client._run_adb(
                [
                    "-s",
                    f"{host}:{port}",
                    "shell",
                    "settings",
                    "put",
                    "system",
                    "user_rotation",
                    "0",
                ]
            )
            if code != 0:
                raise RuntimeError(err or out)

            code, out, err = self.client._run_adb(
                [
                    "-s",
                    f"{host}:{port}",
                    "shell",
                    "wm",
                    "size",
                    f"{width}x{height}",
                ]
            )
            if code != 0:
                raise RuntimeError(err or out)

            code, out, err = self.client._run_adb(
                [
                    "-s",
                    f"{host}:{port}",
                    "shell",
                    "wm",
                    "density",
                    str(dpi),
                ]
            )
            if code != 0:
                raise RuntimeError(err or out)

        return True

    def push(self, src: str, path: str) -> bool:
        src_path = Path(src)
        if not src_path.exists():
            raise FileNotFoundError(f"File not found: {src}")

        for host, port in _adb_targets(self.get_connect_info()):
            _ensure_adb_connected(self.client, host, port)
            code, out, err = self.client._run_adb(["-s", f"{host}:{port}", "push", str(src_path), path])
            if code != 0:
                raise RuntimeError(err or out)
        return True

    def push_download(self, src: str, new_name: Optional[str] = None) -> bool:
        filename = new_name or Path(src).name
        return self.push(src, f"/sdcard/Download/{filename}")

    def pull(self, src: str, path: str) -> bool:
        for host, port in _adb_targets(self.get_connect_info()):
            _ensure_adb_connected(self.client, host, port)
            code, out, err = self.client._run_adb(["-s", f"{host}:{port}", "pull", src, path])
            if code != 0:
                raise RuntimeError(err or out)
        return True

    def clear(self, package: str) -> bool:
        code, out, err = self.client._run_command("adb", ["-c", "shell", "pm", "clear", package])
        if code == 0:
            return True
        raise RuntimeError(err or out)


class Setting:
    def __init__(self, client: MuMuClient):
        self.client = client

    def all(self, all_writable: bool = False) -> Dict[str, str]:
        args = ["-aw"] if all_writable else ["-a"]
        code, out, err = self.client._run_command("setting", args)
        if code == 0:
            return json.loads(out)
        raise RuntimeError(err or out)

    def get(self, *keys: str):
        command_args: List[str] = []
        for key in keys:
            command_args.extend(["-k", key])

        code, out, err = self.client._run_command("setting", command_args)
        if code != 0:
            raise RuntimeError(err or out)

        ret = json.loads(out)
        for key, value in ret.items():
            if isinstance(value, str) and value.isdigit():
                ret[key] = int(value)
            elif isinstance(value, str) and value.lower() == "true":
                ret[key] = True
            elif isinstance(value, str) and value.lower() == "false":
                ret[key] = False

        if len(keys) == 1:
            return ret[keys[0]]
        return ret

    def set(self, **kwargs) -> bool:
        command_args: List[str] = []
        for key, value in kwargs.items():
            if isinstance(value, bool):
                value = str(value).lower()
            if value is None:
                value = "__null__"

            new_key = key
            if "___" in key:
                new_key = key.replace("___", "-")
            if "__" in key:
                new_key = new_key.replace("__", ".")

            command_args.extend(["-k", new_key, "-val", str(value)])

        code, out, err = self.client._run_command("setting", command_args)
        if code == 0:
            return True
        raise RuntimeError(err or out)


def _adb_targets(info) -> Iterable[Tuple[str, str]]:
    if isinstance(info, dict):
        for _, value in info.items():
            host, port = value
            if host and port:
                yield host, str(port)
    elif isinstance(info, tuple):
        host, port = info
        if host and port:
            yield host, str(port)


def _ensure_adb_connected(client: MuMuClient, host: str, port: str) -> None:
    """Ensure the current adb server has an active connection to host:port.

    MuMu exposes ADB over TCP (typically 127.0.0.1:<port>). Even if the emulator is running,
    the local adb server may not yet be connected, and `adb -s host:port ...` will fail with
    'device not found'.
    """

    code, out, err = client._run_adb(["connect", f"{host}:{port}"])
    text = (out or "") + "\n" + (err or "")
    text_lower = text.lower()

    if code == 0:
        return

    # Treat "already connected" as success.
    if "already connected" in text_lower or "already connected to" in text_lower:
        return

    raise RuntimeError(text.strip() or f"failed to adb connect {host}:{port}")


def _extract_flag_value(args: List[str], flag: str) -> Optional[str]:
    """Extract the value following a flag (e.g. -pkg, -apk) in an argument list."""
    for i, arg in enumerate(args):
        if arg == flag and i + 1 < len(args):
            return args[i + 1]
    return None


# =====================================================================
# AVD implementation classes (macOS / Linux — Android Studio Emulator)
# =====================================================================

class _AVDBase:
    """Shared helper for AVD classes to resolve the selected device index."""

    def __init__(self, client: MuMuClient):
        self.client = client

    def _get_index(self) -> int:
        vm = self.client._vm_index
        if vm is None or vm == "all":
            return 0
        return int(vm.split(",")[0])

    def _get_serial(self) -> str:
        return self.client._avd_serial(self._get_index())


class AVDCore(_AVDBase):

    def create(self, number: int = 1) -> List[int]:
        if number < 1:
            number = 1
        existing = self.client._avd_indices()
        next_idx = (max(existing) + 1) if existing else 0
        created: List[int] = []
        for i in range(number):
            idx = next_idx + i
            name = self.client._avd_name(idx)
            code, out, err = self.client._run_avdmanager([
                "create", "avd",
                "-n", name,
                "-k", self.client._system_image,
                "-d", "pixel_6",
                "--force",
            ])
            combined = (out + err).lower()
            if code == 0 or "already exists" in combined:
                created.append(idx)
            else:
                raise RuntimeError(f"Failed to create AVD {name}: {err or out}")
        return created

    def clone(self, number: int = 1) -> List[int]:
        return self.create(number)

    def delete(self) -> bool:
        idx = self._get_index()
        name = self.client._avd_name(idx)
        if self.client._is_emulator_running(idx):
            self.client._run_adb(["-s", self._get_serial(), "emu", "kill"])
            time.sleep(2)
        code, out, err = self.client._run_avdmanager(["delete", "avd", "-n", name])
        if code == 0:
            return True
        raise RuntimeError(f"Failed to delete AVD {name}: {err or out}")

    def rename(self, name: str) -> bool:
        idx = self._get_index()
        old_name = self.client._avd_name(idx)
        code, out, err = self.client._run_avdmanager([
            "move", "avd", "-n", old_name, "-r", name,
        ])
        if code == 0:
            return True
        raise RuntimeError(f"Failed to rename AVD {old_name}: {err or out}")

    def exists(self, index: Optional[int] = None) -> bool:
        idx = index if index is not None else self._get_index()
        return idx in self.client._avd_indices()


class AVDPower(_AVDBase):

    _BOOT_TIMEOUT = 120  # seconds

    def start(self, package: Optional[str] = None) -> bool:
        idx = self._get_index()
        name = self.client._avd_name(idx)
        port = self.client._console_port(idx)
        serial = self.client._avd_serial(idx)

        if self.client._is_emulator_running(idx):
            if package:
                self.client._run_adb([
                    "-s", serial, "shell", "monkey",
                    "-p", package, "-c", "android.intent.category.LAUNCHER", "1",
                ])
            return True

        cmd = [
            str(self.client._emulator_bin), "-avd", name,
            "-port", str(port),
            "-no-boot-anim",
            "-gpu", "swiftshader_indirect",
        ]
        if self.client._avd_headless:
            cmd.extend(["-no-window", "-no-audio"])
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                start_new_session=True)

        deadline = time.time() + self._BOOT_TIMEOUT
        while time.time() < deadline:
            time.sleep(3)
            # Detect early crash: if the process already exited, abort immediately.
            ret = proc.poll()
            if ret is not None:
                stderr_tail = (proc.stderr.read() or b"").decode("utf-8", errors="replace")[-2000:]
                raise RuntimeError(
                    f"Emulator {name} exited with code {ret} before boot.\n{stderr_tail}"
                )
            if self.client._is_emulator_booted(idx):
                code, out, _ = self.client._run_adb(
                    ["-s", serial, "shell", "getprop", "sys.boot_completed"]
                )
                if out.strip() == "1":
                    if package:
                        self.client._run_adb([
                            "-s", serial, "shell", "monkey",
                            "-p", package, "-c", "android.intent.category.LAUNCHER", "1",
                        ])
                    return True

        raise RuntimeError(
            f"Emulator {name} (port {port}) did not boot within {self._BOOT_TIMEOUT}s"
        )

    def shutdown(self) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb(["-s", serial, "emu", "kill"])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def restart(self) -> bool:
        try:
            self.shutdown()
        except RuntimeError:
            pass
        time.sleep(2)
        return self.start()

    def stop(self) -> bool:
        return self.shutdown()


class AVDApp(_AVDBase):

    def install(self, apk_path: str) -> bool:
        apk_file = Path(apk_path)
        if not apk_file.exists() or not apk_file.is_file():
            raise FileNotFoundError(f"apk_path:{apk_path} not found")
        serial = self._get_serial()
        _ensure_adb_connected(self.client, "127.0.0.1", str(self.client._adb_port(self._get_index())))
        code, out, err = self.client._run_adb(["-s", serial, "install", "-r", str(apk_file)])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def uninstall(self, package: str) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb(["-s", serial, "uninstall", package])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def launch(self, package: str) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb([
            "-s", serial, "shell", "monkey",
            "-p", package, "-c", "android.intent.category.LAUNCHER", "1",
        ])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def close(self, package: str) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb(["-s", serial, "shell", "am", "force-stop", package])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def get_installed(self, third_party_only: bool = True) -> List[Dict[str, str]]:
        serial = self._get_serial()
        adb_args = ["-s", serial, "shell", "pm", "list", "packages"]
        if third_party_only:
            adb_args.append("-3")
        code, out, err = self.client._run_adb(adb_args)
        if code != 0:
            raise RuntimeError(err or out)
        packages: List[Dict[str, str]] = []
        for line in out.splitlines():
            if line.startswith("package:"):
                packages.append({"package": line.replace("package:", "", 1).strip()})
        return packages


class AVDAdb(_AVDBase):

    def get_connect_info(self):
        vm = self.client._vm_index
        if vm is None or vm == "all":
            indices = self.client._avd_indices()
            if not indices:
                return {}
            result: Dict[str, Tuple[Optional[str], Optional[int]]] = {}
            for idx in sorted(indices):
                if self.client._is_emulator_running(idx):
                    result[str(idx)] = ("127.0.0.1", self.client._adb_port(idx))
                else:
                    result[str(idx)] = (None, None)
            return result
        else:
            idx = int(vm.split(",")[0])
            if self.client._is_emulator_running(idx):
                return "127.0.0.1", self.client._adb_port(idx)
            return None, None

    def click(self, x: int, y: int) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb(["-s", serial, "shell", "input", "tap", str(x), str(y)])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def swipe(self, from_x: int, from_y: int, to_x: int, to_y: int, duration: int = 500) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb([
            "-s", serial, "shell", "input", "swipe",
            str(from_x), str(from_y), str(to_x), str(to_y), str(duration),
        ])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def input_text(self, text: str) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb(["-s", serial, "shell", "input", "text", text])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def key_event(self, key: Union[int, str]) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb(["-s", serial, "shell", "input", "keyevent", str(key)])
        if code == 0:
            return True
        raise RuntimeError(err or out)

    def set_display(self, width: int = 720, height: int = 1280, dpi: int = 320) -> bool:
        serial = self._get_serial()
        idx = self._get_index()
        if not self.client._is_emulator_running(idx):
            return False
        _ensure_adb_connected(self.client, "127.0.0.1", str(self.client._adb_port(idx)))
        for cmd in [
            ["-s", serial, "shell", "settings", "put", "system", "accelerometer_rotation", "0"],
            ["-s", serial, "shell", "settings", "put", "system", "user_rotation", "0"],
            ["-s", serial, "shell", "wm", "size", f"{width}x{height}"],
            ["-s", serial, "shell", "wm", "density", str(dpi)],
        ]:
            code, out, err = self.client._run_adb(cmd)
            if code != 0:
                raise RuntimeError(err or out)
        return True

    def push(self, src: str, path: str) -> bool:
        src_path = Path(src)
        if not src_path.exists():
            raise FileNotFoundError(f"File not found: {src}")
        serial = self._get_serial()
        idx = self._get_index()
        _ensure_adb_connected(self.client, "127.0.0.1", str(self.client._adb_port(idx)))
        code, out, err = self.client._run_adb(["-s", serial, "push", str(src_path), path])
        if code != 0:
            raise RuntimeError(err or out)
        return True

    def push_download(self, src: str, new_name: Optional[str] = None) -> bool:
        filename = new_name or Path(src).name
        return self.push(src, f"/sdcard/Download/{filename}")

    def pull(self, src: str, path: str) -> bool:
        serial = self._get_serial()
        idx = self._get_index()
        _ensure_adb_connected(self.client, "127.0.0.1", str(self.client._adb_port(idx)))
        code, out, err = self.client._run_adb(["-s", serial, "pull", src, path])
        if code != 0:
            raise RuntimeError(err or out)
        return True

    def clear(self, package: str) -> bool:
        serial = self._get_serial()
        code, out, err = self.client._run_adb(["-s", serial, "shell", "pm", "clear", package])
        if code == 0:
            return True
        raise RuntimeError(err or out)


class AVDSetting(_AVDBase):
    """AVD settings adapter.

    AVD config lives in ~/.android/avd/<name>.avd/config.ini.
    Only a limited subset of operations is supported.
    """

    def _config_path(self) -> Path:
        idx = self._get_index()
        name = self.client._avd_name(idx)
        return Path.home() / ".android" / "avd" / f"{name}.avd" / "config.ini"

    def _read_config(self) -> Dict[str, str]:
        config_file = self._config_path()
        if not config_file.exists():
            return {}
        config: Dict[str, str] = {}
        for line in config_file.read_text().splitlines():
            if "=" in line:
                key, _, value = line.partition("=")
                config[key.strip()] = value.strip()
        return config

    def all(self, all_writable: bool = False) -> Dict[str, str]:
        return self._read_config()

    def get(self, *keys: str):
        config = self._read_config()
        ret = {k: config.get(k, "") for k in keys}
        for key, value in ret.items():
            if isinstance(value, str) and value.isdigit():
                ret[key] = int(value)
            elif isinstance(value, str) and value.lower() == "true":
                ret[key] = True
            elif isinstance(value, str) and value.lower() == "false":
                ret[key] = False
        if len(keys) == 1:
            return ret[keys[0]]
        return ret

    def set(self, **kwargs) -> bool:
        config = self._read_config()
        for key, value in kwargs.items():
            config_key = key.replace("___", "-").replace("__", ".")
            if isinstance(value, bool):
                config[config_key] = "yes" if value else "no"
            elif value is None:
                config.pop(config_key, None)
            else:
                config[config_key] = str(value)
        config_file = self._config_path()
        config_file.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"{k}={v}" for k, v in sorted(config.items())]
        config_file.write_text("\n".join(lines) + "\n")
        return True
