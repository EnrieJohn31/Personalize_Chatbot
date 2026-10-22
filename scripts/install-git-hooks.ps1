# Configure this checkout only; never replace a different hook configuration silently.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
    $existing = & git config --get core.hooksPath
    if ($LASTEXITCODE -gt 1) { throw 'Could not read the repository hook configuration.' }
    if ($existing -and $existing -ne '.githooks') {
        throw "Existing hooksPath '$existing' needs to be integrated before enabling .githooks."
    }
    if (-not $existing) {
        $defaultHooks = & git rev-parse --git-path hooks
        if ($LASTEXITCODE -ne 0) { throw 'Could not locate existing Git hooks.' }
        $activeHooks = @(Get-ChildItem -LiteralPath $defaultHooks -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notlike '*.sample' })
        if ($activeHooks.Count) {
            throw 'Existing Git hooks need to be integrated before enabling .githooks.'
        }
    }
    if (-not (Test-Path -LiteralPath '.githooks/commit-msg')) {
        throw 'The tracked commit-msg hook is missing.'
    }
    & git config --local core.hooksPath .githooks
    if ($LASTEXITCODE -ne 0) { throw 'Could not enable the repository Git hook.' }
    Write-Output 'Repository contributor policy enabled: core.hooksPath=.githooks'
} finally {
    Pop-Location
}
