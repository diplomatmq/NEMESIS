# NEMESIS - Database Restoration Script
# This script helps restore the database if it was lost

Write-Host "🗄️ NEMESIS Database Restoration" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "1. Checking Docker..." -ForegroundColor Yellow
$dockerRunning = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker is not running!" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Docker is running" -ForegroundColor Green
Write-Host ""

# Stop containers
Write-Host "2. Stopping containers..." -ForegroundColor Yellow
docker compose down
Write-Host "✅ Containers stopped" -ForegroundColor Green
Write-Host ""

# Ask about volume removal
Write-Host "3. Database volume options:" -ForegroundColor Yellow
Write-Host "   Current volumes:" -ForegroundColor White
docker volume ls | Select-String "nemesis"
Write-Host ""
$removeVolume = Read-Host "Do you want to REMOVE the database volume? (yes/no) [WARNING: This deletes all data!]"

if ($removeVolume -eq "yes") {
    Write-Host "⚠️ Removing database volume..." -ForegroundColor Red
    docker volume rm nemesis_postgres_data 2>&1 | Out-Null
    Write-Host "✅ Volume removed" -ForegroundColor Green
} else {
    Write-Host "ℹ️ Keeping existing volume" -ForegroundColor Cyan
}
Write-Host ""

# Start containers
Write-Host "4. Starting containers..." -ForegroundColor Yellow
docker compose up -d
Write-Host "✅ Containers starting..." -ForegroundColor Green
Write-Host ""

# Wait for PostgreSQL
Write-Host "5. Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
do {
    $attempt++
    $pgReady = docker exec nemesis_postgres pg_isready -U postgres 2>&1
    if ($pgReady -match "accepting connections") {
        Write-Host "✅ PostgreSQL is ready!" -ForegroundColor Green
        break
    }
    Write-Host "   Attempt $attempt/$maxAttempts - Waiting..." -ForegroundColor Gray
    Start-Sleep -Seconds 2
} while ($attempt -lt $maxAttempts)

if ($attempt -eq $maxAttempts) {
    Write-Host "❌ PostgreSQL did not start in time" -ForegroundColor Red
    Write-Host "Check logs: docker logs nemesis_postgres" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Check if database exists
Write-Host "6. Checking database..." -ForegroundColor Yellow
$dbCheck = docker exec nemesis_postgres psql -U postgres -lqt 2>&1 | Select-String "nemesis_game"
if ($dbCheck) {
    Write-Host "✅ Database 'nemesis_game' exists" -ForegroundColor Green
} else {
    Write-Host "⚠️ Database 'nemesis_game' not found, it will be created by migrations" -ForegroundColor Yellow
}
Write-Host ""

# Run migrations
Write-Host "7. Running migrations..." -ForegroundColor Yellow
$migrateOutput = docker exec nemesis_bot npm run migrate 2>&1
Write-Host $migrateOutput
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Migrations completed successfully" -ForegroundColor Green
} else {
    Write-Host "⚠️ Migrations encountered issues (check output above)" -ForegroundColor Yellow
}
Write-Host ""

# Verify tables
Write-Host "8. Verifying database tables..." -ForegroundColor Yellow
$tables = docker exec nemesis_postgres psql -U postgres -d nemesis_game -c "\dt" 2>&1
Write-Host $tables
Write-Host ""

# Check bot logs
Write-Host "9. Checking bot status..." -ForegroundColor Yellow
Write-Host "Last 20 lines of bot logs:" -ForegroundColor White
docker logs nemesis_bot --tail 20
Write-Host ""

# Summary
Write-Host "================================" -ForegroundColor Cyan
Write-Host "✅ Restoration process complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  • Check bot logs: docker logs nemesis_bot -f" -ForegroundColor White
Write-Host "  • Verify database: docker exec -it nemesis_postgres psql -U postgres -d nemesis_game" -ForegroundColor White
Write-Host "  • Create backup: docker exec nemesis_postgres pg_dump -U postgres nemesis_game > backups/backup_`$(Get-Date -Format 'yyyy-MM-dd').sql" -ForegroundColor White
Write-Host ""
Write-Host "⚠️ SECURITY: Ports 5432 and 6379 are now CLOSED to external access" -ForegroundColor Yellow
Write-Host ""
