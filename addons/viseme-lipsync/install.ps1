$ErrorActionPreference = 'Stop'

function Find-AppRoot {
    $directory = Get-Item -LiteralPath $PSScriptRoot
    for ($i = 0; $i -lt 8 -and $directory; $i++) {
        if (Test-Path -LiteralPath (Join-Path $directory.FullName 'public\plugin-host.js')) {
            return $directory.FullName
        }
        $directory = $directory.Parent
    }
    throw 'Could not find a plugin-capable AS Adventurer installation. Update AS Adventurer and place this add-on inside its folder.'
}

$appRoot = Find-AppRoot
$source = Join-Path $PSScriptRoot 'plugin'
$target = Join-Path $appRoot 'public\plugins\viseme-lipsync'

if (Test-Path -LiteralPath $target) {
    $backupRoot = Join-Path $appRoot 'plugin-backups'
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Move-Item -LiteralPath $target -Destination (Join-Path $backupRoot "viseme-lipsync-$stamp")
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Recurse -Force

Write-Host ''
Write-Host 'Viseme Lip Sync installed successfully.' -ForegroundColor Green
Write-Host "Installed to: $target"
Write-Host 'Restart AS Adventurer to load the plugin.'
