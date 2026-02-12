param(
  [int]$Rounds = 1,
  [int]$ListenerWarmupSec = 20,
  [int]$ContractTimeoutSec = 1800,
  [switch]$SkipWipe
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$logsRoot = Join-Path $repo "logs"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $logsRoot "overnight-core-audit-$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$summary = [ordered]@{
  started_at = (Get-Date).ToString("o")
  rounds = @()
}

function Run-Step {
  param(
    [string]$Name,
    [string]$Command,
    [int]$TimeoutSec = 0
  )

  $safeName = ($Name -replace "[^a-zA-Z0-9\-_]", "_")
  $outFile = Join-Path $runDir "$safeName.out.log"
  $errFile = Join-Path $runDir "$safeName.err.log"
  $start = Get-Date

  $proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c $Command" `
    -WorkingDirectory $repo `
    -RedirectStandardOutput $outFile `
    -RedirectStandardError $errFile `
    -PassThru

  $timedOut = $false
  if ($TimeoutSec -gt 0) {
    if (-not (Wait-Process -Id $proc.Id -Timeout $TimeoutSec -ErrorAction SilentlyContinue)) {
      $timedOut = $true
      try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
  } else {
    Wait-Process -Id $proc.Id
  }

  $end = Get-Date
  $exitCode = if ($timedOut) { 124 } else { $proc.ExitCode }

  return [ordered]@{
    name = $Name
    command = $Command
    started_at = $start.ToString("o")
    ended_at = $end.ToString("o")
    duration_sec = [int]($end - $start).TotalSeconds
    exit_code = $exitCode
    timed_out = $timedOut
    out_log = $outFile
    err_log = $errFile
  }
}

for ($r = 1; $r -le $Rounds; $r++) {
  $round = [ordered]@{
    round = $r
    steps = @()
  }

  if (-not $SkipWipe) {
    $round.steps += Run-Step -Name "round${r}_wipe_db_not_tx" -Command "node utils/wipeDBNotTx.js" -TimeoutSec 120
  }

  $listenerOut = Join-Path $runDir "round${r}_walletListener.out.log"
  $listenerErr = Join-Path $runDir "round${r}_walletListener.err.log"
  $listener = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node src/walletListener.js" `
    -WorkingDirectory $repo `
    -RedirectStandardOutput $listenerOut `
    -RedirectStandardError $listenerErr `
    -PassThru

  Start-Sleep -Seconds $ListenerWarmupSec

  $round.steps += [ordered]@{
    name = "round${r}_walletListener_boot"
    command = "node src/walletListener.js"
    started_at = (Get-Date).AddSeconds(-$ListenerWarmupSec).ToString("o")
    ended_at = (Get-Date).ToString("o")
    duration_sec = $ListenerWarmupSec
    exit_code = $null
    timed_out = $false
    out_log = $listenerOut
    err_log = $listenerErr
    listener_pid = $listener.Id
  }

  $round.steps += Run-Step -Name "round${r}_contract_interface_test" -Command "node tests/contractInterfaceTest.js" -TimeoutSec $ContractTimeoutSec
  $round.steps += Run-Step -Name "round${r}_consensus_hash_test" -Command "node tests/testConsensusHash.js" -TimeoutSec 600
  $round.steps += Run-Step -Name "round${r}_vesting_test" -Command "node tests/vestingTest.js" -TimeoutSec 600

  try { Stop-Process -Id $listener.Id -Force -ErrorAction SilentlyContinue } catch {}
  $round.steps += [ordered]@{
    name = "round${r}_walletListener_stop"
    command = "Stop-Process $($listener.Id)"
    started_at = (Get-Date).ToString("o")
    ended_at = (Get-Date).ToString("o")
    duration_sec = 0
    exit_code = 0
    timed_out = $false
    out_log = $listenerOut
    err_log = $listenerErr
    listener_pid = $listener.Id
  }

  $summary.rounds += $round
}

$summary.ended_at = (Get-Date).ToString("o")
$summaryFile = Join-Path $runDir "summary.json"
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $summaryFile

Write-Output "Overnight core audit complete."
Write-Output "Run directory: $runDir"
Write-Output "Summary file: $summaryFile"
