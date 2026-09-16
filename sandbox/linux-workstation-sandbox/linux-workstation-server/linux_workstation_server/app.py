from __future__ import annotations

import base64
import asyncio
import csv
import json
import os
import pty
import fcntl
import mimetypes
import struct
import subprocess
import sys
import termios
import tempfile
import time
import uuid
import platform
from urllib.parse import quote
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Annotated, Any, Dict, List, Literal, Optional, Set, Union

import httpx
import mss
from mss import tools as mss_tools
import fnmatch
import re
import signal
from pathlib import Path
import pyautogui
import pyperclip

from pydantic import BaseModel, Field, TypeAdapter, field_validator, model_validator

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket
from fastapi.openapi.utils import get_openapi
from fastapi.websockets import WebSocketDisconnect
from fastapi.responses import Response as FastAPIResponse
from fastapi.responses import StreamingResponse


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ok(data: Any = None, message: str = "ok") -> Dict[str, Any]:
    return {"success": True, "message": message, "data": data}


def _err(message: str, *, status_code: int = 400, data: Any = None) -> Dict[str, Any]:
    raise HTTPException(status_code=status_code, detail={"success": False, "message": message, "data": data})


def _workspace() -> str:
    return os.environ.get("WORKSPACE", "/home/gem")


def _display_size() -> tuple[int, int]:
    return int(os.environ.get("DISPLAY_WIDTH", "1280")), int(os.environ.get("DISPLAY_HEIGHT", "1024"))


def _public_base(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


@dataclass
class ShellSession:
    id: str
    working_dir: str
    created_at: datetime = field(default_factory=_now)
    last_used_at: datetime = field(default_factory=_now)
    current_command: Optional[str] = None
    status: Literal["running", "completed", "no_change_timeout", "hard_timeout", "terminated"] = "completed"
    exit_code: Optional[int] = None
    last_output: str = ""
    last_stdout: str = ""
    last_stderr: str = ""
    process: Optional[subprocess.Popen[str]] = None
    output_path: Optional[str] = None
    output_handle: Optional[Any] = None
    stderr_path: Optional[str] = None
    stderr_handle: Optional[Any] = None

    def info(self) -> Dict[str, Any]:
        age_seconds = int((_now() - self.created_at).total_seconds())
        return {
            "working_dir": self.working_dir,
            "created_at": self.created_at,
            "last_used_at": self.last_used_at,
            "age_seconds": age_seconds,
            "status": self.status,
            "current_command": self.current_command,
        }


class ShellManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, ShellSession] = {}

    def get_or_create(self, session_id: Optional[str], exec_dir: Optional[str]) -> ShellSession:
        if session_id and session_id in self._sessions:
            s = self._sessions[session_id]
            if exec_dir:
                s.working_dir = exec_dir
            return s

        sid = session_id or uuid.uuid4().hex
        wd = exec_dir or _workspace()
        s = ShellSession(id=sid, working_dir=wd)
        self._sessions[sid] = s
        return s

    def list(self) -> Dict[str, Any]:
        return {sid: sess.info() for sid, sess in self._sessions.items()}

    def cleanup_all(self) -> None:
        for sid in list(self._sessions.keys()):
            self.cleanup(sid)

    def cleanup(self, session_id: str) -> None:
        sess = self._sessions.get(session_id)
        if not sess:
            return
        if sess.process and sess.process.poll() is None:
            _terminate_shell_process(sess.process)
        _close_shell_output(sess)
        _remove_shell_output_files(sess)
        self._sessions.pop(session_id, None)


class _HTMLToMarkdownParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: List[str] = []
        self._list_stack: List[str] = []
        self._href_stack: List[Optional[str]] = []

    def _append(self, text: str) -> None:
        if text:
            self._parts.append(text)

    def handle_starttag(self, tag: str, attrs: List[tuple[str, Optional[str]]]) -> None:
        attr_map = dict(attrs)
        if tag in {"p", "div", "section", "article", "header", "footer", "tr"}:
            self._append("\n")
        elif tag == "br":
            self._append("\n")
        elif tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            self._append("\n" + ("#" * int(tag[1])) + " ")
        elif tag in {"ul", "ol"}:
            self._list_stack.append(tag)
            self._append("\n")
        elif tag == "li":
            indent = "  " * max(0, len(self._list_stack) - 1)
            bullet = "1. " if self._list_stack and self._list_stack[-1] == "ol" else "- "
            self._append(f"\n{indent}{bullet}")
        elif tag == "a":
            self._href_stack.append(attr_map.get("href"))
        elif tag in {"strong", "b"}:
            self._append("**")
        elif tag in {"em", "i"}:
            self._append("*")
        elif tag == "code":
            self._append("`")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"p", "div", "section", "article", "header", "footer", "tr", "ul", "ol"}:
            self._append("\n")
            if tag in {"ul", "ol"} and self._list_stack:
                self._list_stack.pop()
        elif tag == "a":
            href = self._href_stack.pop() if self._href_stack else None
            if href:
                self._append(f" ({href})")
        elif tag in {"strong", "b"}:
            self._append("**")
        elif tag in {"em", "i"}:
            self._append("*")
        elif tag == "code":
            self._append("`")

    def handle_data(self, data: str) -> None:
        self._append(data)

    def get_markdown(self) -> str:
        text = "".join(self._parts)
        lines = [line.rstrip() for line in text.splitlines()]
        normalized: List[str] = []
        previous_blank = False
        for line in lines:
            blank = line.strip() == ""
            if blank and previous_blank:
                continue
            normalized.append(line)
            previous_blank = blank
        return "\n".join(normalized).strip() + "\n"
edit_history: Dict[str, List[Dict[str, Any]]] = {}


def _detect_node_version() -> Optional[str]:
    try:
        proc = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=3)
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return (proc.stdout or proc.stderr).strip() or None


