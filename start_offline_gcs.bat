@echo off
setlocal enabledelayedexpansion

title CAN-7USAT Ground Control Station (Field Offline Mode)
echo ==============================================================================
echo   CAN-7USAT Ground Control Station - Autonomous Field Deployment
echo   Team Parikshit (Team 017 ^| 2026-IN-SPACe-CAN-7USAT-017)
echo   MIT Manipal ^| Kushinagar ^| Tamkuhi Raj
echo ==============================================================================
echo.

cd /d "%~dp0"

echo [1/3] Verifying production web assets...
if not exist "dist\index.html" (
    echo [Build] Compiling GCS frontend production bundle with Vite...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Frontend build failed. Check Node.js and dependencies.
        pause
        exit /b 1
    )
) else (
    echo [Build] Production bundle verified in dist\
)

echo.
echo [2/3] Verifying offline geographic MBTiles map packages...
if not exist "map_packs\manipal.mbtiles" (
    echo [Maps] Generating real geographic OpenStreetMap MBTiles packs...
    node scripts\generateRealMapPacks.mjs
    if errorlevel 1 (
        echo [ERROR] Map pack generation failed.
        pause
        exit /b 1
    )
) else (
    echo [Maps] Verified offline packages: manipal.mbtiles, kushinagar.mbtiles, tamkuhi_raj.mbtiles
)

echo.
echo [3/3] Launching Local Offline Map & Dashboard Server (127.0.0.1:8080)...
echo [Browser] Opening http://127.0.0.1:8080 ...
start "" "http://127.0.0.1:8080"

echo.
echo ==============================================================================
echo   GCS is now serving offline on http://127.0.0.1:8080
echo   Press Ctrl+C to shut down the server when recovery is complete.
echo ==============================================================================
node server\offlineServer.mjs 8080

pause
