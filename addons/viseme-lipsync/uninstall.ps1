$ErrorActionPreference = 'Stop'

function Find-AppRoot {
    $directory = Get-Item -LiteralPath $PSScriptRoot
    for ($i = 0; $i -lt 8 -and $directory; $i++) {
        if (Test-Path -LiteralPath (Join-Path $directory.FullName 'public\plugin-host.js')) {
            return $directory.FullName
        }
        $directory = $directory.Parent
    }
    throw 'Could not find a plugin-capable AS Adventurer installation.'
}

$appRoot = Find-AppRoot
$target = Join-Path $appRoot 'public\plugins\viseme-lipsync'

if (-not (Test-Path -LiteralPath $target)) {
    Write-Host 'Viseme Lip Sync is not installed.' -ForegroundColor Yellow
    exit 0
}

$backupRoot = Join-Path $appRoot 'plugin-backups'
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $backupRoot "viseme-lipsync-uninstalled-$stamp"
Move-Item -LiteralPath $target -Destination $backup

Write-Host ''
Write-Host 'Viseme Lip Sync uninstalled successfully.' -ForegroundColor Green
Write-Host "Backup saved to: $backup"
Write-Host 'Restart AS Adventurer to finish unloading the plugin.'
