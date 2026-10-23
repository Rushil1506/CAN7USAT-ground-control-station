# CAN-7USAT Ground Control Station - Autonomous Field Deployment
# Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)
# MIT Manipal | Kushinagar | Tamkuhi Raj

$ErrorActionPreference = "Stop"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host "  CAN-7USAT Ground Control Station - Autonomous Field Deployment" -ForegroundColor Cyan
Write-Host "  Team Parikshit (Team 017 | 2026-IN-SPACe-CAN-7USAT-017)" -ForegroundColor Cyan
Write-Host "  MIT Manipal | Kushinagar | Tamkuhi Raj" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location -Path $PSScriptRoot

Write-Host "[1/3] Verifying production web assets..." -ForegroundColor Yellow
if (-not (Test-Path "dist\index.html")) {
    Write-Host "[Build] Compiling GCS frontend production bundle with Vite..." -ForegroundColor Yellow
    & npm run build
} else {
    Write-Host "[Build] Production bundle verified in dist\" -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/3] Verifying offline geographic MBTiles map packages..." -ForegroundColor Yellow
if (-not (Test-Path "map_packs\manipal.mbtiles")) {
    Write-Host "[Maps] Generating real geographic OpenStreetMap MBTiles packs..." -ForegroundColor Yellow
    & node scripts\generateRealMapPacks.mjs
} else {
    Write-Host "[Maps] Verified offline packages: manipal.mbtiles, kushinagar.mbtiles, tamkuhi_raj.mbtiles" -ForegroundColor Green
}

Write-Host ""
Write-Host "[3/3] Launching Local Offline Map & Dashboard Server (127.0.0.1:8080)..." -ForegroundColor Yellow
Start-Process "http://127.0.0.1:8080"

Write-Host ""
Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "  GCS is now serving offline on http://127.0.0.1:8080" -ForegroundColor Green
Write-Host "  Press Ctrl+C to shut down the server when recovery is complete." -ForegroundColor Green
Write-Host "==============================================================================" -ForegroundColor Green

& node server\offlineServer.mjs 8080
