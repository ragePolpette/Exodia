param(
  [string]$RepoPath = (Resolve-Path ".").Path,
  [switch]$InstallGlobalTemplate
)

$ErrorActionPreference = "Stop"

$repo = Resolve-Path -LiteralPath $RepoPath
$hookSource = Join-Path $repo ".githooks"
$policySource = Join-Path $repo "policy\COMMIT_AND_SECRET_POLICY.example.md"

if (!(Test-Path -LiteralPath $hookSource)) {
  throw "Missing hook source directory: $hookSource"
}

git -C $repo config core.hooksPath .githooks
Write-Host "Configured repo hooks: $repo -> .githooks"

if ($InstallGlobalTemplate) {
  $templateRoot = Join-Path $HOME ".git-template"
  $templateHooks = Join-Path $templateRoot "hooks"
  New-Item -ItemType Directory -Force -Path $templateHooks | Out-Null

  Copy-Item -LiteralPath (Join-Path $hookSource "commit-msg") -Destination (Join-Path $templateHooks "commit-msg") -Force
  Copy-Item -LiteralPath (Join-Path $hookSource "pre-commit") -Destination (Join-Path $templateHooks "pre-commit") -Force

  if (Test-Path -LiteralPath $policySource) {
    Copy-Item -LiteralPath $policySource -Destination (Join-Path $templateRoot "COMMIT_AND_SECRET_POLICY.md") -Force
  }

  git config --global init.templateDir $templateRoot
  Write-Host "Configured global Git template: $templateRoot"
  Write-Host "New repositories created with git init will receive the policy file and hooks."
}
