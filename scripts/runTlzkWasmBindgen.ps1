param(
  [ValidateSet('nodejs', 'web')]
  [string]$Target = 'nodejs',
  [string]$OutDir,
  [switch]$Embedded
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $OutDir) {
  throw 'OutDir is required'
}

$TargetDir = Join-Path $RepoRoot 'wasm\tlzk_verifier\target'
if ($Embedded) {
  $TargetDir = $env:TL_ZK_EMBEDDED_CARGO_TARGET_DIR
  if (-not $TargetDir) {
    $TargetDir = 'D:\cargo-target\tlzk-verifier-embedded'
  }
}

$WasmPath = Join-Path $TargetDir 'wasm32-unknown-unknown\release\tlzk_verifier.wasm'
if (-not (Test-Path $WasmPath)) {
  throw "tlzk_verifier.wasm not found at $WasmPath"
}

$Bindgen = Get-Command wasm-bindgen -ErrorAction SilentlyContinue
if (-not $Bindgen) {
  $Fallback = 'D:\cargo-tools\bin\wasm-bindgen.exe'
  if (Test-Path $Fallback) {
    $Bindgen = Get-Item $Fallback
  }
}
if (-not $Bindgen) {
  throw 'wasm-bindgen not found on PATH or at D:\cargo-tools\bin\wasm-bindgen.exe'
}

$ResolvedOutDir = if ([System.IO.Path]::IsPathRooted($OutDir)) {
  $OutDir
} else {
  Join-Path $RepoRoot $OutDir
}

New-Item -ItemType Directory -Force $ResolvedOutDir | Out-Null
& $Bindgen.Source --target $Target --out-dir $ResolvedOutDir $WasmPath
exit $LASTEXITCODE
