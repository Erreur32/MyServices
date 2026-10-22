# MyServices agent for Windows: reads the health of this PC and sends it to the MyServices server.
# Run by a SYSTEM scheduled task (see install.ps1). Read-only: it changes nothing on the machine.
# PowerShell 5.1 compatible. Config: %ProgramData%\MyServices-Agent\config.json ({url, token, interval}).
$ErrorActionPreference = 'Stop'
$Version = '__VERSION__'
$Dir = $PSScriptRoot  # the folder this script lives in (installed: %ProgramData%\MyServices-Agent), so a copy elsewhere keeps its own config and stays there after a self-update
$LogPath = Join-Path $Dir 'agent.log'
$StatePath = Join-Path $Dir 'state.json'
$UpdateEvery = 3600  # s: the Windows Update search is slow, so it runs at most once per hour
$SlowEvery = 21600   # s: hardware, physical disks and running services change little: read every 6 h (the server keeps the last ones)

function Log($msg) {
  $line = '{0} {1}' -f (Get-Date -Format 's'), $msg
  Write-Host $line
  try {
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 200KB) { Move-Item $LogPath "$LogPath.old" -Force }
    Add-Content -Path $LogPath -Value $line
  } catch { }
}

function Json($v) { ConvertTo-Json -InputObject $v -Compress }

try {
  $cfg = Get-Content (Join-Path $Dir 'config.json') -Raw | ConvertFrom-Json
  if ($cfg.url -notmatch '^https?://' -or $cfg.token -notmatch '^msv_agent_[A-Za-z0-9_-]+$') { throw 'config.json: bad url or token' }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol

  # Windows Update titles: reuse the last search while it is recent
  $state = $null
  if (Test-Path $StatePath) { try { $state = Get-Content $StatePath -Raw | ConvertFrom-Json } catch { } }
  $updAt = $null; $titles = $null
  if ($state -and $state.upd_at -and $null -ne $state.upd) {
    # Windows PowerShell 5.1 turns an array read back from a JSON file into {"value":[...],"Count":n}: unwrap it and force strings
    $u = $state.upd; if ($u -and $u.value) { $u = $u.value }
    $titles = [string[]]@($u | ForEach-Object { "$_" }); $updAt = [string]$state.upd_at
  }
  $env:MSV_UPD = ''
  if ($updAt -and ((Get-Date) - [datetime]$updAt).TotalSeconds -lt $UpdateEvery) { $env:MSV_UPD = ConvertTo-Json -InputObject $titles -Compress }
  $env:MSV_SKIP = ''
  if ($state -and $state.slow_at -and ((Get-Date) - [datetime]$state.slow_at).TotalSeconds -lt $SlowEvery) { $env:MSV_SKIP = '1' }

  $collect = {
#__COLLECT__
  }
  $data = & $collect | Out-String
  $data = $data.Trim()
  if (-not $data.StartsWith('{')) { throw 'collection returned no data' }

  $o = $null; try { $o = $data | ConvertFrom-Json } catch { Write-Verbose "report not parsed: $_" }   # read once: the state below, the system name and the boot time come from it
  # Keep for the next runs: the Windows Update titles of a fresh search, and when the slow blocks were last read
  if (-not $env:MSV_UPD -and $o -and $null -ne $o.upd) { $updAt = (Get-Date).ToString('o'); $titles = [string[]]@($o.upd | ForEach-Object { "$_" }) }
  $slowAt = if ($env:MSV_SKIP) { [string]$state.slow_at } else { (Get-Date).ToString('o') }
  try { ConvertTo-Json -InputObject @{ upd_at = $updAt; upd = $titles; slow_at = $slowAt } -Depth 3 | Set-Content $StatePath } catch { Write-Verbose "state not saved: $_" }
  $env:MSV_UPD = ''; $env:MSV_SKIP = ''

  $w = if (-not ($o -and $o.os.n -and $o.boot)) { Get-CimInstance Win32_OperatingSystem }   # only when the report lacks them
  $os = if ($w) { $w.Caption } else { [string]$o.os.n }
  $boot = if ($w) { $w.LastBootUpTime } else { [datetime]$o.boot }
  $body = '{{"version":{0},"os":{1},"host":{2},"interval":{3},"data":{4}}}' -f (Json $Version), (Json $os), (Json ([Environment]::MachineName)), [int]$cfg.interval, $data
  # Right after a boot the network (DNS, DHCP) is often not ready yet: retry instead of waiting for the next scheduled run
  $uptime = ((Get-Date) - $boot).TotalMinutes
  $tries = if ($uptime -lt 15) { 24 } else { 3 }  # just booted: up to ~6 min (24 x 15 s); otherwise 3 tries
  $sent = $false
  for ($i = 1; $i -le $tries -and -not $sent; $i++) {
    try {
      $r = Invoke-RestMethod -Uri ($cfg.url.TrimEnd('/') + '/myservices/api/v1/agent/report') -Method Post `
        -Headers @{ Authorization = "Bearer $($cfg.token)" } -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
      if (-not $r.ok) { throw 'server answered without ok' }
      $sent = $true
    } catch {
      if ($i -ge $tries) { throw }
      Log "try $i/$tries failed ($($_.Exception.Message)), new try in 15 s"
      Start-Sleep -Seconds 15
    }
  }
  Log "report sent to $($cfg.url) (agent $Version)"
  # Self-update, only when the server asks for it (automatic update on, or "update now" clicked in MyServices): download the script from the
  # server that already receives the reports, check its SHA-256 and its syntax, then replace this very file. The next run uses it.
  if ($r.update -and $r.update.sha256 -and $r.update.path -like '/myservices/agent/*') {
    try {
      $new = (Invoke-WebRequest -Uri ($cfg.url.TrimEnd('/') + $r.update.path) -UseBasicParsing -TimeoutSec 30).Content
      if ($new -is [byte[]]) { $new = [Text.Encoding]::UTF8.GetString($new) }
      $sha = -join ((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes($new)) | ForEach-Object { $_.ToString('x2') })
      if ($sha -ne [string]$r.update.sha256) { throw 'downloaded script does not match the announced SHA-256' }
      $tmp = "$PSCommandPath.new"
      [IO.File]::WriteAllText($tmp, $new, (New-Object Text.UTF8Encoding($true)))
      $perr = $null; [void][Management.Automation.Language.Parser]::ParseFile($tmp, [ref]$null, [ref]$perr)
      if ($perr -and $perr.Count) { Remove-Item $tmp -Force; throw 'downloaded script has syntax errors' }
      Move-Item $tmp $PSCommandPath -Force
      Log "agent updated to version $($r.update.version)"
    } catch { Log "UPDATE FAILED: $($_.Exception.Message)" }
  }
} catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 1
}
