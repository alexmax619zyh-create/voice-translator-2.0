# Download OPUS-MT ONNX model files for offline translation
# Run this script with a VPN/proxy enabled if huggingface.co is blocked in your region.
#
# Usage: powershell -File download-models.ps1

param(
  [string]$Proxy = "",  # e.g. "http://127.0.0.1:7890"
  [string[]]$Pairs = @("zh-en", "en-zh", "en-ja")
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Set proxy if provided
if ($Proxy) {
  $env:HTTP_PROXY = $Proxy
  $env:HTTPS_PROXY = $Proxy
  Write-Host "Using proxy: $Proxy" -ForegroundColor Yellow
}

# Model files needed for each language pair
$files = @(
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "source.spm",
  "target.spm",
  "vocab.json",
  "special_tokens_map.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx"
)

# Map pair key to HuggingFace model ID
$modelMap = @{
  "zh-en" = "Xenova/opus-mt-zh-en"
  "en-zh" = "Xenova/opus-mt-en-zh"
  "en-ja" = "Xenova/opus-mt-en-jap"
  "en-ko" = "Xenova/opus-mt-en-ko"
  "en-fr" = "Xenova/opus-mt-en-fr"
  "en-es" = "Xenova/opus-mt-en-es"
  "en-de" = "Xenova/opus-mt-en-de"
  "en-ru" = "Xenova/opus-mt-en-ru"
}

# Try multiple base URLs
$baseUrls = @(
  "https://huggingface.co",
  "https://hf-mirror.com"
)

foreach ($pair in $Pairs) {
  $modelId = $modelMap[$pair]
  if (-not $modelId) {
    Write-Host "Unknown pair: $pair, skipping" -ForegroundColor Red
    continue
  }

  $targetDir = Join-Path $scriptDir "models\$pair"
  New-Item -ItemType Directory -Force -Path (Join-Path $targetDir "onnx") | Out-Null

  Write-Host "`nDownloading: $pair ($modelId)" -ForegroundColor Cyan

  foreach ($file in $files) {
    $outPath = Join-Path $targetDir $file
    $outDir = Split-Path -Parent $outPath
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    if (Test-Path $outPath) {
      Write-Host "  SKIP: $file (already exists)" -ForegroundColor Gray
      continue
    }

    $downloaded = $false
    foreach ($base in $baseUrls) {
      $url = "$base/$modelId/resolve/main/$file"
      Write-Host "  Trying: $url" -ForegroundColor Gray
      try {
        Invoke-WebRequest -Uri $url -OutFile $outPath -TimeoutSec 120 -ErrorAction Stop
        $size = (Get-Item $outPath).Length
        Write-Host "  OK: $file ($([math]::Round($size/1MB, 1)) MB)" -ForegroundColor Green
        $downloaded = $true
        break
      } catch {
        Write-Host "  FAIL: $_" -ForegroundColor DarkGray
      }
    }

    if (-not $downloaded) {
      Write-Host "  ERROR: Could not download $file from any source" -ForegroundColor Red
    }
  }
}

Write-Host "`nDone! Model files are in: $scriptDir\models\" -ForegroundColor Green
Write-Host "Upload the entire 'models' folder to your GitHub Pages repo." -ForegroundColor Yellow
