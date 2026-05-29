# Capitals Browser - tiny dependency-free static server (no admin required).
# Serves this folder over http://localhost:<port> so the PWA can be installed,
# and exposes /api/music which lists audio files in the .\music folder.

param(
  [int]$Port = 8080,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$rootFull = [System.IO.Path]::GetFullPath($root)
if ($rootFull[-1] -ne '\') { $rootFull += '\' }

$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'
  '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.webmanifest'='application/manifest+json; charset=utf-8'
  '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'
  '.ico'='image/x-icon'; '.webp'='image/webp'
  '.mp3'='audio/mpeg'; '.m4a'='audio/mp4'; '.aac'='audio/aac'; '.ogg'='audio/ogg'; '.opus'='audio/ogg'
  '.wav'='audio/wav'; '.flac'='audio/flac'; '.webm'='audio/webm'
  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf'; '.txt'='text/plain; charset=utf-8'
}

function Get-Mime([string]$p) {
  $ext = [System.IO.Path]::GetExtension($p).ToLowerInvariant()
  if ($mime.ContainsKey($ext)) { return $mime[$ext] }
  return 'application/octet-stream'
}

function Send-Response($stream, [int]$status, [string]$statusText, [string]$contentType, [byte[]]$body) {
  $h  = "HTTP/1.1 $status $statusText`r`n"
  $h += "Content-Type: $contentType`r`n"
  $h += "Content-Length: $($body.Length)`r`n"
  $h += "Accept-Ranges: bytes`r`n"
  $h += "Cache-Control: no-cache`r`n"
  $h += "Access-Control-Allow-Origin: *`r`n"
  $h += "Connection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Get-MusicJson($root) {
  $dir = Join-Path $root 'music'
  $parts = @()
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -File |
      Where-Object { $_.Extension -match '^\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$' } |
      Sort-Object Name | ForEach-Object {
        $title = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        $t = ($title -replace '\\','\\\\') -replace '"','\"'
        $s = (("music/" + $_.Name) -replace '\\','\\\\') -replace '"','\"'
        $parts += ('{"title":"' + $t + '","src":"' + $s + '"}')
      }
  }
  return '[' + ($parts -join ',') + ']'
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() }
catch {
  Write-Host "Could not start on port $Port (it may already be in use)." -ForegroundColor Red
  Write-Host "Try a different port:  powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8090" -ForegroundColor Yellow
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  CAPITALS BROWSER is running" -ForegroundColor Cyan
Write-Host "  ->  $url" -ForegroundColor White
Write-Host "  Keep this window open. Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""
if (-not $NoOpen) { try { Start-Process $url } catch {} }

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 4000
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { $client.Close(); continue }

      $tokens  = $requestLine.Split(' ')
      $rawPath = if ($tokens.Length -ge 2) { $tokens[1] } else { '/' }
      $path = ($rawPath -split '\?')[0]
      $path = [System.Uri]::UnescapeDataString($path)
      if ($path -eq '/') { $path = '/index.html' }

      if ($path -like '/api/music*') {
        $json = Get-MusicJson $root
        Send-Response $stream 200 'OK' 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($json))
        $client.Close(); continue
      }

      $rel  = $path.TrimStart('/')
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('403 Forbidden'))
        $client.Close(); continue
      }

      if (Test-Path -LiteralPath $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        Send-Response $stream 200 'OK' (Get-Mime $full) $bytes
      } else {
        Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('404 Not Found'))
      }
      $client.Close()
    } catch {
      try { $client.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
