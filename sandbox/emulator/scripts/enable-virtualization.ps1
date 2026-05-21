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
