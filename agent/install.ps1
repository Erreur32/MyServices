# MyServices agent installer for Windows (run in an elevated PowerShell).
#
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   $env:MSV_URL   = 'http://<myservices>:8090'
#   $env:MSV_TOKEN = '<token shown once by MyServices>'
#   iex (iwr "$env:MSV_URL/agent/install.ps1" -UseBasicParsing).Content
#
# Uninstall: .\install.ps1 -Uninstall   (or set $env:MSV_UNINSTALL = '1' before the iex line)
# Re-running is safe: it downloads the agent again and renews the config and the scheduled task.
param(
  [string]$Url = $env:MSV_URL,
  [string]$Token = $env:MSV_TOKEN,
  [int]$Minutes = 15,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:ProgramData 'MyServices-Agent'
$TaskName = 'MyServices Agent'

function Die($msg) { Write-Host "x $msg" -ForegroundColor Red; exit 1 }
function Ok($msg) { Write-Host "+ $msg" -ForegroundColor Green }

$admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Die 'Run this in an elevated PowerShell (right-click -> Run as administrator).'
}

if ($Uninstall -or $env:MSV_UNINSTALL -eq '1') {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path $Dir) { Remove-Item $Dir -Recurse -Force }
  Ok 'MyServices agent removed (revoke its token in MyServices: Settings -> Agents).'
  exit 0
}

if ($Url -notmatch '^https?://[^\s/]+$') { Die "Bad MyServices address: '$Url' (expected http://host:port, no trailing path)" }
if ($Token -notmatch '^msv_agent_[A-Za-z0-9_-]+$') { Die 'Bad token: it must start with msv_agent_' }
if ($Minutes -lt 1 -or $Minutes -gt 1440) { Die 'Minutes must be between 1 and 1440' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol

New-Item -ItemType Directory -Path $Dir -Force | Out-Null
$AgentPath = Join-Path $Dir 'agent.ps1'
try {
  $script = (Invoke-WebRequest -Uri "$Url/agent/agent.ps1" -UseBasicParsing -TimeoutSec 30).Content
} catch { Die "Cannot download the agent from $Url : $($_.Exception.Message)" }
if ($script -is [byte[]]) { $script = [Text.Encoding]::UTF8.GetString($script) }
# A wrong address can answer with a web page: stop before touching a working agent (its script and its config)
$perr = $null; [void][Management.Automation.Language.Parser]::ParseInput($script, [ref]$null, [ref]$perr)
if ($script -notmatch 'MyServices agent for Windows' -or ($perr -and $perr.Count)) { Die "$Url did not send the agent: is it the address of MyServices?" }
# Windows PowerShell 5.1 reads a script without BOM as ANSI: write it with a BOM
[IO.File]::WriteAllText($AgentPath, $script, (New-Object Text.UTF8Encoding($true)))

@{ url = $Url; token = $Token; interval = $Minutes * 60 } | ConvertTo-Json | Set-Content (Join-Path $Dir 'config.json')
# Only SYSTEM and Administrators may read the folder (the token is in it); SIDs, so any Windows language works
& icacls.exe $Dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'Cannot restrict the rights on the agent folder' }
Ok "Agent installed in $Dir"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentPath`""
$startup = New-ScheduledTaskTrigger -AtStartup
$startup.Delay = 'PT30S'  # let the network come up before the first report after a boot
$triggers = @(
  $startup,
  (New-ScheduledTaskTrigger -AtLogOn),  # a session opening is a second chance when the startup run failed
  (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $Minutes))
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2)  # a failed run is retried by Windows
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Ok "Scheduled task '$TaskName' created (every $Minutes min, at startup and at logon)"

Write-Host '  First report (the Windows Update search can take a minute)...'
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $AgentPath
if ($LASTEXITCODE -ne 0) { Die "First report failed: see $Dir\agent.log (wrong address or revoked token?)" }
Ok 'Done: the machine now reports to MyServices.'
