$ErrorActionPreference = 'Stop'

$Host.UI.RawUI.WindowTitle = 'Research Dictionary - Publish Firestore Rules'

Write-Host '============================================================'
Write-Host '  Research Dictionary - Publish Firestore Security Rules'
Write-Host '============================================================'
Write-Host ''

try {
    Set-Location -LiteralPath $PSScriptRoot

    Write-Host '[1/4] Checking Node.js / npm / npx...'
    foreach ($cmd in @('node','npm','npx')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            throw "$cmd was not found in PATH. Please install/reopen Node.js terminal first."
        }
    }

    Write-Host ('  Node.js: ' + (& node -v))
    Write-Host ('  npm:     ' + (& npm -v))
    Write-Host ''

    Write-Host '[2/4] Checking Firebase CLI login...'
    & npx --yes firebase-tools@latest projects:list
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host 'Firebase login is required. Opening login flow...'
        & npx --yes firebase-tools@latest login
        if ($LASTEXITCODE -ne 0) {
            throw 'Firebase login failed.'
        }
    }

    Write-Host ''
    Write-Host '[3/4] Selecting Firebase project deer-7327a...'
    & npx --yes firebase-tools@latest use deer-7327a
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to select Firebase project deer-7327a.'
    }

    Write-Host ''
    Write-Host '[4/4] Publishing Firestore Security Rules...'
    & npx --yes firebase-tools@latest deploy --only firestore:rules
    if ($LASTEXITCODE -ne 0) {
        throw 'Firestore Security Rules deployment failed.'
    }

    Write-Host ''
    Write-Host '============================================================'
    Write-Host '[OK] Firestore Security Rules published successfully.'
    Write-Host 'Desktop login, private terms, and sharing are now enabled.'
    Write-Host '============================================================'
}
catch {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host '[ERROR]' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host 'Please copy or screenshot the error above and send it to ChatGPT.'
    Write-Host '============================================================'
}

Write-Host ''
Read-Host 'Press Enter to close this window'
