# Build Velocity for Windows
# Usage: ./scripts/build.ps1

Write-Host "Building Velocity..." -ForegroundColor Cyan

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..."
    npm install
}

# Build the Tauri app
Write-Host "Building Tauri application..."
npm run tauri build

# Show output location
$bundleDir = "src-tauri/target/release/bundle"
if (Test-Path $bundleDir) {
    Write-Host "`nBuild complete! Output:" -ForegroundColor Green
    Get-ChildItem $bundleDir -Recurse -File | ForEach-Object {
        Write-Host "  $($_.FullName)" -ForegroundColor Yellow
    }
} else {
    Write-Host "Build may have failed. Check output above." -ForegroundColor Red
}
