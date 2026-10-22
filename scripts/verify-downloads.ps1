# Verify local prerequisite archives without installing or executing them.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'docs/downloads.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$downloadDirectory = Join-Path $projectRoot $manifest.directory
$failures = @()

foreach ($file in $manifest.files) {
    $path = Join-Path $downloadDirectory $file.name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $failures += "Missing: $($file.name)"
        continue
    }

    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -ne $file.sha256) {
        $failures += "SHA-256 mismatch or incomplete download: $($file.name)"
        continue
    }

    if ($file.integrity) {
        $stream = [System.IO.File]::OpenRead($path)
        $hasher = [System.Security.Cryptography.SHA512]::Create()
        try {
            $integrity = 'sha512-' + [Convert]::ToBase64String($hasher.ComputeHash($stream))
        } finally {
            $hasher.Dispose()
            $stream.Dispose()
        }
        if ($integrity -cne $file.integrity) {
            $failures += "npm integrity mismatch: $($file.name)"
            continue
        }
    }

    Write-Output "Verified: $($file.name)"
}

if ($failures.Count -gt 0) {
    throw ($failures -join [Environment]::NewLine)
}

Write-Output 'All prerequisite downloads passed verification.'
