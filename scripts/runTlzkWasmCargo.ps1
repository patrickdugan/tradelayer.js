param(
  [ValidateSet('check', 'build')]
  [string]$Command = 'check',
  [switch]$Embedded,
  [switch]$WasmTarget
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Manifest = Join-Path $RepoRoot 'wasm\tlzk_verifier\Cargo.toml'

if ($Embedded) {
  $TargetDir = $env:TL_ZK_EMBEDDED_CARGO_TARGET_DIR
  if (-not $TargetDir) {
    $TargetDir = 'D:\cargo-target\tlzk-verifier-embedded'
  }
  New-Item -ItemType Directory -Force $TargetDir | Out-Null
  $env:CARGO_TARGET_DIR = $TargetDir
}

$CargoArgs = @($Command, '--manifest-path', $Manifest)
if ($Command -eq 'build') {
  $CargoArgs += '--release'
}
if ($WasmTarget) {
  $CargoArgs += @('--target', 'wasm32-unknown-unknown')
}
if ($Embedded) {
  $CargoArgs += @('--features', 'embedded-stwo')
}

& cargo @CargoArgs
exit $LASTEXITCODE
