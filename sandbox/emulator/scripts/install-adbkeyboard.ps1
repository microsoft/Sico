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

<#
.SYNOPSIS
    Installs ADBKeyboard on the first connected Android device.

.DESCRIPTION
    Downloads and installs ADBKeyboard APK to enable Unicode/Chinese text input
    via ADB broadcast. This is required for inputting non-ASCII characters.

    After installation, use this command to input text:
        adb shell am broadcast -a ADB_INPUT_TEXT --es msg "你好世界"

.PARAMETER DeviceSerial
    Optional. The serial of the device to install on (e.g., "127.0.0.1:16384").
    If not specified, auto-discovers via MuMuManager or falls back to the first
    connected device.

.PARAMETER MuMuManagerPath
    Optional. Path to MuMuManager.exe. Defaults to the standard install location.

.PARAMETER Force
    If specified, reinstalls even if already installed.

.EXAMPLE
    .\install-adbkeyboard.ps1

.EXAMPLE
    .\install-adbkeyboard.ps1 -DeviceSerial "127.0.0.1:16384"
#>

[CmdletBinding()]
param(
    [string]$DeviceSerial,
    [string]$MuMuManagerPath = 'C:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$APK_URL = "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.4-dev/keyboardservice-debug.apk"
$APK_NAME = "ADBKeyboard.apk"
$PACKAGE_NAME = "com.android.adbkeyboard"
$IME_ID = "com.android.adbkeyboard/.AdbIME"

function Resolve-AdbPath {
    param(
        [string]$MuMuManagerPath
    )

    $candidates = @()
    if ($MuMuManagerPath -and (Test-Path -LiteralPath $MuMuManagerPath)) {
        $managerDir = Split-Path -Parent $MuMuManagerPath
        if ($managerDir) {
            $candidates += (Join-Path $managerDir 'adb.exe')
        }
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $adbCommand = Get-Command adb -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($adbCommand -and $adbCommand.Source) {
        return $adbCommand.Source
    }

    return $null
}

function Invoke-Adb {
    param(
        [string]$AdbPath,
        [string[]]$Arguments,
        [switch]$IgnoreExitCode
    )

    # PS 5.x turns native stderr into ErrorRecord objects that throw even
    # under ErrorActionPreference=Continue when piped.  Converting every
    # pipeline object to a plain string via ForEach-Object avoids this.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $output = & $AdbPath @Arguments 2>&1 | ForEach-Object { "$_" } | Out-String
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    $trimmedOutput = if ($output) { $output.Trim() } else { '' }

    # When the ADB daemon is not running, adb prints startup noise on
    # stderr but may still succeed.  Retry once if the daemon message
    # appeared and the exit code was non-zero.
    if ($exitCode -ne 0 -and $trimmedOutput -match 'daemon not running|daemon started successfully') {
        $ErrorActionPreference = 'SilentlyContinue'
        try {
            $output = & $AdbPath @Arguments 2>&1 | ForEach-Object { "$_" } | Out-String
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousPreference
        }
        $trimmedOutput = if ($output) { $output.Trim() } else { '' }
    }

    if (-not $IgnoreExitCode -and $exitCode -ne 0) {
        $renderedArgs = ($Arguments | ForEach-Object {
            if ($_ -match '\s') { '"{0}"' -f $_ } else { $_ }
        }) -join ' '

        # Surface a friendlier hint when the ADB server cannot start.
        if ($trimmedOutput -match 'failed to start daemon|cannot connect to daemon') {
            throw ("adb $renderedArgs failed: ADB server could not start. " +
                   "Another adb server or process may be using port 5037. " +
                   "Try: adb kill-server && adb start-server`n$trimmedOutput")
        }

        throw "adb $renderedArgs failed with exit code $exitCode. $trimmedOutput"
    }

    return [pscustomobject]@{
        Output = $trimmedOutput
        ExitCode = $exitCode
    }
}

function Get-AdbDeviceSerials {
    param(
        [string]$AdbPath
    )

    # adb devices can return a non-zero exit code right after daemon startup.
    # Keep that case non-fatal, but still surface real server/daemon failures.
    $result = Invoke-Adb -AdbPath $AdbPath -Arguments @('devices') -IgnoreExitCode
    if ($result.ExitCode -ne 0 -and $result.Output -notmatch 'daemon not running|daemon started successfully') {
        throw "adb devices failed with exit code $($result.ExitCode). $($result.Output)"
    }

    $serials = @()
    foreach ($line in ($result.Output -split "`r?`n")) {
        if ($line -match '^([^\s]+)\s+device$') {
            $serials += $matches[1]
        }
    }

    return $serials
}

function Get-MuMuDeviceSerial {
    param(
        [string]$MuMuManagerPath
    )

    if (-not (Test-Path -LiteralPath $MuMuManagerPath)) {
        return $null
    }

    try {
        $mumuOutput = & $MuMuManagerPath adb -v 0 2>&1 | Out-String
        $json = $mumuOutput | ConvertFrom-Json

        $adbHost = $null
        $adbPort = $null

        if ($json.PSObject.Properties.Name -contains 'adb_host' -and $json.PSObject.Properties.Name -contains 'adb_port') {
            $adbHost = $json.adb_host
            $adbPort = $json.adb_port
        }
        else {
            foreach ($property in $json.PSObject.Properties) {
                $value = $property.Value
                if ($value -and $value.PSObject -and $value.PSObject.Properties.Name -contains 'adb_host' -and $value.PSObject.Properties.Name -contains 'adb_port') {
                    $adbHost = $value.adb_host
                    $adbPort = $value.adb_port
                    break
                }
            }
        }

        if (-not $adbHost -or -not $adbPort) {
            return $null
        }

        $ports = @($adbPort.ToString() -split '[,\s]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
        if (-not $ports.Count) {
            return $null
        }

        $selectedPort = $ports | Where-Object { $_ -ge 16384 } | Select-Object -First 1
        if (-not $selectedPort) {
            $selectedPort = $ports[-1]
        }

        return "${adbHost}:$selectedPort"
    }
    catch {
        Write-Host "MuMuManager discovery failed: $($_.Exception.Message)" -ForegroundColor Yellow
        return $null
    }
}

function Ensure-AdbConnection {
    param(
        [string]$AdbPath,
        [string]$DeviceSerial
    )

    if ($DeviceSerial -notmatch '^\d+\.\d+\.\d+\.\d+:\d+$') {
        return $true
    }

    $connectedSerials = Get-AdbDeviceSerials -AdbPath $AdbPath
    if ($connectedSerials -contains $DeviceSerial) {
        return $true
    }

    Write-Host "Connecting ADB to $DeviceSerial ..." -ForegroundColor Cyan
    $connectResult = Invoke-Adb -AdbPath $AdbPath -Arguments @('connect', $DeviceSerial) -IgnoreExitCode
    if ($connectResult.Output) {
        Write-Host $connectResult.Output
    }

    # Give the transport a moment to register after connect.
    Start-Sleep -Seconds 1

    $connectedSerials = Get-AdbDeviceSerials -AdbPath $AdbPath
    if ($connectedSerials -contains $DeviceSerial) {
        return $true
    }

    Write-Host "Error: Failed to connect ADB to $DeviceSerial" -ForegroundColor Red
    return $false
}

function Get-AdbKeyboardPackages {
    param(
        [string]$AdbPath,
        [string]$DeviceSerial
    )

    $result = Invoke-Adb -AdbPath $AdbPath -Arguments @('-s', $DeviceSerial, 'shell', 'pm', 'list', 'packages')
    return @(
        [regex]::Matches($result.Output, '(?m)^package:([^\r\n]+)$') |
            ForEach-Object { $_.Groups[1].Value.Trim() } |
            Where-Object { $_ -eq $PACKAGE_NAME -or $_ -like "$PACKAGE_NAME.*" -or $_ -match 'adbkeyboard' }
    )
}

function Resolve-AdbKeyboardImeId {
    param(
        [string]$AdbPath,
        [string]$DeviceSerial,
        [AllowEmptyCollection()]
        [string[]]$PackageCandidates = @()
    )

    $result = Invoke-Adb -AdbPath $AdbPath -Arguments @('-s', $DeviceSerial, 'shell', 'ime', 'list', '-a')
    $imeIds = @(
        [regex]::Matches($result.Output, 'mId=([^\s]+)') |
            ForEach-Object { $_.Groups[1].Value.Trim() }
    )

    foreach ($packageName in $PackageCandidates) {
        $matchedIme = $imeIds | Where-Object { $_ -like "$packageName/*" } | Select-Object -First 1
        if ($matchedIme) {
            return $matchedIme
        }
    }

    return $imeIds | Where-Object { $_ -eq $IME_ID -or $_ -match 'adbkeyboard' } | Select-Object -First 1
}

function Wait-ForAdbKeyboard {
    param(
        [string]$AdbPath,
        [string]$DeviceSerial,
        [int]$TimeoutSeconds = 8
    )

    for ($attempt = 1; $attempt -le $TimeoutSeconds; $attempt++) {
        $installedPackages = Get-AdbKeyboardPackages -AdbPath $AdbPath -DeviceSerial $DeviceSerial
        $resolvedImeId = Resolve-AdbKeyboardImeId -AdbPath $AdbPath -DeviceSerial $DeviceSerial -PackageCandidates $installedPackages
        if ($resolvedImeId) {
            return [pscustomobject]@{
                InstalledPackages = $installedPackages
                ImeId = $resolvedImeId
            }
        }

        Start-Sleep -Seconds 1
    }

    return [pscustomobject]@{
        InstalledPackages = @(Get-AdbKeyboardPackages -AdbPath $AdbPath -DeviceSerial $DeviceSerial)
        ImeId = $null
    }
}

function Enable-AdbKeyboardIme {
    param(
        [string]$AdbPath,
        [string]$DeviceSerial,
        [string]$ImeId
    )

    if (-not $ImeId) {
        throw 'ADBKeyboard IME was not found on the device after installation.'
    }

    Write-Host "Enabling ADBKeyboard IME: $ImeId" -ForegroundColor Cyan

    $enableResult = Invoke-Adb -AdbPath $AdbPath -Arguments @('-s', $DeviceSerial, 'shell', 'ime', 'enable', $ImeId) -IgnoreExitCode
    if ($enableResult.ExitCode -ne 0 -or $enableResult.Output -match 'Unknown input method') {
        throw "Failed to enable IME '$ImeId'. $($enableResult.Output)"
    }

    $setResult = Invoke-Adb -AdbPath $AdbPath -Arguments @('-s', $DeviceSerial, 'shell', 'ime', 'set', $ImeId) -IgnoreExitCode
    if ($setResult.ExitCode -ne 0 -or $setResult.Output -match 'Unknown input method') {
        throw "Failed to set IME '$ImeId'. $($setResult.Output)"
    }
}

# Find adb
$adb = Resolve-AdbPath -MuMuManagerPath $MuMuManagerPath
if (-not $adb) {
    Write-Host "Error: adb not found. Install MuMu Player or run install-adb.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "Using adb: $adb" -ForegroundColor DarkGray

# ---------- Determine device serial ----------
if (-not $DeviceSerial) {
    # Try MuMuManager first
    if (Test-Path $MuMuManagerPath) {
        Write-Host "Discovering ADB port via MuMuManager..." -ForegroundColor Cyan
        $DeviceSerial = Get-MuMuDeviceSerial -MuMuManagerPath $MuMuManagerPath
        if ($DeviceSerial) {
            Write-Host "MuMuManager reported device: $DeviceSerial" -ForegroundColor Green
        }
        else {
            Write-Host "MuMuManager discovery failed, falling back to adb devices." -ForegroundColor Yellow
        }
    }

    # Fall back: pick the first connected device
    if (-not $DeviceSerial) {
        $devices = Get-AdbDeviceSerials -AdbPath $adb
        if ($devices.Count -gt 0) {
            $DeviceSerial = $devices[0]
        } else {
            Write-Host "Error: No connected devices found and MuMuManager unavailable." -ForegroundColor Red
            Write-Host "Make sure MuMu emulator is running." -ForegroundColor Yellow
            exit 1
        }
    }
}

Write-Host "Using device: $DeviceSerial" -ForegroundColor Cyan

# ---------- Ensure ADB connection (TCP devices need explicit connect) ----------
if (-not (Ensure-AdbConnection -AdbPath $adb -DeviceSerial $DeviceSerial)) {
    exit 1
}

# Check if already installed
if (-not $Force) {
    $installedPackages = Get-AdbKeyboardPackages -AdbPath $adb -DeviceSerial $DeviceSerial
    if ($installedPackages.Count -gt 0) {
        Write-Host "ADBKeyboard is already installed on $DeviceSerial" -ForegroundColor Yellow
        Write-Host "Use -Force to reinstall." -ForegroundColor Yellow

        $resolvedImeId = Resolve-AdbKeyboardImeId -AdbPath $adb -DeviceSerial $DeviceSerial -PackageCandidates $installedPackages
        if (-not $resolvedImeId) {
            Write-Host "Error: ADBKeyboard package exists, but no matching IME was registered on the device." -ForegroundColor Red
            Write-Host "Packages found: $($installedPackages -join ', ')" -ForegroundColor Yellow
            Write-Host "Run 'adb shell ime list -a' on the Windows host to inspect the available IMEs." -ForegroundColor Yellow
            exit 1
        }

        Enable-AdbKeyboardIme -AdbPath $adb -DeviceSerial $DeviceSerial -ImeId $resolvedImeId
        $currentIme = (Invoke-Adb -AdbPath $adb -Arguments @('-s', $DeviceSerial, 'shell', 'settings', 'get', 'secure', 'default_input_method')).Output
        if ($currentIme.Trim() -eq $resolvedImeId) {
            Write-Host "Done. ADBKeyboard is active." -ForegroundColor Green
        } else {
            Write-Host "Warning: ADBKeyboard may not be set as default IME. Current: $($currentIme.Trim())" -ForegroundColor Yellow
        }
        exit 0
    }
}

# Download APK
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ApkPath = Join-Path $ScriptDir $APK_NAME

# When -Force, remove existing APK so we re-download a fresh copy.
if ($Force -and (Test-Path $ApkPath)) {
    Remove-Item -LiteralPath $ApkPath -Force
    Write-Host "Removed existing APK (forced re-download)." -ForegroundColor DarkGray
}

if (-not (Test-Path $ApkPath)) {
    Write-Host "Downloading ADBKeyboard APK..." -ForegroundColor Cyan
    Write-Host "URL: $APK_URL"

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $APK_URL -OutFile $ApkPath -UseBasicParsing

        $size = (Get-Item $ApkPath).Length
        Write-Host "Downloaded: $ApkPath ($size bytes)" -ForegroundColor Green
    }
    catch {
        Write-Host "Error: Failed to download APK" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}

# Validate the downloaded file is actually an APK (ZIP with PK header).
$apkHeader = [byte[]](Get-Content -LiteralPath $ApkPath -Encoding Byte -ReadCount 4 -TotalCount 4)
if ($apkHeader.Length -lt 2 -or $apkHeader[0] -ne 0x50 -or $apkHeader[1] -ne 0x4B) {
    $actualSize = (Get-Item $ApkPath).Length
    Write-Host "Error: Downloaded file is not a valid APK (size=$actualSize, header=$($apkHeader -join ',')). " -ForegroundColor Red
    Write-Host "The GitHub download may have returned an HTML redirect page instead of the binary." -ForegroundColor Yellow
    Write-Host "Deleting invalid file. Please re-run the script to try again." -ForegroundColor Yellow
    Remove-Item -LiteralPath $ApkPath -Force
    exit 1
}

# Install APK
Write-Host "Installing ADBKeyboard on $DeviceSerial..." -ForegroundColor Cyan
$installResult = Invoke-Adb -AdbPath $adb -Arguments @('-s', $DeviceSerial, 'install', '-r', $ApkPath) -IgnoreExitCode
if ($installResult.ExitCode -ne 0 -or $installResult.Output -match 'Failure') {
    Write-Host "Error: Failed to install APK" -ForegroundColor Red
    Write-Host $installResult.Output -ForegroundColor Red
    exit 1
}
if ($installResult.Output -notmatch 'Success') {
    Write-Host "Warning: adb install did not report 'Success'. Output:" -ForegroundColor Yellow
    Write-Host $installResult.Output -ForegroundColor Yellow
}
Write-Host "APK installed successfully." -ForegroundColor Green

# Enable and set as default input method
$keyboardState = Wait-ForAdbKeyboard -AdbPath $adb -DeviceSerial $DeviceSerial
$installedPackages = $keyboardState.InstalledPackages
$resolvedImeId = $keyboardState.ImeId
if (-not $resolvedImeId) {
    Write-Host "Error: APK install succeeded, but the device did not register an ADBKeyboard IME within the wait window." -ForegroundColor Red
    if ($installedPackages.Count -gt 0) {
        Write-Host "Packages found: $($installedPackages -join ', ')" -ForegroundColor Yellow
    }
    else {
        Write-Host "No matching adbkeyboard package was visible via 'pm list packages'." -ForegroundColor Yellow
    }
    Write-Host "Run 'adb shell ime list -a' on the Windows host to inspect the available IMEs." -ForegroundColor Yellow
    exit 1
}

Enable-AdbKeyboardIme -AdbPath $adb -DeviceSerial $DeviceSerial -ImeId $resolvedImeId

$currentIme = (Invoke-Adb -AdbPath $adb -Arguments @('-s', $DeviceSerial, 'shell', 'settings', 'get', 'secure', 'default_input_method')).Output
if ($currentIme.Trim() -ne $resolvedImeId) {
    Write-Host "Warning: ADBKeyboard may not be set as default IME. Current: $($currentIme.Trim())" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Green
Write-Host "ADBKeyboard installed and enabled!" -ForegroundColor Green
Write-Host ("=" * 60) -ForegroundColor Green
Write-Host ""
Write-Host "Usage: Input text via ADB broadcast:" -ForegroundColor Cyan
Write-Host '  adb shell am broadcast -a ADB_INPUT_TEXT --es msg "你好世界"' -ForegroundColor White
Write-Host ""
Write-Host "Note: Make sure an input field is focused before sending text." -ForegroundColor Yellow
