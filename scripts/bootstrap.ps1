#requires -Version 5.1
<#
  opencode-gui bootstrap / environment gate (M0 ENV-001..ENV-014).
  Usage: powershell -ExecutionPolicy Bypass -File scripts/bootstrap.ps1 [-Workspace <path>]
#>
param([string]$Workspace = "")

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $PSScriptRoot
if (-not $Workspace) { $Workspace = $here }
$fail = 0
$warn = 0

function Choose([bool]$condition, [string]$yes, [string]$no) {
  if ($condition) { return $yes } else { return $no }
}

function Check($id, $name, $ok, $detail) {
  if ($ok) { Write-Host ("[PASS] {0} {1} - {2}" -f $id, $name, $detail) -ForegroundColor Green }
  elseif ($id -eq "ENV-007" -or $id -eq "ENV-008" -or $id -eq "ENV-009" -or $id -eq "ENV-010" -or $id -eq "ENV-011" -or $id -eq "ENV-012") {
    Write-Host ("[WARN] {0} {1} - {2}" -f $id, $name, $detail) -ForegroundColor Yellow
    $script:warn++
  }
  else {
    Write-Host ("[FAIL] {0} {1} - {2}" -f $id, $name, $detail) -ForegroundColor Red
    $script:fail++
  }
}

Write-Host "opencode-gui bootstrap" -ForegroundColor Cyan
Write-Host ("workspace: " + $Workspace)
Write-Host ""

# ENV-001 Node
$node = (Get-Command node -ErrorAction SilentlyContinue)
$nodeVersion = if ($node) { (& node -v) } else { "" }
$nodeMajor = if ($nodeVersion -match 'v(\d+)') { [int]$Matches[1] } else { 0 }
Check "ENV-001" "Node.js" ($nodeMajor -ge 20) ($nodeVersion + " (need >= 20)")

# ENV-002 npm
$npm = Get-Command npm -ErrorAction SilentlyContinue
$npmDetail = if ($npm) { (& npm -v) } else { "npm not found" }
Check "ENV-002" "npm" ($null -ne $npm) $npmDetail

# ENV-003 git
$git = Get-Command git -ErrorAction SilentlyContinue
$gitVersion = if ($git) { & git --version } else { "" }
$gitOk = $gitVersion -match '(\d+)\.(\d+)' -and ([int]$Matches[1] -gt 2 -or ([int]$Matches[1] -eq 2 -and [int]$Matches[2] -ge 40))
Check "ENV-003" "git" $gitOk ($gitVersion + " (need >= 2.40)")

# ENV-004 ripgrep (system or bundled)
$rg = Get-Command rg -ErrorAction SilentlyContinue
if ($rg) { Check "ENV-004" "ripgrep" $true (& rg --version | Select-Object -First 1) }
else {
  $bundled = Join-Path $here "node_modules\@vscode\ripgrep-win32-x64\bin\rg.exe"
  Check "ENV-004" "ripgrep" (Test-Path $bundled) (Choose (Test-Path $bundled) "using bundled rg: $bundled" "rg missing; run npm install (bundled fallback)")
}

# ENV-005 pyright
$pyright = Get-Command pyright -ErrorAction SilentlyContinue
$pyrightDetail = if ($pyright) { (& pyright --version 2>&1 | Select-Object -First 1) } else { "pyright missing (npm i -g pyright)" }
Check "ENV-005" "pyright" ($null -ne $pyright) $pyrightDetail

# ENV-006 opencode 2.x
$opencode = Get-Command opencode -All -ErrorAction SilentlyContinue
$ocVersion = if ($opencode) { (& opencode --version 2>&1 | Select-Object -First 1) -replace '^opencode\s+v?', '' } else { "" }
$ocOk = $ocVersion -match '^2\.'
$ocCount = if ($opencode) { @($opencode).Count } else { 0 }
$ocDetail = if ($opencode) { "v$ocVersion (shim entries: $ocCount, same install)" } else { "opencode 2.x not found (npm i -g @opencode/cli)" }
Check "ENV-006" "opencode 2.x" $ocOk $ocDetail
if ($ocCount -gt 3) { Write-Host "       note: multiple opencode shims detected; remove stale 1.x installs" -ForegroundColor Yellow }

# ENV-007 port
$port = 4310
$inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
Check "ENV-007" "port $port" (-not $inUse) (Choose (-not $inUse) "free" "in use (BFF will auto-fallback)")

# ENV-008 venv
$venv = Join-Path $Workspace ".venv\Scripts\python.exe"
if (Test-Path $venv) { Check "ENV-008" "venv" $true $venv }
else {
  $venv = Join-Path $Workspace "venv\Scripts\python.exe"
  Check "ENV-008" "venv" (Test-Path $venv) (Choose (Test-Path $venv) $venv "no .venv/venv in workspace (terminal starts without venv)")
}

# ENV-009 long paths
try {
  $lp = Get-ItemPropertyValue -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -ErrorAction Stop
  Check "ENV-009" "long paths" ($lp -eq 1) ("LongPathsEnabled=" + $lp)
} catch { Check "ENV-009" "long paths" $false "LongPathsEnabled not readable" }

# ENV-010 ruff
$ruff = Get-Command ruff -ErrorAction SilentlyContinue
$ruffDetail = if ($ruff) { (& ruff --version) } else { "optional: ruff not installed" }
Check "ENV-010" "ruff" ($null -ne $ruff) $ruffDetail

# ENV-011 VS Build Tools (node-pty) - terminal uses upstream PTY, so optional
$cl = Get-Command cl -ErrorAction SilentlyContinue
$clDetail = if ($cl) { $cl.Source } else { "node-pty native build unavailable; upstream PTY bridge will be used" }
Check "ENV-011" "VS Build Tools" ($null -ne $cl) $clDetail

# ENV-012 WebView2
$wv = Get-ChildItem "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients" -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
  Where-Object { $_.name -like "*WebView2*" }
$wvDetail = if ($wv) { "installed (M4 desktop shell)" } else { "not detected (browser mode still works)" }
Check "ENV-012" "WebView2" ($null -ne $wv) $wvDetail

# ENV-013 backups
$config = Join-Path $env:USERPROFILE ".config\opencode"
$share = Join-Path $env:USERPROFILE ".local\share\opencode"
$backupOk = (Test-Path $config) -and (Test-Path $share)
Check "ENV-013" "opencode data dirs" $backupOk ("config=" + (Test-Path $config) + " share=" + (Test-Path $share) + " (confirm your own backup before removing 1.x)")

# ENV-014 desktop regression is manual
Write-Host "[MANUAL] ENV-014 desktop app: launch it and open a historical session after any upgrade." -ForegroundColor Yellow

if (-not (Test-Path (Join-Path $here "node_modules"))) {
  Write-Host ""
  Write-Host "Dependencies are not installed. Run: npm install" -ForegroundColor Yellow
}

Write-Host ""
if ($fail -gt 0) {
  Write-Host ("GATE FAIL: {0} required check(s) failed, {1} warning(s)." -f $fail, $warn) -ForegroundColor Red
  exit 1
}
Write-Host ("GATE PASS with {0} warning(s)." -f $warn) -ForegroundColor Green

