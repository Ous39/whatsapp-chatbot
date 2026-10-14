$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!(Test-Path .env)) { Copy-Item .env.example .env }
$config = [System.IO.File]::ReadAllText((Join-Path (Get-Location).Path '.env'))
$match = [regex]::Match($config, '(?m)^LOCAL_VOICE_TOKEN=([^\r\n]*)')
$token = $match.Groups[1].Value.Trim()
if (!$token) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$settings = [ordered]@{
    LOCAL_VOICE_TOKEN = $token
    VOICE_ENABLED = 'true'
    STT_PROVIDER = 'http'
    STT_HTTP_URL = 'http://localhost:8001/transcribe'
    STT_HTTP_TOKEN = $token
    TTS_EN = 'http'
    TTS_EN_URL = 'http://localhost:8001/synthesize'
    TTS_EN_TOKEN = $token
    TTS_FR = 'http'
    TTS_FR_URL = 'http://localhost:8001/synthesize'
    TTS_FR_TOKEN = $token
}
foreach ($name in $settings.Keys) {
    $line = "${name}=$($settings[$name])"
    $pattern = "(?m)^${name}=[^\r\n]*"
    if ([regex]::IsMatch($config, $pattern)) {
        $config = [regex]::Replace($config, $pattern, $line)
    } else { $config = $config.TrimEnd() + "`n$line`n" }
}
[System.IO.File]::WriteAllText((Join-Path (Get-Location).Path '.env'), $config,
    (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Local speech configured. Existing AI and WhatsApp delivery switches were preserved.'
docker compose --profile voice-local up -d --build voice-local
if ($LASTEXITCODE -ne 0) { throw 'Voice service failed to start. Check Docker output above.' }
Write-Host 'Models download on first startup. Check: docker compose logs -f voice-local'
Write-Host 'When http://localhost:8001/health reports ready=true, restart pnpm dev.'
