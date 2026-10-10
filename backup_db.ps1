# Скрипт для создания резервной копии базы данных
# Использование: .\backup_db.ps1

$ErrorActionPreference = "Stop"

# Загружаем переменные из .env
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

$DB_NAME = $env:DB_NAME
if (-not $DB_NAME) { $DB_NAME = "nemesis_game" }

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "backup_${DB_NAME}_${timestamp}.sql"

Write-Host "🔄 Создание резервной копии базы данных..." -ForegroundColor Cyan
Write-Host "   База данных: $DB_NAME"
Write-Host "   Файл: $backupFile"

try {
    # Выполняем pg_dump через Docker
    docker exec nemesis_postgres pg_dump -U postgres -d $DB_NAME -F p -f "/tmp/$backupFile"
    
    # Копируем файл из контейнера
    docker cp "nemesis_postgres:/tmp/$backupFile" "./$backupFile"
    
    # Удаляем временный файл из контейнера
    docker exec nemesis_postgres rm "/tmp/$backupFile"
    
    $fileSize = (Get-Item $backupFile).Length / 1KB
    Write-Host "✅ Резервная копия создана успешно!" -ForegroundColor Green
    Write-Host "   Размер: $([math]::Round($fileSize, 2)) KB"
    Write-Host "   Путь: $(Get-Location)\$backupFile"
}
catch {
    Write-Host "❌ Ошибка при создании резервной копии:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}
