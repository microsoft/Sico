[CmdletBinding()]
param(
    # If true (default), restart immediately when this run enables any target feature.
    # Pass -NoRestart to suppress automatic reboot.
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    throw "Please run this script in an elevated PowerShell session (Administrator)."
}

Write-Host "Checking Hyper-V and virtualization platform features..." -ForegroundColor Cyan

$targetFeatures = @(
    'Microsoft-Hyper-V-All',
    'VirtualMachinePlatform',
    'HypervisorPlatform'
)

$featureStatesBefore = @{}
foreach ($feature in $targetFeatures) {
    $featureStatesBefore[$feature] = (Get-WindowsOptionalFeature -Online -FeatureName $feature).State
}

$featuresToEnable = @($targetFeatures | Where-Object { $featureStatesBefore[$_] -ne 'Enabled' })

if ($featuresToEnable.Count -eq 0) {
    Write-Host "All target virtualization features are already enabled. No changes needed." -ForegroundColor Green
} else {
    Write-Host "Enabling missing features..." -ForegroundColor Cyan
    foreach ($feature in $featuresToEnable) {
        Write-Host "Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart" -ForegroundColor Yellow
        Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart | Out-Host
    }
}

# Re-query only when features were actually enabled; otherwise reuse the before-state.
if ($featuresToEnable.Count -gt 0) {
    $featureStates = @{}
    foreach ($feature in $targetFeatures) {
        $featureStates[$feature] = (Get-WindowsOptionalFeature -Online -FeatureName $feature).State
    }
} else {
    $featureStates = $featureStatesBefore
}

Write-Host "Current target feature states:" -ForegroundColor Cyan
$targetFeatures |
    ForEach-Object {
        [PSCustomObject]@{
            FeatureName = $_
            State       = $featureStates[$_]
        }
    } |
    Format-Table -AutoSize

if ($featuresToEnable.Count -eq 0) {
    Write-Host "No restart needed." -ForegroundColor Green
} elseif ($NoRestart) {
    Write-Host "Changes applied. Restart required to take effect. Please reboot when convenient." -ForegroundColor Yellow
} else {
    Write-Host "Changes applied. Restarting now..." -ForegroundColor Cyan
    shutdown /r /t 0
}
