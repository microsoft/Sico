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

[CmdletBinding()]
param(
    # If specified, will add the detected adb folder to the current user's PATH.
    [switch]$AddToPath = $true,

    # If specified, will skip winget installation and only attempt to locate/verify adb.
    [switch]$SkipInstall,

    # If specified, uses machine PATH (requires admin). Default is user PATH.
    [switch]$MachinePath,

    # If specified, adds a Windows Firewall allow rule for adb.exe (requires admin).
    [switch]$AllowFirewall = $true
)

$ErrorActionPreference = 'Stop'

function Test-Command {
    param([Parameter(Mandatory=$true)][string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-AdbFromKnownLocations {
    $candidates = @()

    if ($env:LOCALAPPDATA) {
        $candidates += Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Android\Sdk\platform-tools\adb.exe'
    }

    $candidates += @(
        'C:\Android\platform-tools\adb.exe'
        'C:\Program Files\Android\platform-tools\adb.exe'
        'C:\Program Files (x86)\Android\platform-tools\adb.exe'
    )

    # Common WinGet package locations
    $wingetPackagesRoots = @()

    if ($env:LOCALAPPDATA) {
        $wingetPackagesRoots += Join-Path -Path $env:LOCALAPPDATA -ChildPath 'Microsoft\WinGet\Packages'
    }
    if ($env:ProgramFiles) {
        $wingetPackagesRoots += Join-Path -Path $env:ProgramFiles -ChildPath 'WinGet\Packages'
    }

    foreach ($root in $wingetPackagesRoots) {
        if (Test-Path $root) {
            $candidates += Get-ChildItem -Path $root -Filter 'adb.exe' -Recurse -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty FullName
        }
    }

    $existing = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
    if (-not $existing) { return $null }

    # Prefer the newest by file modified time
    return ($existing | Sort-Object { (Get-Item $_).LastWriteTimeUtc } -Descending | Select-Object -First 1)
}

function Add-ToPath {
    param(
        [Parameter(Mandatory=$true)][string]$Directory,
        [switch]$Machine
    )

    if (-not (Test-Path $Directory)) {
        throw "Directory not found: $Directory"
    }

    $target = if ($Machine) { 'Machine' } else { 'User' }
    $current = [Environment]::GetEnvironmentVariable('Path', $target)

    $parts = @()
    if ($current) {
        $parts = $current.Split(';') | Where-Object { $_ -ne '' }
    }

    if ($parts -contains $Directory) {
        Write-Host "PATH already contains: $Directory" -ForegroundColor Green
    } else {
        $updated = ($parts + $Directory) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $updated, $target)
        Write-Host "Added to $target PATH: $Directory" -ForegroundColor Green
    }

    # Update current process PATH so adb is usable immediately
    if (-not ($env:Path.Split(';') -contains $Directory)) {
        $env:Path = $env:Path.TrimEnd(';') + ';' + $Directory
    }
}

Write-Host "Checking for adb..." -ForegroundColor Cyan
if (Test-Command 'adb') {
    Write-Host "adb is already available in PATH." -ForegroundColor Green
    $adbExe = (Get-Command adb).Source
} else {
    $adbExe = $null
}

if (-not $adbExe -and -not $SkipInstall) {
    if (-not (Test-Command 'winget')) {
        throw "winget not found. Install 'App Installer' from Microsoft Store or enable winget first."
    }

    Write-Host "Installing Android SDK Platform-Tools via winget..." -ForegroundColor Cyan
    winget install --id Google.PlatformTools -e --source winget --accept-source-agreements --accept-package-agreements
}

if (-not $adbExe) {
    $adbExe = Get-AdbFromKnownLocations
}
if (-not $adbExe) {
    throw "adb.exe not found after installation. Try opening a new terminal, or locate platform-tools manually."
}

$adbDir = Split-Path -Parent $adbExe
Write-Host "Found adb at: $adbExe" -ForegroundColor Green

if ($AddToPath) {
    if ($MachinePath) {
        # Admin required
        $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if (-not $isAdmin) {
            throw "-MachinePath requires running PowerShell as Administrator."
        }
    }

    Add-ToPath -Directory $adbDir -Machine:$MachinePath
}

if ($AllowFirewall) {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        throw "-AllowFirewall requires running PowerShell as Administrator."
    }

    $ruleName = "MuMu adb"
    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if ($existingRule) {
        Write-Host "Firewall rule already exists: $ruleName" -ForegroundColor Green
    } else {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Program $adbExe -Action Allow -Profile Private,Public | Out-Null
        Write-Host "Added firewall rule for adb: $adbExe" -ForegroundColor Green
    }
}

Write-Host "Verifying adb..." -ForegroundColor Cyan
& $adbExe version
Write-Host "Done." -ForegroundColor Green
