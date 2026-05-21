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

"""
Custom logger implementation with timestamp formatting.

Provides a Logger class and a default logger instance for easy importing.
"""

import logging
import traceback
from datetime import datetime
from typing import Any


class Logger:
    """Custom logger class that supports info, warn, error, and debug methods."""

    def __init__(self, name: str = "default"):
        self.logger = logging.getLogger(name)
        self.name = name

    def _format_message(self, level: str, *args: Any) -> str:
        """Format log message with timestamp and level."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        message = " ".join(str(arg) for arg in args)
        return f"[{timestamp}] [{level}] {message}"

    def traceback(self, *args: Any) -> None:
        """Log a message with traceback information."""
        message = self._format_message("TRACEBACK", *args)
        message += "\n" + traceback.format_exc()
        self.logger.info(message)

    def info(self, *args: Any) -> None:
        """Log an info level message."""
        message = self._format_message("INFO", *args)
        self.logger.info(message)

    def warn(self, *args: Any) -> None:
        """Log a warning level message."""
        message = self._format_message("WARN", *args)
        self.logger.warning(message)

    def error(self, *args: Any) -> None:
        """Log an error level message."""
        message = self._format_message("ERROR", *args)
        self.logger.error(message)

    def debug(self, *args: Any) -> None:
        """Log a debug level message."""
        message = self._format_message("DEBUG", *args)
        self.logger.debug(message)

    def warning(self, *args: Any) -> None:
        """Log a warning level message (alias for warn)."""
        self.warn(*args)

# Default logger instance for easy importing
logger = Logger(__name__)
