<#
  sync-music.ps1 — uploads audio from the local .\music folder to your
  Supabase "caps-music" bucket, so the songs show up in Capitals Browser
  on every device (and survive even when no local server is running).

  ONE-TIME SETUP:
    1. Supabase dashboard -> your project -> Project Settings -> API.
    2. Copy the "service_role" secret key (NOT the anon key).
    3. Save it in a file next to this script named:  supabase-key.txt
       (it is gitignored and never leaves your machine).

  THEN, any time you want to add music:
    - Drop .mp3 / .m4a / .wav / etc. into the .\music folder.
    - Run:  powershell -ExecutionPolicy Bypass -File sync-music.ps1
    - Open Capitals Browser and click the reload arrow on the Music card.

  Tip: you can also just drag files straight into the bucket from the
  Supabase dashboard (Storage -> caps-music) — no key needed for that.
#>
[CmdletBinding()]
param(
  [string]$MusicDir = (Join-Path $PSScriptRoot "music")
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SupabaseUrl = "https://gcqmynjgmbufchapgcbd.supabase.co"
$Bucket      = "caps-music"

# --- service-role key (grants write access). Never commit this. ---
$key = $env:SUPABASE_SERVICE_KEY
$keyFile = Join-Path $PSScriptRoot "supabase-key.txt"
if (-not $key -and (Test-Path $keyFile)) { $key = (Get-Content $keyFile -Raw).Trim() }
if (-not $key) {
  Write-Host "No Supabase service key found." -ForegroundColor Yellow
  Write-Host "Get it from: Supabase dashboard -> Project Settings -> API -> 'service_role' key"
  Write-Host "Then save it in this file: $keyFile"
  exit 1
}

$ctype = @{
  ".mp3"="audio/mpeg"; ".m4a"="audio/mp4"; ".aac"="audio/aac"; ".ogg"="audio/ogg";
  ".oga"="audio/ogg"; ".opus"="audio/opus"; ".wav"="audio/wav"; ".flac"="audio/flac"; ".webm"="audio/webm"
}

if (-not (Test-Path $MusicDir)) { Write-Host "No music folder at $MusicDir"; exit 1 }
$files = Get-ChildItem -Path $MusicDir -File | Where-Object { $ctype.ContainsKey($_.Extension.ToLower()) }
if (-not $files) { Write-Host "No audio files in $MusicDir. Drop some songs there first."; exit 0 }

Write-Host "Uploading $($files.Count) file(s) to '$Bucket' ..." -ForegroundColor Cyan
$ok = 0
foreach ($f in $files) {
  $name = [uri]::EscapeDataString($f.Name)
  $uri  = "$SupabaseUrl/storage/v1/object/$Bucket/$name"
  $headers = @{ apikey = $key; Authorization = "Bearer $key"; "x-upsert" = "true" }
  try {
    Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -InFile $f.FullName -ContentType $ctype[$f.Extension.ToLower()] | Out-Null
    Write-Host ("  + " + $f.Name) -ForegroundColor Green
    $ok++
  } catch {
    Write-Host ("  ! " + $f.Name + "  ->  " + $_.Exception.Message) -ForegroundColor Red
  }
}
Write-Host "Done. $ok of $($files.Count) uploaded. Hit the reload arrow on the Music card to see them." -ForegroundColor Cyan
