# Install ADB if not already available (Windows)
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    Write-Host "adb not found, installing..."
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install Google.PlatformTools
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install adb -y
    } else {
        Write-Error "Neither winget nor choco found. Install manually: https://developer.android.com/tools/releases/platform-tools"
        exit 1
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
Write-Host "adb version: $(adb version)"
