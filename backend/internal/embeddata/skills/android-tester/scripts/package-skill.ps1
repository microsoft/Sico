# Package the android-tester skill into a distributable zip.
#
# Output: build/android-tester-skill.zip in the repo root
#
# Contents (all at archive root):
#   android_tester/
#   data/
#   pyproject.toml
#   SKILL.md
#   config.env (copied from config.env.example if not present)
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BuildDir = Join-Path $RepoRoot "build"
$OutZip = Join-Path $BuildDir "android-tester-skill.zip"
$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("android-tester-pkg-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$StageDir = Join-Path $TmpDir "stage"

try {
    New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

    # Copy main directories and files
    $items = @("android_tester", "data", "pyproject.toml", "SKILL.md", "README.md", "scripts")
    foreach ($item in $items) {
        $src = Join-Path $RepoRoot $item
        if (Test-Path $src) {
            $dst = Join-Path $StageDir $item
            if ((Get-Item $src).PSIsContainer) {
                Copy-Item -Recurse -Path $src -Destination $dst
            } else {
                Copy-Item -Path $src -Destination $dst
            }
        }
    }

    # Copy config.env if present, otherwise fall back to config.env.example
    $cfgFile = Join-Path $RepoRoot "config.env"
    $cfgExample = Join-Path $RepoRoot "config.env.example"
    $cfgDest = Join-Path $StageDir "config.env"
    if (Test-Path $cfgFile) {
        Copy-Item -Path $cfgFile -Destination $cfgDest
    } elseif (Test-Path $cfgExample) {
        Copy-Item -Path $cfgExample -Destination $cfgDest
    }

    # Remove build artifacts and unnecessary files
    Get-ChildItem -Path $StageDir -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
    Get-ChildItem -Path $StageDir -Recurse -File -Filter "*.pyc" | Remove-Item -Force
    Get-ChildItem -Path $StageDir -Recurse -File -Filter "config.env.example" | Remove-Item -Force
    Get-ChildItem -Path $StageDir -Recurse -File -Filter "package-skill.*" | Remove-Item -Force
    foreach ($dir in @(".git", ".idea", ".vscode")) {
        $d = Join-Path $StageDir $dir
        if (Test-Path $d) { Remove-Item -Recurse -Force $d }
    }

    # Clean previous build and create zip
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null
    if (Test-Path $OutZip) { Remove-Item -Force $OutZip }

    $archiveItems = Get-ChildItem -Path $StageDir -Force
    Compress-Archive -Path $archiveItems.FullName -DestinationPath $OutZip

    $size = (Get-Item $OutZip).Length
    $sizeKB = [math]::Round($size / 1024, 1)
    Write-Host ""
    Write-Host "Packaged: $OutZip"
    Write-Host "   Size: ${sizeKB}KB"
} finally {
    if (Test-Path $TmpDir) {
        Remove-Item -Recurse -Force $TmpDir
    }
}