def _list_node_packages() -> List[str]:
    try:
        proc = subprocess.run(
            ["npm", "list", "-g", "--depth=0", "--json"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return []

    if proc.returncode not in (0, 1):
        return []

    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return []

    dependencies = payload.get("dependencies") or {}
    packages: List[str] = []
    for name, meta in sorted(dependencies.items()):
        version = meta.get("version") if isinstance(meta, dict) else None
        packages.append(f"{name}@{version}" if version else name)
    return packages


def _resolve_history_key(payload: Dict[str, Any], *, create: bool) -> Optional[str]:
    history_key = payload.get("history_key")
    if history_key is None:
        return uuid.uuid4().hex if create else None
    if not isinstance(history_key, str) or not history_key.strip():
        _err("history_key must be a non-empty string")
    return history_key.strip()


def _push_edit_history(history_key: str, path: str, prev_exist: bool, old_content: Optional[str]) -> None:
    edit_history.setdefault(history_key, []).append({"path": path, "prev_exist": prev_exist, "old_content": old_content})


def _undo_last_edit(history_key: str, path: str) -> Dict[str, Any]:
    history = edit_history.get(history_key) or []
    if not history:
        _err("no edit history available", status_code=409)

    previous = history.pop()
    if not history:
        edit_history.pop(history_key, None)

    previous_path = previous.get("path")
    if previous_path != path:
        _err("history_key does not match path", status_code=409)

    prev_exist = bool(previous["prev_exist"])
    old_content = previous.get("old_content")
    if not prev_exist:
        if os.path.exists(path):
            os.remove(path)
        return {"content": None, "deleted": True}

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(old_content or "")
    return {"content": old_content, "deleted": False}


def _close_shell_output(sess: ShellSession) -> None:
    for attribute in ("output_handle", "stderr_handle"):
        handle = getattr(sess, attribute)
        if handle is not None:
            try:
                handle.flush()
            except Exception:
                pass
            try:
                handle.close()
            except Exception:
                pass
            setattr(sess, attribute, None)


def _terminate_shell_process(process: subprocess.Popen[str]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except Exception:
        return
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass


def _remove_shell_output_files(sess: ShellSession) -> None:
    for attribute in ("output_path", "stderr_path"):
        path = getattr(sess, attribute)
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
        setattr(sess, attribute, None)


def _read_shell_stream(path: Optional[str], handle: Optional[Any], fallback: str) -> str:
    if handle is not None:
        try:
            handle.flush()
        except Exception:
            pass
    if path and os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    return fallback


def _read_shell_output(sess: ShellSession) -> str:
    stdout = _read_shell_stream(sess.output_path, sess.output_handle, sess.last_stdout)
    stderr = _read_shell_stream(sess.stderr_path, sess.stderr_handle, sess.last_stderr)
    return stdout + stderr


def _finalize_shell_session(sess: ShellSession, status: str = "completed") -> None:
    sess.last_stdout = _read_shell_stream(sess.output_path, sess.output_handle, sess.last_stdout)
    sess.last_stderr = _read_shell_stream(sess.stderr_path, sess.stderr_handle, sess.last_stderr)
    sess.last_output = sess.last_stdout + sess.last_stderr
    if sess.process is not None:
        sess.exit_code = sess.process.returncode
    sess.status = status
    sess.process = None
    _close_shell_output(sess)
    _remove_shell_output_files(sess)


def _markdown_escape_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ").strip()


def _table_to_markdown(rows: List[List[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    body = normalized[1:] or [[""] * width]
    lines = [
        "| " + " | ".join(_markdown_escape_cell(cell) for cell in header) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(_markdown_escape_cell(cell) for cell in row) + " |")
    return "\n".join(lines) + "\n"


def _code_fence_language(path: str) -> str:
    return {
        ".py": "python",
        ".js": "javascript",
        ".ts": "typescript",
        ".tsx": "tsx",
        ".jsx": "jsx",
        ".json": "json",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".sh": "bash",
        ".go": "go",
        ".html": "html",
        ".xml": "xml",
        ".sql": "sql",
        ".css": "css",
        ".md": "markdown",
    }.get(Path(path).suffix.lower(), "text")


def _convert_document_to_markdown(path: str) -> Dict[str, Any]:
    if not os.path.isabs(path):
        _err("path must be an absolute path")
    file_path = Path(path)
    if not file_path.is_file():
        _err("path is not a file", status_code=404)

    suffix = file_path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else ","
        with open(path, "r", encoding="utf-8", errors="replace", newline="") as f:
            rows = [row for row in csv.reader(f, delimiter=delimiter)]
        markdown = _table_to_markdown(rows)
        return {"markdown": markdown, "source_type": suffix.lstrip("."), "title": file_path.name}

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    if suffix in {".md", ".markdown", ".txt", ".rst"}:
        markdown = content
    elif suffix in {".html", ".htm"}:
        parser = _HTMLToMarkdownParser()
        parser.feed(content)
        parser.close()
        markdown = parser.get_markdown()
    elif suffix == ".json":
        try:
            markdown = "```json\n" + json.dumps(json.loads(content), ensure_ascii=False, indent=2) + "\n```\n"
        except json.JSONDecodeError:
            markdown = "```json\n" + content + "\n```\n"
    else:
        mime_type, _ = mimetypes.guess_type(path)
        allowed_text_suffixes = {".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".go", ".java", ".sql", ".yaml", ".yml", ".xml", ".ini", ".cfg", ".conf", ".log"}
        if mime_type and not mime_type.startswith("text/") and suffix not in allowed_text_suffixes:
            _err("unsupported file type for markdown conversion", status_code=415)
        markdown = f"```{_code_fence_language(path)}\n{content}\n```\n"

    return {"markdown": markdown, "source_type": suffix.lstrip(".") or "text", "title": file_path.name}
shell_mgr = ShellManager()

OPENAPI_TAGS = [
    {"name": "Sandbox", "description": "Sandbox metadata and package listing"},
    {"name": "Browser", "description": "Chromium / CDP info and screenshots"},
    {"name": "File", "description": "File operations (read/write/search/list/upload/download)"},
    {"name": "Shell", "description": "Shell sessions and command execution"},
    {"name": "MCP", "description": "Minimal MCP server/tool endpoints"},
]

app = FastAPI(
    title="Linux Workstation Sandbox (local build)",
    version="0.0.1",
    docs_url="/v1/docs",
    openapi_url="/v1/openapi.json",
    openapi_tags=OPENAPI_TAGS,
)


VALID_KEYBOARD_KEYS_SET: Set[str] = {
    "\t",
    "\n",
    "\r",
    " ",
    "!",
    '"',
    "#",
    "$",
    "%",
    "&",
    "'",
    "(",
    ")",
    "*",
    "+",
    ",",
    "-",
    ".",
    "/",
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    ":",
    ";",
    "<",
    "=",
    ">",
    "?",
    "@",
    "[",
    "\\",
    "]",
    "^",
    "_",
    "`",
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
    "k",
    "l",
    "m",
    "n",
    "o",
    "p",
    "q",
    "r",
    "s",
    "t",
    "u",
    "v",
    "w",
    "x",
    "y",
    "z",
    "{",
    "|",
    "}",
    "~",
    "accept",
    "add",
    "alt",
    "altleft",
    "altright",
    "apps",
    "backspace",
    "browserback",
    "browserfavorites",
    "browserforward",
    "browserhome",
    "browserrefresh",
    "browsersearch",
    "browserstop",
    "capslock",
    "clear",
    "convert",
    "ctrl",
    "ctrlleft",
    "ctrlright",
    "decimal",
    "del",
    "delete",
    "divide",
    "down",
    "end",
    "enter",
    "esc",
    "escape",
    "execute",
    "f1",
    "f10",
    "f11",
    "f12",
    "f13",
    "f14",
    "f15",
    "f16",
    "f17",
    "f18",
    "f19",
    "f2",
    "f20",
    "f21",
    "f22",
    "f23",
    "f24",
    "f3",
    "f4",
    "f5",
    "f6",
    "f7",
    "f8",
    "f9",
    "final",
    "fn",
    "hanguel",
    "hangul",
    "hanja",
    "help",
    "home",
    "insert",
    "junja",
    "kana",
    "kanji",
    "launchapp1",
    "launchapp2",
    "launchmail",
    "launchmediaselect",
    "left",
    "modechange",
    "multiply",
    "nexttrack",
    "nonconvert",
    "num0",
    "num1",
    "num2",
    "num3",
    "num4",
    "num5",
    "num6",
    "num7",
    "num8",
    "num9",
    "numlock",
    "pagedown",
    "pageup",
    "pause",
    "pgdn",
    "pgup",
    "playpause",
    "prevtrack",
    "print",
    "printscreen",
    "prntscrn",
    "prtsc",
    "prtscr",
    "return",
    "right",
    "scrolllock",
    "select",
    "separator",
    "shift",
    "shiftleft",
    "shiftright",
    "sleep",
    "stop",
    "subtract",
    "tab",
    "up",
    "volumedown",
    "volumemute",
    "volumeup",
    "win",
    "winleft",
    "winright",
    "yen",
    "command",
    "option",
    "optionleft",
    "optionright",
}


class BaseAction(BaseModel):
    action_type: str


class CoordinateAction(BaseAction):
    x: Optional[float] = None
    y: Optional[float] = None

    @model_validator(mode="after")
    def validate_coordinates(self) -> "CoordinateAction":
        max_x, max_y = pyautogui.size()
        if self.x is not None and not (0 <= self.x <= max_x):
            raise ValueError(f"x coordinate must be between 0 and {max_x}")
        if self.y is not None and not (0 <= self.y <= max_y):
            raise ValueError(f"y coordinate must be between 0 and {max_y}")
        return self


class SingleKeyAction(BaseAction):
    key: str

    @field_validator("key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if v not in VALID_KEYBOARD_KEYS_SET:
            raise ValueError(f"Invalid keyboard key: '{v}'. It is not a valid key.")
        return v


class MoveToAction(CoordinateAction):
    action_type: Literal["MOVE_TO"] = "MOVE_TO"
    x: float = Field(description="Target x-coordinate")
    y: float = Field(description="Target y-coordinate")


class MoveRelAction(BaseAction):
    action_type: Literal["MOVE_REL"] = "MOVE_REL"
    x_offset: float = Field(description="Relative current position x-axis movement")
    y_offset: float = Field(description="Relative current position y-axis movement")


class ClickAction(CoordinateAction):
    action_type: Literal["CLICK"] = "CLICK"
    button: Literal["left", "right", "middle"] = "left"
    num_clicks: Literal[1, 2, 3] = 1


class MouseDownAction(BaseAction):
    action_type: Literal["MOUSE_DOWN"] = "MOUSE_DOWN"
    button: Literal["left", "right", "middle"] = "left"


class MouseUpAction(BaseAction):
    action_type: Literal["MOUSE_UP"] = "MOUSE_UP"
    button: Literal["left", "right", "middle"] = "left"


class RightClickAction(CoordinateAction):
    action_type: Literal["RIGHT_CLICK"] = "RIGHT_CLICK"


class DoubleClickAction(CoordinateAction):
    action_type: Literal["DOUBLE_CLICK"] = "DOUBLE_CLICK"


class DragToAction(CoordinateAction):
    action_type: Literal["DRAG_TO"] = "DRAG_TO"
    x: float = Field(description="Target x-coordinate for drag")
    y: float = Field(description="Target y-coordinate for drag")


class DragRelAction(BaseAction):
    action_type: Literal["DRAG_REL"] = "DRAG_REL"
    x_offset: float = Field(description="Relative current position x-axis drag movement")
    y_offset: float = Field(description="Relative current position y-axis drag movement")


class ScrollAction(BaseAction):
    action_type: Literal["SCROLL"] = "SCROLL"
    dx: int = 0
    dy: int = 0

    @model_validator(mode="after")
    def check_at_least_one_scroll(self) -> "ScrollAction":
        if self.dx == 0 and self.dy == 0:
            raise ValueError("At least one of 'dx' or 'dy' must be non-zero")
        return self


class TypingAction(BaseAction):
    action_type: Literal["TYPING"] = "TYPING"
    text: str = Field(min_length=1)
    use_clipboard: Optional[bool] = Field(
        default=True,
        description="Use clipboard for better character support (recommended for special/ASCII characters)",
    )


class PressAction(SingleKeyAction):
    action_type: Literal["PRESS"] = "PRESS"


class KeyDownAction(SingleKeyAction):
    action_type: Literal["KEY_DOWN"] = "KEY_DOWN"


class KeyUpAction(SingleKeyAction):
    action_type: Literal["KEY_UP"] = "KEY_UP"


class HotkeyAction(BaseAction):
    action_type: Literal["HOTKEY"] = "HOTKEY"
    keys: List[str] = Field(min_length=1)

    @field_validator("keys")
    @classmethod
    def validate_keys(cls, v: List[str]) -> List[str]:
        for key in v:
            if key not in VALID_KEYBOARD_KEYS_SET:
                raise ValueError(f"Invalid keyboard key in list: '{key}'.")
        return v


class WaitAction(BaseAction):
    action_type: Literal["WAIT"] = "WAIT"
    duration: float = Field(gt=0, description="Duration to wait in seconds")


AnyAction = Union[
    MoveToAction,
    MoveRelAction,
    ClickAction,
    MouseDownAction,
    MouseUpAction,
    RightClickAction,
    DoubleClickAction,
    DragToAction,
    DragRelAction,
    ScrollAction,
    TypingAction,
    PressAction,
    KeyDownAction,
    KeyUpAction,
    HotkeyAction,
    WaitAction,
]


class ActionResponse(BaseModel):
    status: Literal["success"]
    action_performed: str


class BrowserOpenUrlInput(BaseModel):
    url: str = Field(min_length=1, description="URL to open in the sandbox Chromium browser.")
    new_tab: bool = Field(default=False, description="Open the URL in a new tab when possible.")
    wait_seconds: float = Field(default=0.75, ge=0, le=10, description="Seconds to wait after navigation before returning.")


REQUEST_BODY_EXAMPLES: Dict[str, Dict[str, Dict[str, Any]]] = {
    "/v1/browser/open_url": {
        "post": {"url": "http://127.0.0.1:8000/index.html", "new_tab": False, "wait_seconds": 0.75}
    },
    "/v1/browser/actions": {
        "post": {"action_type": "CLICK", "x": 640, "y": 360, "button": "left", "num_clicks": 1}
    },
    "/v1/file/read": {
        "post": {"file": "/etc/hosts", "start_line": 0, "end_line": 20}
    },
    "/v1/file/write": {
        "post": {
            "file": "/home/gem/notes.txt",
            "content": "hello world",
            "append": False,
            "trailing_newline": True,
        }
    },
    "/v1/file/replace": {
        "post": {"file": "/home/gem/notes.txt", "old_str": "hello", "new_str": "hi"}
    },
    "/v1/file/search": {"post": {"file": "/home/gem/notes.txt", "regex": "hello"}},
    "/v1/file/find": {"post": {"path": "/home/gem", "glob": "*.py"}},
    "/v1/file/list": {
        "post": {
            "path": "/home/gem",
            "recursive": False,
            "include_size": True,
            "include_permissions": False,
        }
    },
    "/v1/file/str_replace_editor": {
        "post": {
            "command": "view",
            "path": "/home/gem/README.md",
            "view_range": [1, 20],
        }
    },
    "/v1/shell/sessions/create": {
        "post": {"id": "session-1", "exec_dir": "/home/gem"}
    },
    "/v1/shell/exec": {
        "post": {"command": "ls -la", "exec_dir": "/home/gem", "async_mode": False}
    },
    "/v1/shell/view": {"post": {"id": "session-1"}},
    "/v1/shell/wait": {"post": {"id": "session-1", "seconds": 2}},
    "/v1/shell/kill": {"post": {"id": "session-1"}},
    "/v1/mcp/{server_name}/tools/{tool_name}": {
        "post": {"path": "/etc/hosts"}
    },
    "/mcp": {
        "post": {"method": "tools/list", "params": {}}
    },
}

REQUEST_BODY_SCHEMAS: Dict[str, Dict[str, Dict[str, Any]]] = {
    "/v1/browser/open_url": {
        "post": {
            "type": "object",
            "title": "OpenUrlPayload",
            "properties": {
                "url": {"type": "string", "description": "URL to open in the sandbox Chromium browser."},
                "new_tab": {"type": "boolean", "description": "Open the URL in a new tab when possible."},
                "wait_seconds": {"type": "number", "minimum": 0, "maximum": 10, "description": "Seconds to wait after navigation before returning."}
            },
            "required": ["url"],
        }
    },
    "/v1/file/read": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "file": {"type": "string", "description": "Absolute file path to read."},
                "start_line": {"type": "integer", "description": "Optional 0-based inclusive start line."},
                "end_line": {"type": "integer", "description": "Optional 0-based exclusive end line."},
            },
            "required": ["file"],
        }
    },
    "/v1/file/write": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "file": {"type": "string", "description": "Absolute file path to write."},
                "content": {"type": "string", "description": "File contents to write."},
                "encoding": {"type": "string", "enum": ["utf-8", "base64"], "description": "Encoding of content."},
                "append": {"type": "boolean", "description": "Append instead of overwrite."},
                "leading_newline": {"type": "boolean", "description": "Prepend a newline before content for utf-8 writes."},
                "trailing_newline": {"type": "boolean", "description": "Append a newline after content for utf-8 writes."},
            },
            "required": ["file", "content"],
        }
    },
    "/v1/file/replace": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "file": {"type": "string", "description": "Absolute file path to modify."},
                "old_str": {"type": "string", "description": "Text to replace."},
                "new_str": {"type": "string", "description": "Replacement text."},
            },
            "required": ["file", "old_str", "new_str"],
        }
    },
    "/v1/file/search": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "file": {"type": "string", "description": "Absolute file path to search."},
                "regex": {"type": "string", "description": "Regular expression to match."},
            },
            "required": ["file", "regex"],
        }
    },
    "/v1/file/find": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "path": {"type": "string", "description": "Absolute directory path to search."},
                "glob": {"type": "string", "description": "Glob pattern to match file names or relative paths."},
            },
            "required": ["path", "glob"],
        }
    },
    "/v1/file/list": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "path": {"type": "string", "description": "Absolute directory path to list."},
                "recursive": {"type": "boolean"},
                "show_hidden": {"type": "boolean"},
                "max_depth": {"type": "integer"},
                "include_size": {"type": "boolean"},
                "include_permissions": {"type": "boolean"},
                "file_types": {"type": "array", "items": {"type": "string"}},
                "sort_by": {"type": "string", "enum": ["name", "size", "modified", "type"]},
                "sort_desc": {"type": "boolean"},
            },
            "required": ["path"],
        }
    },
    "/v1/file/str_replace_editor": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "command": {"type": "string", "description": "One of: view, create, str_replace, insert, undo_edit."},
                "path": {"type": "string", "description": "Absolute file path."},
                "view_range": {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2},
                "file_text": {"type": "string"},
                "old_str": {"type": "string"},
                "new_str": {"type": "string"},
                "replace_mode": {"type": "string", "enum": ["ALL", "FIRST", "LAST"]},
                "insert_line": {"type": "integer"},
                "history_key": {"type": "string"},
            },
            "required": ["command", "path"],
        }
    },
    "/v1/shell/sessions/create": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "id": {"type": "string", "description": "Optional shell session identifier."},
                "exec_dir": {"type": "string", "description": "Optional absolute working directory."},
            },
        }
    },
    "/v1/shell/exec": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "command": {"type": "string", "description": "Shell command to execute."},
                "exec_dir": {"type": "string", "description": "Optional absolute working directory."},
                "async_mode": {"type": "boolean"},
                "timeout": {"type": "number"},
            },
            "required": ["command"],
        }
    },
    "/v1/shell/view": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "id": {"type": "string", "description": "Shell session identifier."},
            },
            "required": ["id"],
        }
    },
    "/v1/shell/wait": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "id": {"type": "string", "description": "Shell session identifier."},
                "seconds": {"type": "integer", "description": "Maximum seconds to wait."},
            },
            "required": ["id"],
        }
    },
    "/v1/shell/kill": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "id": {"type": "string", "description": "Shell session identifier."},
            },
            "required": ["id"],
        }
    },
    "/v1/mcp/{server_name}/tools/{tool_name}": {
        "post": {
            "type": "object",
            "title": "Request",
            "properties": {
                "path": {"type": "string"},
                "file": {"type": "string"},
                "content": {"type": "string"},
                "command": {"type": "string"},
                "params": {"type": "object", "additionalProperties": True},
            },
            "additionalProperties": True,
        }
    },
    "/mcp": {
        "post": {
            "type": "object",
            "title": "Payload",
            "properties": {
                "method": {"type": "string"},
                "params": {"type": "object", "additionalProperties": True},
            },
            "required": ["method"],
        }
    },
}


