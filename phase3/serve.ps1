<#
.SYNOPSIS
  Tiny local web server for the static EduFace pages (nothing to install: uses Windows PowerShell's built-in HttpListener).
.DESCRIPTION
  Browsers allow camera access and IndexedDB only on http://localhost (or https), not on file:// pages, so the app must be served.
  Serves this folder on http://localhost:<Port>/ ONLY on this computer (localhost), so other devices cannot reach it.
  Stop with Ctrl+C. Data is stored in the browser, not in this folder.
#>
param([int]$Port = 8080, [string]$Root = $PSScriptRoot, [switch]$Open)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$mime = @{ ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8"; ".json" = "application/json; charset=utf-8";
  ".svg" = "image/svg+xml"; ".png" = "image/png"; ".ico" = "image/x-icon"; ".webmanifest" = "application/manifest+json"; ".bin" = "application/octet-stream";
  ".wasm" = "application/wasm"; ".txt" = "text/plain; charset=utf-8"; ".md" = "text/plain; charset=utf-8"; ".csv" = "text/csv; charset=utf-8" }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { throw "Could not start on port $Port (is another copy running?). Try:  .\serve.ps1 -Port 8081" }
Write-Host "EduFace is running at http://localhost:$Port/   (Ctrl+C to stop)"
if ($Open) { Start-Process "http://localhost:$Port/" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext(); $req = $ctx.Request; $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq "" -or $rel.EndsWith("/")) { $rel += "index.html" }
      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
      if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { $res.StatusCode = 403 }       # no path traversal
      elseif (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $res.StatusCode = 404 }
      else {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" })
        $res.Headers.Add("X-Content-Type-Options", "nosniff"); $res.Headers.Add("Referrer-Policy", "no-referrer")
        $res.Headers.Add("Permissions-Policy", "camera=(self), microphone=()")
        $res.Headers.Add("Cache-Control", "no-cache")
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch { try { $res.StatusCode = 500 } catch { } }
    finally { try { $res.Close() } catch { } }
  }
} finally { $listener.Stop() }
