<#
 Copyright (c) 2026 Sico Authors

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
#>

#Requires -Version 5.1
<#
.SYNOPSIS
    Install developer tooling required to contribute to sico on Windows.

.DESCRIPTION
    Uses winget (preferred) or Chocolatey to install Go, Python, Node.js, pnpm,
    pre-commit, golangci-lint, and addlicense by default. Pass -WithHelm to
    also install Helm, kubectl, and kind for Kind / Helm chart work.
    Idempotent.

.PARAMETER Check
    Only verify required tools are present without installing anything.

.PARAMETER WithHelm
    Include Helm, kubectl, and kind in the install / check set for Kind or
    Helm chart work.

.EXAMPLE
    .\scripts\install-dev-tools.ps1
    .\scripts\install-dev-tools.ps1 -Check
#>

[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$WithHelm
)

$ErrorActionPreference = "Stop"

function Write-Info($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn2($msg) { Write-Host "==> $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "==> $msg" -ForegroundColor Red }

function Test-Command($name) {
    $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Use-Winget   { Test-Command winget }
function Use-Choco    { Test-Command choco }

function Install-Via($wingetId, $chocoId) {
    if (Use-Winget) {
        winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
    } elseif (Use-Choco) {
        choco install $chocoId -y
    } else {
        throw "Neither winget nor Chocolatey is available. Install one first: https://learn.microsoft.com/windows/package-manager/winget/"
    }
}

function Ensure-Go {
    if (Test-Command go) { Write-Info ("go:          " + (go version)); return }
    if ($Check) { Write-Warn2 "go missing"; return }
    Write-Info "Installing Go..."
    Install-Via "GoLang.Go" "golang"
}

function Ensure-Python {
    if (Test-Command python) { Write-Info ("python:      " + (python --version)); return }
    if ($Check) { Write-Warn2 "python missing"; return }
    Write-Info "Installing Python 3..."
    Install-Via "Python.Python.3.13" "python"
}

function Ensure-Uv {
    if (Test-Command uv) { Write-Info ("uv:          " + (uv --version)); return }
    if ($Check) { Write-Warn2 "uv missing"; return }
    Write-Info "Installing uv..."
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
}

function Ensure-Node {
    if (Test-Command node) { Write-Info ("node:        " + (node --version)); return }
    if ($Check) { Write-Warn2 "node missing"; return }
    Write-Info "Installing Node.js..."
    Install-Via "OpenJS.NodeJS.LTS" "nodejs-lts"
}

function Ensure-Pnpm {
    if (Test-Command pnpm) { Write-Info ("pnpm:        " + (pnpm --version)); return }
    if ($Check) { Write-Warn2 "pnpm missing"; return }
    Write-Info "Installing pnpm (standalone, user-local)..."
    # Prefer the standalone installer: it writes to %LOCALAPPDATA%\pnpm and
    # does NOT need write access to the Node.js install directory. This avoids
    # the EPERM errors that `corepack enable` triggers when Node lives in a
    # protected location like C:\Program Files or C:\Softwares\nodejs.
    try {
        Invoke-RestMethod https://get.pnpm.io/install.ps1 | Invoke-Expression
    } catch {
        Write-Warn2 "Standalone pnpm installer failed: $($_.Exception.Message)"
        Write-Warn2 "Falling back to corepack (may require an elevated shell)..."
        if (Test-Command corepack) {
            corepack enable
            corepack prepare pnpm@latest --activate
        } else {
            npm install -g pnpm
        }
    }
    # Refresh PATH for the current process so subsequent steps see pnpm.
    $pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
    if ((Test-Path $pnpmHome) -and ($env:Path -notlike "*$pnpmHome*")) {
        $env:Path = "$pnpmHome;$env:Path"
    }
}

function Ensure-PreCommit {
    if (Test-Command pre-commit) { Write-Info ("pre-commit:  " + (pre-commit --version)); return }
    if ($Check) { Write-Warn2 "pre-commit missing"; return }
    Write-Info "Installing pre-commit..."
    # Prefer uv (already installed above) — it drops a single self-contained
    # shim into %USERPROFILE%\.local\bin and manages PATH for us.
    $installed = $false
    if (Test-Command uv) {
        try {
            uv tool install pre-commit
            uv tool update-shell | Out-Null
            $installed = $true
        } catch {
            Write-Warn2 "uv tool install failed: $($_.Exception.Message)"
        }
    }
    if (-not $installed) {
        if (Test-Command pipx) {
            pipx install pre-commit
            pipx ensurepath | Out-Null
        } else {
            python -m pip install --user pre-commit
        }
    }
    # Refresh PATH so the rest of this script (and the user's *next* shell)
    # can find pre-commit. We touch both the in-process PATH and the
    # persistent per-user PATH.
    $candidates = @()
    $candidates += (Join-Path $env:USERPROFILE ".local\bin")        # uv tool install
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\pipx\bin") # pipx default
    try {
        $userBase = (python -m site --user-base) 2>$null
        if (-not [string]::IsNullOrWhiteSpace($userBase)) {
            $candidates += (Join-Path $userBase.Trim() "Scripts")    # pip --user
        }
    } catch {}
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }
    $userPathChanged = $false
    foreach ($dir in $candidates) {
        if (-not (Test-Path $dir)) { continue }
        if ($env:Path -notlike "*$dir*") { $env:Path = "$dir;$env:Path" }
        if (($userPath -split ';') -notcontains $dir) {
            $userPath = if ([string]::IsNullOrEmpty($userPath)) { $dir } else { "$dir;$userPath" }
            $userPathChanged = $true
        }
    }
    if ($userPathChanged) {
        [Environment]::SetEnvironmentVariable("Path", $userPath, "User")
        Write-Info "Updated user PATH to include pre-commit install dir(s). Open a new shell to pick it up."
    }
    if (-not (Test-Command pre-commit)) {
        Write-Warn2 "pre-commit installed but not on PATH yet; open a new shell and re-run."
    }
}

function Ensure-AddLicense {
    if (Test-Command addlicense) { Write-Info "addlicense:  found"; return }
    if ($Check) { Write-Warn2 "addlicense missing"; return }
    Write-Info "Installing addlicense..."
    $env:GO111MODULE = "on"
    go install github.com/google/addlicense@v1.2.0
    $gobin = go env GOBIN
    if ([string]::IsNullOrEmpty($gobin)) { $gobin = (Join-Path (go env GOPATH) "bin") }
    Write-Warn2 "Ensure $gobin is on your PATH."
}

function Ensure-Helm {
    if (Test-Command helm) { Write-Info ("helm:        " + (helm version --short)); return }
    if ($Check) { Write-Warn2 "helm missing"; return }
    Write-Info "Installing Helm..."
    Install-Via "Helm.Helm" "kubernetes-helm"
}

function Ensure-Kubectl {
    if (Test-Command kubectl) { Write-Info ("kubectl:     " + ((kubectl version --client=true 2>$null) | Select-Object -First 1)); return }
    if ($Check) { Write-Warn2 "kubectl missing"; return }
    Write-Info "Installing kubectl..."
    Install-Via "Kubernetes.kubectl" "kubernetes-cli"
}

function Ensure-Kind {
    if (Test-Command kind) { Write-Info ("kind:        " + (kind version)); return }
    if ($Check) { Write-Warn2 "kind missing"; return }
    Write-Info "Installing kind..."
    Install-Via "Kubernetes.kind" "kind"
}

function Ensure-GolangCiLint {
    if (Test-Command golangci-lint) { Write-Info ("golangci:    " + (golangci-lint --version | Select-Object -First 1)); return }
    if ($Check) { Write-Warn2 "golangci-lint missing (optional)"; return }
    Write-Info "Installing golangci-lint..."
    $gopath = go env GOPATH
    $installer = Join-Path $env:TEMP "install-golangci-lint.sh"
    if (Test-Command bash) {
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh" -OutFile $installer
        bash $installer -b (Join-Path $gopath "bin") v2.11.0
    } else {
        Write-Warn2 "bash not found; please install golangci-lint manually: https://golangci-lint.run/"
    }
}

Ensure-Go
Ensure-Python
Ensure-Uv
Ensure-Node
Ensure-Pnpm
Ensure-PreCommit
Ensure-AddLicense
if ($WithHelm) {
    Ensure-Helm
    Ensure-Kubectl
    Ensure-Kind
}
Ensure-GolangCiLint

if ($Check) {
    Write-Info "Check complete."
    exit 0
}

if (Test-Path ".pre-commit-config.yaml") {
    if (Test-Command pre-commit) {
        Write-Info "Installing git pre-commit hook..."
        pre-commit install
    } else {
        Write-Warn2 "Skipping 'pre-commit install': command not on PATH yet. Open a new shell and run 'pre-commit install'."
    }
}

Write-Info "Done. Run 'pre-commit run --all-files' to verify headers on the full tree."
