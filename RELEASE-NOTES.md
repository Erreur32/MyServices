# Release notes: MyServices 0.19.0

> **Online release, early stage.** MyServices is usable but young: screens and settings may still change. Keep a copy of `config/` and `data/` before updating, and keep it on your local network.

**0.19.0** (22 October 2026): machines tell more (web servers, site paths, backups, services and storage checks), agents are lighter and see as much as SSH, Veeam backups go further, and fewer requests reach your machines.

## For everyone

**What's new?**
- **Machine window**:
  - the web servers of the machine (Nginx Proxy Manager, Anubis, Apache, nginx…), with how each one runs (Docker, systemd service or binary);
  - the path of each site, NPM → Anubis → the app behind it;
  - every container, even the ones no service points to;
  - a Backups section: the sets the machine produces, their folders and where the copies go.
- **Services and storage checks** on Linux machines: PM2, software RAID, ZFS, network shares, clock, failed timers, automatic updates, snaps, containers restarting in a loop. Services to restart after an update (needrestart) and Fail2ban bans are read too, through exact read-only sudo rules.
- **Agents, lighter and more complete**:
  - Linux agent 4 sends the same inventory as an SSH session (machine info, Docker, listening ports), so a machine looks the same either way;
  - Windows agent 9 reads its slow parts every 6 h, and reports are compressed;
  - the Linux installer takes `MSV_SUDO=1` to allow the three read-only commands that need root.
- **Veeam**:
  - the history of each job: recent failures and the observed rhythm;
  - a Backup Copy job can be attached to the job it copies (« copy of » in the Veeam wizard);
  - Veeam Agent (and Windows Server Backup) seen by the MyServices agent of a PC can be followed as backup sets, with no account to enter.
- **Fewer requests**: one SSH connection per machine and per pass; the listening ports are read every other collection; an agent report re-reads only its own machine.
- **Fixes**:
  - Home Assistant in advanced mode (ha-mcp) failed on every read since 0.18.3, and works again;
  - a Windows PC read over SSH works again;
  - a service whose target changed no longer keeps its old name.

**Updating**: `docker compose pull`, then `docker compose up -d` (with the `:latest` image). Nothing to change in your compose file.

**Agents**: automatic update is off by default. In Settings → Agents, click « Update now » on each agent (or turn automatic update on). On Linux, re-run the installer with `MSV_SUDO=1` in the `sudo env` list to read needrestart, Fail2ban and the process names behind the ports.

## In short, the technical side

- **Image**: `ghcr.io/erreur32/myservices:0.19.0` (amd64 and arm64). `:latest` follows the latest tag, `:main` the latest commit.
- **Agents**:
  - Linux agent 4 adds `hostinfo.REMOTE`, `docker_ssh.DOCKER_SH` / `NET_SH` and `process.LISTEN_SH` to its fixed command list; the server replays them with the SSH parsers (`agents.linux_inventory`).
  - `install.sh` writes `/etc/sudoers.d/myservices-agent` (replaces `myservices-agent-smart`).
  - Windows agent 9: slow blocks every 6 h, merged on the server.
- **Veeam**:
  - `/api/v1/sessions` is read (optional);
  - a set location may hold a second `veeam_job` (copy);
  - new backups host mode `api: "agent"` with `agent_backup` locations;
  - new routes `GET /backups/agents/discover` and `PUT /backups/agents`.
- **SSH**: ControlMaster shared by every read of a pass (60 s); the Windows health script goes through stdin (cmd.exe's 8191 limit).
- **Full list**: see [CHANGELOG.md](CHANGELOG.md).