def custom_openapi() -> Dict[str, Any]:
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=OPENAPI_TAGS,
    )

    for path, methods in REQUEST_BODY_EXAMPLES.items():
        if path not in openapi_schema.get("paths", {}):
            continue
        for method, example in methods.items():
            op = openapi_schema["paths"][path].get(method)
            if not op:
                continue
            content = (
                op.get("requestBody", {})
                .get("content", {})
                .get("application/json")
            )
            if content is None:
                continue
            schema = REQUEST_BODY_SCHEMAS.get(path, {}).get(method)
            if schema is not None:
                content["schema"] = schema
            content.setdefault("examples", {"example": {"value": example}})
            content.setdefault("example", example)

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/health", tags=["Health"])
def health() -> Dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/v1/ping")
def ping() -> FastAPIResponse:
    return FastAPIResponse(content="pong", media_type="text/plain; charset=utf-8")


@app.get("/v1/sandbox", tags=["Sandbox"])
def get_sandbox() -> Dict[str, Any]:
    home = _workspace()
    width, height = _display_size()
    node_version = _detect_node_version()
    detail = {
        "system": {
            "os": "linux",
            "arch": os.uname().machine,
        },
        "runtime": {
            "python": f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
            "node": node_version,
        },
        "utils": [
            {"category": "browser", "tools": ["chromium", "vnc", "novnc"]},
            {"category": "dev", "tools": ["code-server"]},
        ],
    }
    return {
        "success": True,
        "message": "ok",
        "data": None,
        "home_dir": home,
        "version": "local",
        "detail": detail,
        "display": {"width": width, "height": height},
    }


