# Optional: run from the project root to serve the LiveKit SDK locally instead of CDN.
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\cache-livekit-sdk.ps1
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = 'https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.min.js'
$vendor = Join-Path $project 'public\vendor'
New-Item -ItemType Directory -Path $vendor -Force | Out-Null
$destination = Join-Path $vendor 'livekit-client.umd.min.js'
$temp = "$destination.tmp"
Invoke-WebRequest -UseBasicParsing -Uri $source -OutFile $temp
if ((Get-Item $temp).Length -lt 100000) { Remove-Item $temp -Force; throw 'Downloaded SDK is unexpectedly small.' }
Move-Item -LiteralPath $temp -Destination $destination -Force
foreach($filename in @('studio.html','output.html','room.html')) {
    $file = Join-Path $project "public\$filename"
    $html = [IO.File]::ReadAllText($file)
    $html = $html.Replace($source,'/vendor/livekit-client.umd.min.js')
    [IO.File]::WriteAllText($file,$html,[Text.UTF8Encoding]::new($false))
}
Write-Host "LiveKit SDK cached locally: $destination" -ForegroundColor Green
Write-Host 'Restart server / refresh browser and test player room.'
