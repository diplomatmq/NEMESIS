# NEMESIS - Database Backup Script
# Creates a backup of the PostgreSQL database

Write-Host "💾 NEMESIS Database Backup" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
$dockerRunning = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker is not running!" -ForegroundColor Red
    exit 1
}

# Create backups directory if it doesn't exist
if (-not (Test-Path "backups")) {
    Write-Host "Creating backups directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "backups" | Out-Null
}

# Generate filename with timestamp
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$filename = "backups/backup_$timestamp.sql"

# Create backup
Write-Host "Creating backup: $filename" -ForegroundColor Yellow
docker exec nemesis_postgres pg_dump -U postgres nemesis_game > $filename

if ($LASTEXITCODE -eq 0) {
    $fileSize = (Get-Item $filename).Length / 1KB
    Write-Host "✅ Backup created successfully!" -ForegroundColor Green
    Write-Host "   File: $filename" -ForegroundColor White
    Write-Host "   Size: $([math]::Round($fileSize, 2)) KB" -ForegroundColor White
    Write-Host ""
    
    # Show last 5 backups
    Write-Host "Recent backups:" -ForegroundColor Yellow
    Get-ChildItem "backups" -Filter "*.sql" | 
        Sort-Object LastWriteTime -Descending | 
        Select-Object -First 5 | 
        ForEach-Object {
            $size = [math]::Round($_.Length / 1KB, 2)
            Write-Host "  • $($_.Name) - $size KB - $($_.LastWriteTime)" -ForegroundColor White
        }
} else {
    Write-Host "❌ Backup failed!" -ForegroundColor Red
    exit 1
}