@app.get("/v1/sandbox/packages/python", tags=["Sandbox"])
def get_python_packages() -> Dict[str, Any]:
    proc = subprocess.run([sys.executable, "-m", "pip", "freeze"], capture_output=True, text=True)
    return _ok({"packages": proc.stdout.splitlines()})


@app.get("/v1/sandbox/packages/nodejs", tags=["Sandbox"])
def get_node_packages() -> Dict[str, Any]:
    return _ok({"packages": _list_node_packages()})


def _resolve_cdp_url(request: Request) -> str:
    port = int(os.environ.get("BROWSER_REMOTE_DEBUGGING_PORT", "9222"))
    ws_url: Optional[str] = None
    try:
        r = httpx.get(f"http://127.0.0.1:{port}/json/version", timeout=1.5)
        r.raise_for_status()
        ws_url = r.json().get("webSocketDebuggerUrl")
    except Exception:
        ws_url = None

    if ws_url and ws_url.startswith("ws://"):
        path = ws_url.split("/", 3)[-1]
        public_host = request.headers.get("host") or request.url.netloc
        ws_scheme = "wss" if (request.headers.get("x-forwarded-proto") == "https") else "ws"
        return f"{ws_scheme}://{public_host}/{path}"

    return f"ws://{request.headers.get('host') or request.url.netloc}/devtools/browser"


def _browser_debug_http_base() -> str:
    port = int(os.environ.get("BROWSER_REMOTE_DEBUGGING_PORT", "9222"))
    return f"http://127.0.0.1:{port}"


def _normalize_browser_url(raw_url: str) -> str:
    url = raw_url.strip()
    if not url:
        _err("url is required")
    if os.path.isabs(url):
        return Path(url).resolve().as_uri()
    if "://" not in url:
        return f"http://{url}"
    return url


def _browser_open_via_cdp(url: str, *, new_tab: bool) -> tuple[bool, Optional[str]]:
    try:
        base = _browser_debug_http_base()
        if new_tab:
            response = httpx.put(f"{base}/json/new?{quote(url, safe='')}", timeout=2.5)
            response.raise_for_status()
            payload = response.json()
            target_id = payload.get("id")
            if isinstance(target_id, str) and target_id:
                httpx.get(f"{base}/json/activate/{target_id}", timeout=1.5)
            return True, "cdp_new_tab"
    except Exception:
        return False, None
    return False, None


def _browser_open_via_gui(url: str, *, new_tab: bool, wait_seconds: float) -> str:
    if new_tab:
        pyautogui.hotkey("ctrl", "t")
        pyautogui.sleep(0.1)
    pyautogui.hotkey("ctrl", "l")
    pyautogui.sleep(0.1)
    pyautogui.typewrite(url)
    pyautogui.press("enter")
    if wait_seconds > 0:
        pyautogui.sleep(wait_seconds)
    return "gui_address_bar"


@app.get("/v1/browser/config", tags=["Browser"])
def browser_config(request: Request) -> Dict[str, Any]:
    width, height = _display_size()
    vnc_url = f"{_public_base(request)}/vnc/vnc_auto.html"
    cdp_url = _resolve_cdp_url(request)
    return _ok(
        {
            "platform": platform.system(),
            "user_agent": os.environ.get("BROWSER_USER_AGENT", "Chromium"),
            "cdp_url": cdp_url,
            "vnc_url": vnc_url,
            "viewport": {"width": width, "height": height},
        }
    )


@app.get("/v1/browser/info", tags=["Browser"])
def browser_info(request: Request) -> Dict[str, Any]:
    width, height = _display_size()
    vnc_url = f"{_public_base(request)}/vnc/vnc_auto.html"
    cdp_url = _resolve_cdp_url(request)

    return {
        "success": True,
        "message": "ok",
        "data": {
            "user_agent": "Chromium",
            "cdp_url": cdp_url,
            "vnc_url": vnc_url,
            "viewport": {"width": width, "height": height},
        },
    }


@app.get("/v1/browser/screenshot", tags=["Browser"])
def browser_screenshot() -> StreamingResponse:
    # Capture the root display (X11) using mss
    with mss.mss() as sct:
        mon = sct.monitors[0]
        img = sct.grab(mon)
        png_bytes = mss_tools.to_png(img.rgb, img.size)

    headers = {
        "content-type": "image/png",
    }
    return StreamingResponse(iter([png_bytes]), media_type="image/png", headers=headers)


@app.post("/v1/browser/open_url", tags=["Browser"])
def browser_open_url(payload: BrowserOpenUrlInput, request: Request) -> Dict[str, Any]:
    normalized_url = _normalize_browser_url(payload.url)
    opened, method = _browser_open_via_cdp(normalized_url, new_tab=payload.new_tab)
    if not opened:
        method = _browser_open_via_gui(normalized_url, new_tab=payload.new_tab, wait_seconds=payload.wait_seconds)
    elif payload.wait_seconds > 0:
        pyautogui.sleep(payload.wait_seconds)

    return _ok(
        {
            "url": normalized_url,
            "new_tab": payload.new_tab,
            "method": method,
            "vnc_url": f"{_public_base(request)}/vnc/vnc_auto.html",
            "cdp_url": _resolve_cdp_url(request),
        }
    )


