"""One SSH connection per machine, shared by every read of a pass (health, ports, Docker, machine info, hypervisors, NPM, AdGuard,
backups): the first ssh opens it, the next ones go through it for 60 s, so a machine sees one handshake instead of one per command.
The socket sits in /tmp (a tmpfs in the Docker image, its root filesystem being read-only); %C keeps one per host, port and account."""
SSH_MUX = ["-o", "ControlMaster=auto", "-o", "ControlPath=/tmp/msv-ssh-%C", "-o", "ControlPersist=60"]
