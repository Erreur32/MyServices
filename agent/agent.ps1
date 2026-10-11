# MyServices agent for Windows: reads the health of this PC and sends it to the MyServices server.
# Run by a SYSTEM scheduled task (see install.ps1). Read-only: it changes nothing on the machine.
# PowerShell 5.1 compatible. Config: %ProgramData%\MyServices-Agent\config.json ({url, token, interval}).
$ErrorActionPreference = 'Stop'
$Version = '__VERSION__'
$Dir = Join-Path $env:ProgramData 'MyServices-Agent'
$LogPath = Join-Path $Dir 'agent.log'
$StatePath = Join-Path $Dir 'state.json'
$UpdateEvery = 3600  # s: the Windows Update search is slow, so it runs at most once per hour

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
  $env:MSV_UPD = ''
  if ($state -and $state.upd_at -and ((Get-Date) - [datetime]$state.upd_at).TotalSeconds -lt $UpdateEvery -and $null -ne $state.upd) {
    # Windows PowerShell 5.1 turns an array read back from a JSON file into {"value":[...],"Count":n}: unwrap it and force strings
    $u = $state.upd; if ($u -and $u.value) { $u = $u.value }
    $env:MSV_UPD = ConvertTo-Json -InputObject ([string[]]@($u | ForEach-Object { "$_" })) -Compress
  }

  $collect = {
#__COLLECT__
  }
  $data = & $collect | Out-String
  $data = $data.Trim()
  if (-not $data.StartsWith('{')) { throw 'collection returned no data' }

  if (-not $env:MSV_UPD) {  # fresh search: keep its titles for the next runs
    try {
      $o = $data | ConvertFrom-Json
      if ($null -ne $o.upd) {
        $titles = [string[]]@($o.upd | ForEach-Object { "$_" })
        ConvertTo-Json -InputObject @{ upd_at = (Get-Date).ToString('o'); upd = $titles } -Depth 3 | Set-Content $StatePath
      }
    } catch { }
  }
  $env:MSV_UPD = ''

  $os = (Get-CimInstance Win32_OperatingSystem).Caption
  $body = '{{"version":{0},"os":{1},"host":{2},"interval":{3},"data":{4}}}' -f (Json $Version), (Json $os), (Json [Environment]::MachineName), [int]$cfg.interval, $data
  # Right after a boot the network (DNS, DHCP) is often not ready yet: retry instead of waiting for the next scheduled run
  $uptime = ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes
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
} catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 1
}
