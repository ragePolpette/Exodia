param(
  [string]$Profile = "triage",
  [string]$ConfigPath = ".\\config\\harness.config.example.json",
  [switch]$IgnoreLock,
  [string]$NodeExe = "node"
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot

Push-Location $repoRoot
try {
  $arguments = @(
    "src/cli.js",
    "schedule-run",
    "--config", $ConfigPath,
    "--profile", $Profile
  )

  if ($IgnoreLock) {
    $arguments += "--ignore-lock"
  }

  & $NodeExe @arguments
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
