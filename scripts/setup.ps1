# Run from PowerShell with Docker Desktop's Linux engine available.
# Re-running preserves the application key, configured passwords and database volume.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed (exit $LASTEXITCODE). Fix the error above and re-run setup."
    }
}

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($bytes)
        return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $random.Dispose()
    }
}

Push-Location $projectRoot
try {
    & (Join-Path $PSScriptRoot 'install-git-hooks.ps1')
    Invoke-Docker info --format '{{.ServerVersion}}'
    if (-not (Test-Path -LiteralPath '.env')) {
        Copy-Item -LiteralPath '.env.example' -Destination '.env'
    }

    $environmentPath = Join-Path $projectRoot '.env'
    $environment = [System.IO.File]::ReadAllText($environmentPath)
    foreach ($key in 'DB_PASSWORD', 'DB_ROOT_PASSWORD') {
        $pattern = '(?m)^' + $key + '=([^\r\n]*)'
        $match = [regex]::Match($environment, $pattern)
        if (-not $match.Success) {
            $environment += "`n$key=$(New-LocalSecret)`n"
        } elseif ($match.Groups[1].Value -match '^(|change-me.*)$') {
            $environment = [regex]::Replace($environment, $pattern, "$key=$(New-LocalSecret)")
        }
    }
    [System.IO.File]::WriteAllText($environmentPath, $environment, [System.Text.UTF8Encoding]::new($false))

    Invoke-Docker compose build
    Invoke-Docker compose run --rm --no-deps laravel.test composer install --no-interaction --prefer-dist
    if ($environment -match '(?m)^APP_KEY=\s*$') {
        Invoke-Docker compose run --rm --no-deps laravel.test php artisan key:generate --no-interaction
    }
    Invoke-Docker compose run --rm --no-deps laravel.test npm ci --no-fund
    Invoke-Docker compose run --rm --no-deps laravel.test npm run build
    Invoke-Docker compose up -d --wait --wait-timeout 120 mysql agent
    Invoke-Docker compose run --rm --no-deps laravel.test php artisan migrate --no-interaction
    Invoke-Docker compose up -d --wait --wait-timeout 120
    Write-Output 'Setup complete. Open the APP_URL configured in .env (default http://localhost:8080).'
} finally {
    Pop-Location
}
