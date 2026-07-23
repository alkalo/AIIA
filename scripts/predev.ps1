# Prepara y arranca tauri dev en Windows (carga desde dist/, sin servidor HTTP).
$ErrorActionPreference = "SilentlyContinue"

function Stop-AiiaDesktop {
    for ($i = 0; $i -lt 8; $i++) {
        $procs = Get-Process -Name "aiia-desktop" -ErrorAction SilentlyContinue
        if (-not $procs) { return }
        $procs | Stop-Process -Force
        Start-Sleep -Milliseconds 400
    }
}

Stop-AiiaDesktop
Start-Sleep -Milliseconds 600

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--disable-gpu --disable-features=RendererCodeIntegrity"

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "Compilando packages (scraper, agent-engine, runners)..."
npm run build:packages
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Compilando frontend..."
npm run build -w @aiia/desktop
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$UpdateHelper = Join-Path $Root "apps/desktop/src-tauri/update-helper/aiia-update-helper.exe"
if (-not (Test-Path $UpdateHelper)) {
    Write-Host "Empaquetando update-helper..."
    node scripts/bundle-update-helper.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Iniciando watch del frontend en segundo plano..."
Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev:watch","-w","@aiia/desktop" -WorkingDirectory $Root -WindowStyle Hidden

npm run tauri dev -w @aiia/desktop
exit $LASTEXITCODE
