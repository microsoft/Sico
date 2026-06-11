.PHONY: install install-project install-adb test package

install: install-project install-adb

install-project:
	uv sync --python=3.14

install-adb:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/install-adb.ps1
else
	sh scripts/install-adb.sh
endif

test:
	uv run --with pytest pytest tests

package:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/package-skill.ps1
else
	sh scripts/package-skill.sh
endif