@app.post("/v1/browser/actions", tags=["Browser"], response_model=ActionResponse)
def browser_actions(action: Annotated[AnyAction, Field(discriminator="action_type")]) -> ActionResponse:
    try:
        if isinstance(action, MoveToAction):
            pyautogui.moveTo(action.x, action.y)
        elif isinstance(action, MoveRelAction):
            pyautogui.moveRel(action.x_offset, action.y_offset)
        elif isinstance(action, ClickAction):
            pyautogui.click(x=action.x, y=action.y, button=action.button, clicks=action.num_clicks)
        elif isinstance(action, MouseDownAction):
            pyautogui.mouseDown(button=action.button)
        elif isinstance(action, MouseUpAction):
            pyautogui.mouseUp(button=action.button)
        elif isinstance(action, RightClickAction):
            pyautogui.rightClick(x=action.x, y=action.y)
        elif isinstance(action, DoubleClickAction):
            pyautogui.doubleClick(x=action.x, y=action.y)
        elif isinstance(action, DragToAction):
            pyautogui.dragTo(action.x, action.y)
        elif isinstance(action, DragRelAction):
            pyautogui.dragRel(action.x_offset, action.y_offset)
        elif isinstance(action, ScrollAction):
            pyautogui.scroll(action.dy)
            pyautogui.hscroll(action.dx)
        elif isinstance(action, TypingAction):
            if action.use_clipboard:
                try:
                    try:
                        original_clipboard = pyperclip.paste()
                    except Exception:
                        original_clipboard = None

                    pyperclip.copy(action.text)
                    if platform.system() == "Darwin":
                        pyautogui.keyUp("fn")
                        pyautogui.sleep(0.1)
                    pyautogui.hotkey("command" if platform.system() == "Darwin" else "ctrl", "v")
                    pyautogui.sleep(0.1)
                    if original_clipboard is not None:
                        pyperclip.copy(original_clipboard)
                except Exception:
                    pyautogui.typewrite(action.text)
            else:
                pyautogui.typewrite(action.text)
        elif isinstance(action, PressAction):
            pyautogui.press(action.key)
        elif isinstance(action, KeyDownAction):
            pyautogui.keyDown(action.key)
        elif isinstance(action, KeyUpAction):
            pyautogui.keyUp(action.key)
        elif isinstance(action, HotkeyAction):
            pyautogui.hotkey(*action.keys)
        elif isinstance(action, WaitAction):
            pyautogui.sleep(action.duration)

        return ActionResponse(status="success", action_performed=action.action_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error during action execution: {exc}")


@app.post("/v1/file/read", tags=["File"])
def file_read(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    path = payload.get("file")
    if not path or not isinstance(path, str):
        _err("file is required")
    if not os.path.isabs(path):
        _err("file must be an absolute path")
    if not os.path.isfile(path):
        _err("file not found", status_code=404)

    start_line = payload.get("start_line")
    end_line = payload.get("end_line")

    collected: List[str] = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        if isinstance(start_line, int) or isinstance(end_line, int):
            start_index = max(int(start_line or 0), 0)
            end_index = int(end_line) if isinstance(end_line, int) else None
            for idx, line in enumerate(f):
                if idx < start_index:
                    continue
                if end_index is not None and idx >= end_index:
                    break
                collected.append(line)
        else:
            collected = f.readlines()

    content = "".join(collected)

    return _ok({"content": content, "file": path})


@app.post("/v1/file/write", tags=["File"])
def file_write(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    path = payload.get("file")
    content = payload.get("content")
    if not path or not isinstance(path, str):
        _err("file is required")
    if not os.path.isabs(path):
        _err("file must be an absolute path")
    if content is None or not isinstance(content, str):
        _err("content is required")

    encoding = payload.get("encoding") or "utf-8"
    append = bool(payload.get("append") or False)
    leading_newline = bool(payload.get("leading_newline") or False)
    trailing_newline = bool(payload.get("trailing_newline") or False)

    os.makedirs(os.path.dirname(path), exist_ok=True)

    if encoding not in {"utf-8", "base64"}:
        _err("encoding must be utf-8 or base64")

    mode = ("ab" if append else "wb") if encoding == "base64" else ("a" if append else "w")

    if encoding == "base64":
        data = base64.b64decode(content)
        with open(path, mode) as f:
            f.write(data)
    else:
        text = content
        if leading_newline:
            text = "\n" + text
        if trailing_newline:
            text = text + "\n"
        with open(path, mode, encoding="utf-8") as f:
            f.write(text)

    return _ok({"file": path})


@app.post("/v1/file/replace", tags=["File"])
def file_replace(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    path = payload.get("file")
    old = payload.get("old_str")
    new = payload.get("new_str")
    if not path or not isinstance(path, str):
        _err("file is required")
    if not os.path.isabs(path):
        _err("file must be an absolute path")
    if not isinstance(old, str) or not isinstance(new, str):
        _err("old_str and new_str are required")

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    replaced = content.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(replaced)

    return _ok({"file": path, "replaced": content != replaced})


@app.post("/v1/file/search", tags=["File"])
def file_search(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    path = payload.get("file")
    pattern = payload.get("regex")
    if not path or not isinstance(path, str):
        _err("file is required")
    if not os.path.isabs(path):
        _err("file must be an absolute path")
    if not pattern or not isinstance(pattern, str):
        _err("regex is required")

    compiled = re.compile(pattern)
    matches: List[str] = []
    line_numbers: List[int] = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for idx, line in enumerate(f, start=1):
            if compiled.search(line):
                matches.append(line.rstrip("\n"))
                line_numbers.append(idx)

    return _ok({"file": path, "matches": matches, "line_numbers": line_numbers})


@app.post("/v1/file/find", tags=["File"])
def file_find(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    path = payload.get("path")
    glob = payload.get("glob")
    if not path or not isinstance(path, str):
        _err("path is required")
    if not os.path.isabs(path):
        _err("path must be an absolute path")
    if not glob or not isinstance(glob, str):
        _err("glob is required")

    base = Path(path)
    if not base.exists() or not base.is_dir():
        _err("path must be an existing directory")

    files: List[str] = []
    for p in base.rglob("*"):
        rel_path = p.relative_to(base).as_posix()
        if p.is_file() and (fnmatch.fnmatch(rel_path, glob) or fnmatch.fnmatch(p.name, glob)):
            files.append(str(p))
    return _ok({"path": path, "files": files})


@app.post("/v1/file/list", tags=["File"])
def file_list(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    path = payload.get("path")
    if not path or not isinstance(path, str):
        _err("path is required")
    if not os.path.isabs(path):
        _err("path must be an absolute path")

    recursive = bool(payload.get("recursive") or False)
    show_hidden = bool(payload.get("show_hidden") or False)
    max_depth = payload.get("max_depth")
    include_size = bool(payload.get("include_size") or False)
    include_permissions = bool(payload.get("include_permissions") or False)
    file_types = payload.get("file_types")
    sort_by = payload.get("sort_by") or "name"
    sort_desc = bool(payload.get("sort_desc") or False)

    base = Path(path)
    if not base.exists() or not base.is_dir():
        _err("path must be an existing directory")

    def allowed(p: Path) -> bool:
        if not show_hidden and p.name.startswith("."):
            return False
        if file_types and isinstance(file_types, list) and p.is_file():
            return any(p.name.endswith(ext) for ext in file_types if isinstance(ext, str))
        return True

    items: List[Path] = []
    if recursive:
        for p in base.rglob("*"):
            if not allowed(p):
                continue
            if isinstance(max_depth, int):
                try:
                    rel_depth = len(p.relative_to(base).parts)
                except Exception:
                    rel_depth = 0
                if rel_depth > max_depth:
                    continue
            items.append(p)
    else:
        for p in base.iterdir():
            if allowed(p):
                items.append(p)

    def file_info(p: Path) -> Dict[str, Any]:
        st = p.stat()
        return {
            "name": p.name,
            "path": str(p),
            "is_directory": p.is_dir(),
            "is_symlink": p.is_symlink(),
            "size": int(st.st_size) if include_size and p.is_file() else None,
            "modified_time": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
            "permissions": oct(st.st_mode & 0o777) if include_permissions else None,
            "extension": p.suffix if p.is_file() else None,
        }

    def sort_key(p: Path):
        try:
            st = p.stat()
        except Exception:
            st = None
        if sort_by == "size":
            return (0 if p.is_dir() else 1, st.st_size if st else 0)
        if sort_by == "modified":
            return st.st_mtime if st else 0
        if sort_by == "type":
            return ("dir" if p.is_dir() else p.suffix)
        return p.name.lower()

    items.sort(key=sort_key, reverse=sort_desc)

    infos = [file_info(p) for p in items]
    dir_count = sum(1 for p in items if p.is_dir())
    file_count = sum(1 for p in items if p.is_file())
    return _ok(
        {
            "path": path,
            "files": infos,
            "total_count": len(infos),
            "directory_count": dir_count,
            "file_count": file_count,
        }
    )


@app.post("/v1/file/upload", tags=["File"])
async def file_upload(
    file: UploadFile = File(...),
    path: Optional[str] = Form(default=None),
) -> Dict[str, Any]:
    dest = path
    if dest is None:
        dest = os.path.join(_workspace(), file.filename or "upload.bin")
    if not os.path.isabs(dest):
        _err("path must be an absolute path")

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    size = 0
    with open(dest, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            f.write(chunk)

    return _ok({"file_path": dest, "file_size": size, "success": True})


@app.get("/v1/file/download", tags=["File"])
def file_download(
    path: str,
    root: Optional[str] = None,
    offset: int = 0,
    limit: Optional[int] = None,
) -> FastAPIResponse:
    if not os.path.isabs(path):
        raise HTTPException(status_code=422, detail="path must be an absolute path")
    if not os.path.exists(path) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="file not found")
    if root is not None:
        if not os.path.isabs(root):
            raise HTTPException(status_code=422, detail="root must be an absolute path")
        resolved_path = Path(path).resolve()
        resolved_root = Path(root).resolve()
        if resolved_path != resolved_root and resolved_root not in resolved_path.parents:
            raise HTTPException(status_code=403, detail="file must stay under root")
        if Path(path).is_symlink():
            raise HTTPException(status_code=403, detail="file must not be a symlink")
    if offset < 0:
        raise HTTPException(status_code=422, detail="offset must be non-negative")
    if limit is not None and (limit < 1 or limit > 1024 * 1024):
        raise HTTPException(status_code=422, detail="limit must be between 1 and 1048576")
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

    def stream_file() -> Any:
        with open(path, "rb") as f:
            f.seek(offset)
            remaining = limit
            while True:
                chunk_size = min(1024 * 1024, remaining) if remaining is not None else 1024 * 1024
                if chunk_size <= 0:
                    break
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                yield chunk
                if remaining is not None:
                    remaining -= len(chunk)

    headers = {"content-disposition": f'attachment; filename="{os.path.basename(path)}"'}
    return StreamingResponse(stream_file(), media_type=media_type, headers=headers)


@app.post("/v1/file/str_replace_editor", tags=["File"])
def file_str_replace_editor(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    command = payload.get("command")
    path = payload.get("path")
    if not isinstance(command, str):
        _err("command is required")
    if not isinstance(path, str) or not os.path.isabs(path):
        _err("path must be an absolute path")

    prev_exist = os.path.exists(path)
    old_content = None
    history_key = _resolve_history_key(payload, create=command in {"create", "str_replace", "insert"})
    if prev_exist and os.path.isfile(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            old_content = f.read()

    try:
        if command == "view":
            if os.path.isdir(path):
                entries = sorted(os.listdir(path))
                out = "\n".join(entries)
                return _ok({"output": out, "error": None, "path": path, "prev_exist": prev_exist, "old_content": None, "new_content": None})

            if not os.path.isfile(path):
                _err("path is not a file", status_code=404)
            view_range = payload.get("view_range")
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            if isinstance(view_range, list) and len(view_range) == 2 and isinstance(view_range[0], int) and isinstance(view_range[1], int):
                start = max(1, view_range[0])
                end = view_range[1]
                if end == -1:
                    sliced = lines[start - 1 :]
                else:
                    sliced = lines[start - 1 : end]
                out = "".join(sliced)
            else:
                out = "".join(lines)
            return _ok({"output": out, "error": None, "path": path, "prev_exist": prev_exist, "old_content": None, "new_content": None})

        if command == "create":
            file_text = payload.get("file_text")
            if not isinstance(file_text, str):
                _err("file_text is required for create")
            assert history_key is not None
            _push_edit_history(history_key, path, prev_exist, old_content)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(file_text)
            return _ok({"output": "created", "error": None, "path": path, "prev_exist": prev_exist, "old_content": None, "new_content": file_text, "history_key": history_key})

        if command == "str_replace":
            old_str = payload.get("old_str")
            new_str = payload.get("new_str")
            if not isinstance(old_str, str):
                _err("old_str is required")
            if new_str is not None and not isinstance(new_str, str):
                _err("new_str must be string")
            if not os.path.isfile(path):
                _err("path is not a file", status_code=404)
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
            replace_mode = payload.get("replace_mode")
            if replace_mode == "ALL":
                new_text = text.replace(old_str, new_str or "")
            elif replace_mode == "FIRST":
                new_text = text.replace(old_str, new_str or "", 1)
            elif replace_mode == "LAST":
                idx = text.rfind(old_str)
                new_text = text if idx < 0 else (text[:idx] + (new_str or "") + text[idx + len(old_str) :])
            else:
                # Default: require unique match
                count = text.count(old_str)
                if count != 1:
                    _err(f"expected unique match, found {count}")
                new_text = text.replace(old_str, new_str or "")
            assert history_key is not None
            _push_edit_history(history_key, path, prev_exist, old_content)
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_text)
            return _ok({"output": "replaced", "error": None, "path": path, "prev_exist": prev_exist, "old_content": text, "new_content": new_text, "history_key": history_key})

        if command == "insert":
            insert_line = payload.get("insert_line")
            new_str = payload.get("new_str")
            if not isinstance(insert_line, int):
                _err("insert_line is required")
            if not isinstance(new_str, str):
                _err("new_str is required")
            if not os.path.isfile(path):
                _err("path is not a file", status_code=404)
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            idx = max(0, min(len(lines), insert_line))
            lines.insert(idx, new_str + "\n")
            new_text = "".join(lines)
            assert history_key is not None
            _push_edit_history(history_key, path, prev_exist, old_content)
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_text)
            return _ok({"output": "inserted", "error": None, "path": path, "prev_exist": prev_exist, "old_content": old_content, "new_content": new_text, "history_key": history_key})

        if command == "undo_edit":
            if history_key is None:
                _err("history_key is required for undo_edit", status_code=409)
            restored = _undo_last_edit(history_key, path)
            return _ok({"output": "undone", "error": None, "path": path, "prev_exist": prev_exist, "old_content": old_content, "new_content": restored["content"], "deleted": restored["deleted"], "history_key": history_key})

        _err("unknown command")
    except HTTPException:
        raise
    except Exception as e:
        return _ok({"output": "", "error": str(e), "path": path, "prev_exist": prev_exist, "old_content": old_content, "new_content": None}, message="error")


@app.post("/v1/shell/sessions/create", tags=["Shell"])
def shell_create_session(payload: Dict[str, Any] = Body(default_factory=dict)) -> Dict[str, Any]:
    sid = payload.get("id")
    exec_dir = payload.get("exec_dir")
    if exec_dir is not None and (not isinstance(exec_dir, str) or not os.path.isabs(exec_dir)):
        _err("exec_dir must be an absolute path")
    s = shell_mgr.get_or_create(sid, exec_dir)
    return _ok({"session_id": s.id, "working_dir": s.working_dir})


@app.get("/v1/shell/sessions", tags=["Shell"])
def shell_list_sessions() -> Dict[str, Any]:
    return _ok({"sessions": shell_mgr.list()})


@app.delete("/v1/shell/sessions", tags=["Shell"])
def shell_cleanup_all() -> Dict[str, Any]:
    shell_mgr.cleanup_all()
    return _ok(None)


@app.delete("/v1/shell/sessions/{session_id}", tags=["Shell"])
def shell_cleanup(session_id: str) -> Dict[str, Any]:
    shell_mgr.cleanup(session_id)
    return _ok(None)


@app.post("/v1/shell/exec", tags=["Shell"])
def shell_exec(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    cmd = payload.get("command")
    argv = payload.get("argv")
    structured = argv is not None
    if argv is not None:
        if not isinstance(argv, list) or not argv or len(argv) > 256:
            _err("argv must be a non-empty array with at most 256 items")
        if any(not isinstance(value, str) or not value or "\x00" in value for value in argv):
            _err("argv items must be non-empty strings without NUL bytes")
        process_args = argv
        command_label = json.dumps(argv, ensure_ascii=False)
    else:
        if not cmd or not isinstance(cmd, str):
            _err("command or argv is required")
        process_args = ["/bin/bash", "--noprofile", "--norc", "-c", cmd]
        command_label = cmd

    sid = payload.get("id")
    exec_dir = payload.get("exec_dir")
    async_mode = bool(payload.get("async_mode") or False)
    timeout = payload.get("timeout")

    if exec_dir is not None and (not isinstance(exec_dir, str) or not os.path.isabs(exec_dir)):
        _err("exec_dir must be an absolute path")

    sess = shell_mgr.get_or_create(sid, exec_dir)
    sess.last_used_at = _now()
    sess.current_command = command_label

    env = os.environ.copy()
    env.setdefault("HOME", _workspace())
    env.setdefault("USER", "gem")
    env_overlay = payload.get("env") or {}
    if not isinstance(env_overlay, dict) or len(env_overlay) > 128:
        _err("env must be an object with at most 128 entries")
    for key, value in env_overlay.items():
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            _err("env keys must be valid environment variable names")
        if not isinstance(value, str) or "\x00" in value or len(value) > 32768:
            _err("env values must be strings without NUL bytes and at most 32768 characters")
        env[key] = value

    if sess.process is not None and sess.process.poll() is None:
        _err("session already has a running command", status_code=409)

    if sess.process is not None and sess.process.poll() is not None:
        _finalize_shell_session(sess)

    if async_mode:
        fd, output_path = tempfile.mkstemp(prefix=f"linux-workstation-shell-{sess.id}-", suffix=".log")
        output_handle = os.fdopen(fd, "w", encoding="utf-8", errors="replace")
        stderr_path = None
        stderr_handle = None
        if structured:
            stderr_fd, stderr_path = tempfile.mkstemp(
                prefix=f"linux-workstation-shell-{sess.id}-", suffix=".err.log"
            )
            stderr_handle = os.fdopen(stderr_fd, "w", encoding="utf-8", errors="replace")
        proc = subprocess.Popen(
            process_args,
            cwd=sess.working_dir,
            stdout=output_handle,
            stderr=stderr_handle if stderr_handle is not None else subprocess.STDOUT,
            text=True,
            env=env,
            start_new_session=True,
        )
        sess.process = proc
        sess.output_path = output_path
        sess.output_handle = output_handle
        sess.stderr_path = stderr_path
        sess.stderr_handle = stderr_handle
        sess.status = "running"
        sess.last_output = ""
        sess.last_stdout = ""
        sess.last_stderr = ""
        sess.exit_code = None
        return _ok(
            {
                "session_id": sess.id,
                "command": command_label,
                "status": "running",
                "output": None,
                "console": [],
                "exit_code": None,
            }
        )

    # synchronous
    t = float(timeout) if isinstance(timeout, (int, float)) else None
    try:
        completed = subprocess.run(
            process_args,
            cwd=sess.working_dir,
            capture_output=True,
            text=True,
            timeout=t,
            env=env,
        )
        out = (completed.stdout or "") + (completed.stderr or "")
        sess.status = "completed"
        sess.exit_code = completed.returncode
        sess.last_output = out
        sess.last_stdout = completed.stdout or ""
        sess.last_stderr = completed.stderr or ""
        return _ok(
            {
                "session_id": sess.id,
                "command": command_label,
                "status": "completed",
                "output": out,
                "stdout": sess.last_stdout,
                "stderr": sess.last_stderr,
                "console": [],
                "exit_code": completed.returncode,
            }
        )
    except subprocess.TimeoutExpired as e:
        # emulate hard_timeout
        sess.status = "hard_timeout"
        sess.last_stdout = e.stdout or ""
        sess.last_stderr = e.stderr or ""
        sess.last_output = sess.last_stdout + sess.last_stderr
        sess.exit_code = None
        return _ok(
            {
                "session_id": sess.id,
                "command": command_label,
                "status": "hard_timeout",
                "output": sess.last_output or None,
                "stdout": sess.last_stdout,
                "stderr": sess.last_stderr,
                "console": [],
                "exit_code": None,
            },
            message="timeout",
        )


@app.post("/v1/shell/view", tags=["Shell"])
def shell_view(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    sid = payload.get("id")
    if not sid or not isinstance(sid, str):
        _err("id is required")
    sess = shell_mgr._sessions.get(sid)
    if not sess:
        _err("unknown session", status_code=404)

    # If async process finished, collect output
    if sess.process is not None and sess.status == "running":
        if sess.process.poll() is not None:
            _finalize_shell_session(sess)
        else:
            sess.last_stdout = _read_shell_stream(sess.output_path, sess.output_handle, sess.last_stdout)
            sess.last_stderr = _read_shell_stream(sess.stderr_path, sess.stderr_handle, sess.last_stderr)
            sess.last_output = sess.last_stdout + sess.last_stderr

    return _ok(
        {
            "output": sess.last_output,
            "stdout": sess.last_stdout,
            "stderr": sess.last_stderr,
            "session_id": sess.id,
            "console": [],
            "status": sess.status,
            "command": sess.current_command,
            "exit_code": sess.exit_code,
        }
    )


@app.post("/v1/shell/wait", tags=["Shell"])
def shell_wait(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    sid = payload.get("id")
    seconds = payload.get("seconds")
    if not sid or not isinstance(sid, str):
        _err("id is required")
    sess = shell_mgr._sessions.get(sid)
    if not sess:
        _err("unknown session", status_code=404)

    if sess.process is None:
        return _ok({"status": sess.status})

    timeout = int(seconds) if isinstance(seconds, int) else 0
    deadline = time.time() + timeout
    while time.time() < deadline:
        if sess.process.poll() is not None:
            break
        time.sleep(0.1)

    if sess.process.poll() is None:
        sess.last_output = _read_shell_output(sess)
        sess.last_stdout = _read_shell_stream(sess.output_path, sess.output_handle, sess.last_stdout)
        sess.last_stderr = _read_shell_stream(sess.stderr_path, sess.stderr_handle, sess.last_stderr)
        return _ok(
            {"status": "running", "output": sess.last_output, "stdout": sess.last_stdout, "stderr": sess.last_stderr}
        )

    # finished
    _finalize_shell_session(sess)
    return _ok(
        {
            "status": "completed",
            "output": sess.last_output,
            "stdout": sess.last_stdout,
            "stderr": sess.last_stderr,
            "exit_code": sess.exit_code,
        }
    )


@app.post("/v1/shell/kill", tags=["Shell"])
def shell_kill(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    sid = payload.get("id")
    if not sid or not isinstance(sid, str):
        _err("id is required")
    sess = shell_mgr._sessions.get(sid)
    if not sess:
        _err("unknown session", status_code=404)
    if sess.process is None:
        return _ok({"status": sess.status, "returncode": sess.exit_code if sess.exit_code is not None else 0})

    _terminate_shell_process(sess.process)

    rc = sess.process.returncode if sess.process.returncode is not None else -1
    _finalize_shell_session(sess, status="terminated")
    sess.exit_code = rc
    return _ok({"status": "terminated", "returncode": rc})


@app.get("/v1/shell/terminal-url", tags=["Shell"])
def shell_terminal_url(request: Request) -> Dict[str, Any]:
    return _ok(f"{_public_base(request)}/v1/shell/terminal/ws")


async def _shell_terminal_ws(ws: WebSocket) -> None:
    await ws.accept()

    def _send_json(payload: Dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False)

    def _write_pty(fd: int, data: bytes) -> None:
        if not data:
            return
        os.write(fd, data)

    session_id = ws.query_params.get("session_id") or uuid.uuid4().hex
    await ws.send_text(_send_json({"type": "session_id", "data": session_id}))
    await ws.send_text(_send_json({"type": "ready", "data": "terminal ready"}))

    master_fd, slave_fd = pty.openpty()
    env = os.environ.copy()
    env.setdefault("TERM", "xterm-256color")
    env.setdefault("HOME", _workspace())
    env.setdefault("USER", "gem")

    proc = subprocess.Popen(
        ["/bin/bash", "--noprofile", "--norc"],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=env,
        cwd=_workspace(),
        start_new_session=True,
        text=False,
    )
    os.close(slave_fd)

    loop = asyncio.get_running_loop()

    async def read_pty() -> None:
        try:
            while True:
                data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                if not data:
                    break
                text = data.decode(errors="replace")
                await ws.send_text(_send_json({"type": "output", "data": text}))
        except Exception:
            pass

    reader_task = asyncio.create_task(read_pty())

    try:
        while True:
            msg = await ws.receive()
            if msg.get("bytes"):
                _write_pty(master_fd, msg["bytes"])
                continue

            text = msg.get("text")
            if not text:
                continue

            if text.startswith("{"):
                try:
                    payload = json.loads(text)
                except Exception:
                    payload = None

                if isinstance(payload, dict):
                    msg_type = payload.get("type")
                    if msg_type == "resize":
                        cols = int(payload.get("cols", 0))
                        rows = int(payload.get("rows", 0))
                        if cols > 0 and rows > 0:
                            size = struct.pack("HHHH", rows, cols, 0, 0)
                            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, size)
                        continue
                    if msg_type == "input":
                        data = payload.get("data")
                        if isinstance(data, str) and data:
                            _write_pty(master_fd, data.encode())
                        continue
                    if msg_type == "ping":
                        await ws.send_text(_send_json({"type": "pong", "timestamp": payload.get("timestamp")}))
                        continue
                    if msg_type == "pong":
                        continue
                    continue

            _write_pty(master_fd, text.encode())
    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except Exception:
            pass


@app.websocket("/v1/shell/terminal/ws")
async def shell_terminal_ws(ws: WebSocket) -> None:
    await _shell_terminal_ws(ws)


@app.websocket("/v1/shell/ws")
async def shell_ws(ws: WebSocket) -> None:
    await _shell_terminal_ws(ws)


# -------------------- MCP (minimal in-process hub) --------------------

MCP_SERVERS = ["browser", "file", "shell", "markitdown"]


def _tool(name: str, description: str, input_schema: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "inputSchema": input_schema,
        "outputSchema": None,
    }


@app.get("/v1/mcp/servers", tags=["MCP"])
def mcp_list_servers() -> Dict[str, Any]:
    return _ok(MCP_SERVERS)


@app.get("/v1/mcp/{server_name}/tools", tags=["MCP"])
def mcp_list_tools(server_name: str) -> Dict[str, Any]:
    if server_name not in MCP_SERVERS:
        _err("unknown mcp server", status_code=404)

    tools: List[Dict[str, Any]] = []
    if server_name == "file":
        tools = [
            _tool("read", "Read a file", {"type": "object", "properties": {"path": {"type": "string"}}}),
            _tool(
                "write",
                "Write a file",
                {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                },
            ),
            _tool(
                "search",
                "Search file content with regex",
                {
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "regex": {"type": "string"}},
                    "required": ["path", "regex"],
                },
            ),
            _tool(
                "find",
                "Find files by glob pattern",
                {
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "glob": {"type": "string"}},
                    "required": ["path", "glob"],
                },
            ),
            _tool(
                "list",
                "List directory contents",
                {
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "recursive": {"type": "boolean"}},
                    "required": ["path"],
                },
            ),
            _tool(
                "replace",
                "Replace string in file",
                {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "old_str": {"type": "string"},
                        "new_str": {"type": "string"},
                    },
                    "required": ["path", "old_str", "new_str"],
                },
            ),
        ]
    if server_name == "shell":
        tools = [
            _tool(
                "exec",
                "Execute a shell command",
                {
                    "type": "object",
                    "properties": {"command": {"type": "string"}},
                    "required": ["command"],
                },
            )
        ]
    if server_name == "browser":
        tools = [
            _tool("get_info", "Get browser info", {"type": "object", "properties": {}}),
            _tool("screenshot", "Take screenshot", {"type": "object", "properties": {}}),
            _tool(
                "open_url",
                "Open a URL in the sandbox Chromium browser",
                {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string"},
                        "new_tab": {"type": "boolean"},
                        "wait_seconds": {"type": "number"},
                    },
                    "required": ["url"],
                },
            ),
            _tool(
                "action",
                "Perform a browser action",
                {
                    "type": "object",
                    "properties": {"action_type": {"type": "string"}},
                    "required": ["action_type"],
                },
            ),
        ]
    if server_name == "markitdown":
        tools = [
            _tool(
                "convert",
                "Convert a supported text-like document to markdown",
                {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
            )
        ]

    return _ok({"tools": tools, "nextCursor": None, "_meta": None})


@app.post("/v1/mcp/{server_name}/tools/{tool_name}", tags=["MCP"])
def mcp_call_tool(
    server_name: str,
    tool_name: str,
    http_request: Request,
    request: Dict[str, Any] = Body(default_factory=dict),
) -> Dict[str, Any]:
    if server_name not in MCP_SERVERS:
        _err("unknown mcp server", status_code=404)

    if server_name == "file" and tool_name == "read":
        path = request.get("path") or request.get("file")
        if not isinstance(path, str):
            _err("path is required")
        res = file_read({"file": path})
        return _ok(
            {
                "content": [{"type": "text", "text": res["data"]["content"]}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "file" and tool_name == "write":
        path = request.get("path") or request.get("file")
        content = request.get("content")
        if not isinstance(path, str) or not isinstance(content, str):
            _err("path and content are required")
        res = file_write({"file": path, "content": content})
        return _ok(
            {
                "content": [{"type": "text", "text": "written"}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "file" and tool_name == "search":
        path = request.get("path") or request.get("file")
        regex = request.get("regex")
        if not isinstance(path, str) or not isinstance(regex, str):
            _err("path and regex are required")
        res = file_search({"file": path, "regex": regex})
        return _ok(
            {
                "content": [{"type": "text", "text": "\n".join(res["data"].get("matches") or [])}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "file" and tool_name == "find":
        path = request.get("path")
        glob = request.get("glob")
        if not isinstance(path, str) or not isinstance(glob, str):
            _err("path and glob are required")
        res = file_find({"path": path, "glob": glob})
        return _ok(
            {
                "content": [{"type": "text", "text": "\n".join(res["data"].get("files") or [])}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "file" and tool_name == "list":
        path = request.get("path")
        recursive = bool(request.get("recursive") or False)
        if not isinstance(path, str):
            _err("path is required")
        res = file_list({"path": path, "recursive": recursive})
        entries = [item.get("path", "") for item in res["data"].get("files") or []]
        return _ok(
            {
                "content": [{"type": "text", "text": "\n".join(entries)}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "file" and tool_name == "replace":
        path = request.get("path") or request.get("file")
        old_str = request.get("old_str")
        new_str = request.get("new_str")
        if not isinstance(path, str) or not isinstance(old_str, str) or not isinstance(new_str, str):
            _err("path, old_str, new_str are required")
        res = file_replace({"file": path, "old_str": old_str, "new_str": new_str})
        return _ok(
            {
                "content": [{"type": "text", "text": "replaced"}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "shell" and tool_name == "exec":
        command = request.get("command")
        if not isinstance(command, str):
            _err("command is required")
        res = shell_exec({"command": command, "exec_dir": _workspace()})
        text = res["data"].get("output") or ""
        return _ok(
            {
                "content": [{"type": "text", "text": text}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "browser" and tool_name == "screenshot":
        # Return base64-encoded PNG
        with mss.mss() as sct:
            mon = sct.monitors[0]
            img = sct.grab(mon)
            png_bytes = mss_tools.to_png(img.rgb, img.size)
        b64 = base64.b64encode(png_bytes).decode("utf-8")
        return _ok(
            {
                "content": [{"type": "image", "data": b64, "mimeType": "image/png"}],
                "structuredContent": None,
                "isError": False,
            }
        )

    if server_name == "browser" and tool_name == "get_info":
        width, height = _display_size()
        if http_request is not None:
            vnc_url = f"{_public_base(http_request)}/vnc/vnc_auto.html"
            cdp_url = _resolve_cdp_url(http_request)
        else:
            public_port = os.environ.get("PUBLIC_PORT", "8080")
            vnc_url = f"http://localhost:{public_port}/vnc/vnc_auto.html"
            cdp_url = f"ws://localhost:{public_port}/devtools/browser"
        return _ok(
            {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "user_agent": "Chromium",
                                "cdp_url": cdp_url,
                                "vnc_url": vnc_url,
                                "viewport": {"width": width, "height": height},
                            }
                        ),
                    }
                ],
                "structuredContent": {
                    "user_agent": "Chromium",
                    "cdp_url": cdp_url,
                    "vnc_url": vnc_url,
                    "viewport": {"width": width, "height": height},
                },
                "isError": False,
            }
        )

    if server_name == "browser" and tool_name == "open_url":
        payload = BrowserOpenUrlInput.model_validate(request)
        res = browser_open_url(payload, http_request)
        return _ok(
            {
                "content": [{"type": "text", "text": json.dumps(res["data"], ensure_ascii=False)}],
                "structuredContent": res["data"],
                "isError": False,
            }
        )

    if server_name == "browser" and tool_name == "action":
        action = TypeAdapter(AnyAction).validate_python(request)
        res = browser_actions(action)
        payload = res.model_dump()
        return _ok(
            {
                "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
                "structuredContent": payload,
                "isError": False,
            }
        )

    if server_name == "markitdown" and tool_name == "convert":
        path = request.get("path")
        if not isinstance(path, str):
            _err("path is required")
        converted = _convert_document_to_markdown(path)
        return _ok(
            {
                "content": [{"type": "text", "text": converted["markdown"]}],
                "structuredContent": converted,
                "isError": False,
            }
        )

    return _ok(
        {
            "content": [{"type": "text", "text": f"tool not implemented: {server_name}/{tool_name}"}],
            "structuredContent": None,
            "isError": True,
        },
        message="not implemented",
    )


@app.get("/mcp", tags=["MCP"])
def mcp_http_get() -> Dict[str, Any]:
    # Basic discovery endpoint; official supports streamable HTTP.
    return {"name": "linux-workstation-sandbox-local", "transport": "http", "ok": True}


@app.post("/mcp", tags=["MCP"])
def mcp_http_post(http_request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    method = payload.get("method")
    params = payload.get("params") or {}
    req_id = payload.get("id")

    def _rpc(result: Any = None, *, error: Any = None) -> Dict[str, Any]:
        resp: Dict[str, Any] = {"jsonrpc": "2.0", "id": req_id}
        if error is not None:
            resp["error"] = error
        else:
            resp["result"] = result
        return resp

    def _rpc_error(code: int, message: str, *, data: Any = None) -> Dict[str, Any]:
        error: Dict[str, Any] = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return _rpc(error=error)

    if method == "initialize":
        return _rpc({
            "protocolVersion": "2024-11-05",
            "serverInfo": {"name": "linux-workstation-sandbox-local", "version": "0.0.1"},
            "capabilities": {"tools": {"listChanged": False}},
        })

    if method == "notifications/initialized":
        return _rpc({})

    if method == "ping":
        return _rpc({})

    if method == "tools/list":
        # Flatten server tools with prefixes (browser_*, file_*, shell_*)
        tools = []
        for server in MCP_SERVERS:
            tool_list = mcp_list_tools(server)["data"]["tools"]
            for t in tool_list:
                tools.append({**t, "name": f"{server}_{t['name']}"})
        return _rpc({"tools": tools})

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str):
            return _rpc_error(-32602, "name is required")

        if "_" not in name:
            return _rpc_error(-32602, "expected tool name like file_read")

        server, tool = name.split("_", 1)
        try:
            res = mcp_call_tool(server, tool, http_request, arguments)
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            return _rpc_error(-32000, detail.get("message", "tool call failed"), data=detail.get("data"))
        return _rpc(res["data"])

    return _rpc_error(-32601, "unsupported method")
