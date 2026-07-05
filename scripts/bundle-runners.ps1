# Empaqueta agent-runner, credential-runner y dependencias para el MSI de Tauri.
$ErrorActionPreference = "Stop"

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "Compilando paquetes npm..."
npm run build:packages
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$BundleDir = Join-Path $Root "apps/desktop/src-tauri/runner-bundle"
if (Test-Path $BundleDir) {
    Remove-Item $BundleDir -Recurse -Force
}
New-Item -ItemType Directory -Path $BundleDir | Out-Null

$packageJson = @"
{
  "name": "aiia-runner-bundle",
  "private": true,
  "type": "module",
  "dependencies": {
    "@aiia/agent-runner": "file:../../../../packages/agent-runner",
    "@aiia/credential-runner": "file:../../../../packages/credential-runner",
    "@aiia/agent-engine": "file:../../../../packages/agent-engine",
    "@aiia/ollama-client": "file:../../../../packages/ollama-client",
    "@aiia/scraper": "file:../../../../packages/scraper",
    "exceljs": "^4.4.0",
    "playwright": "^1.49.0",
    "uuid": "^11.0.0"
  }
}
"@
Set-Content -Path (Join-Path $BundleDir "package.json") -Value $packageJson -Encoding UTF8

Write-Host "Instalando dependencias de producción en runner-bundle..."
npm install --omit=dev --install-links --prefix $BundleDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$PwDest = Join-Path $BundleDir "ms-playwright"
$env:PLAYWRIGHT_BROWSERS_PATH = $PwDest
$ScraperDir = Join-Path $BundleDir "node_modules/@aiia/scraper"

Write-Host "Instalando Chromium de Playwright en el bundle..."
npm exec playwright install chromium --prefix $ScraperDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Remove-Item (Join-Path $BundleDir "package.json") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $BundleDir "package-lock.json") -Force -ErrorAction SilentlyContinue

$runnerJs = Join-Path $BundleDir "node_modules/@aiia/agent-runner/dist/index.js"
if (-not (Test-Path $runnerJs)) {
    Write-Error "Bundle incompleto: no se encontró $runnerJs"
    exit 1
}

$engineJs = Join-Path $BundleDir "node_modules/@aiia/agent-engine/dist/index.js"
if (-not (Test-Path $engineJs)) {
    Write-Error "Bundle incompleto: no se encontró $engineJs"
    exit 1
}

$moduleCount = (Get-ChildItem (Join-Path $BundleDir "node_modules") -Recurse -File).Count
Write-Host "Runner bundle listo en $BundleDir ($moduleCount archivos)"
