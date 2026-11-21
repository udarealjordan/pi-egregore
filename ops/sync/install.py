#!/usr/bin/env python3
"""Install or update the Pi Egregore sync job for this user, migrating from Pi Workspace sync.

Copies the sync script into ~/.local/share/pi-egregore-sync, activates the first release,
points Pi's settings at it (keeping the old entry's extension filters), schedules a check
every 10 minutes and turns off the old pi-workspace-sync job. The old folder is left in
place so running Pi processes keep their release; remove it after they have restarted.
"""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
HOME = Path.home()
STATE = HOME / ".local/share/pi-egregore-sync"
OLD_STATE = HOME / ".local/share/pi-workspace-sync"
SETTINGS = HOME / ".pi/agent/settings.json"
LABEL = "io.pi-egregore.sync"
OLD_LABEL = "io.pi-workspace.sync"
FILES = ("sync.py", "test_sync.py", "README.md")


def run(*args, check=True):
    print("+", " ".join(map(str, args)), flush=True)
    return subprocess.run([str(a) for a in args], check=check, text=True)


def saved_path(unit_text):
    """Reuse the PATH an existing job was given, since it was tuned for this machine."""
    for line in unit_text.splitlines():
        line = line.strip()
        if line.startswith("Environment=PATH="):
            return line.removeprefix("Environment=PATH=")
        if line.startswith("<string>") and "/bin:" in line:
            return line.removeprefix("<string>").removesuffix("</string>")
    return os.environ.get("PATH", "/usr/bin:/bin")


def install_files():
    STATE.mkdir(parents=True, exist_ok=True)
    STATE.chmod(0o700)
    for name in FILES:
        target = STATE / name
        shutil.copyfile(HERE / name, target)
        target.chmod(0o600)


def first_sync_and_register():
    run(sys.executable, STATE / "sync.py", "sync")
    register = [sys.executable, STATE / "sync.py", "register", "--settings", SETTINGS]
    old = str(OLD_STATE / "current")
    if SETTINGS.exists() and old in SETTINGS.read_text(encoding="utf-8"):
        register += ["--replace", old]
    run(*register)


def schedule_macos():
    agents = HOME / "Library/LaunchAgents"
    old_plist, plist = agents / f"{OLD_LABEL}.plist", agents / f"{LABEL}.plist"
    path = saved_path(next((p.read_text(encoding="utf-8") for p in (old_plist, plist) if p.exists()), ""))
    log = STATE / "sync.log"
    plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>{path}</string>
	</dict>
	<key>Label</key>
	<string>{LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{sys.executable}</string>
		<string>{STATE / "sync.py"}</string>
		<string>sync</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardErrorPath</key>
	<string>{log}</string>
	<key>StandardOutPath</key>
	<string>{log}</string>
	<key>StartInterval</key>
	<integer>600</integer>
	<key>WorkingDirectory</key>
	<string>{STATE}</string>
</dict>
</plist>
""", encoding="utf-8")
    domain = f"gui/{os.getuid()}"
    if old_plist.exists():
        run("launchctl", "bootout", domain, old_plist, check=False)
        old_plist.rename(old_plist.with_suffix(".plist.disabled"))
    run("launchctl", "bootout", domain, plist, check=False)
    run("launchctl", "bootstrap", domain, plist)


def schedule_linux():
    units = HOME / ".config/systemd/user"
    units.mkdir(parents=True, exist_ok=True)
    old_service = units / "pi-workspace-sync.service"
    path = saved_path(old_service.read_text(encoding="utf-8")) if old_service.exists() else saved_path("")
    (units / "pi-egregore-sync.service").write_text(f"""[Unit]
Description=Synchronize Pi Egregore from GitHub main

[Service]
Type=oneshot
Environment=PATH={path}
WorkingDirectory=%h/.local/share/pi-egregore-sync
ExecStart={sys.executable} %h/.local/share/pi-egregore-sync/sync.py sync
UMask=0077
""", encoding="utf-8")
    (units / "pi-egregore-sync.timer").write_text("""[Unit]
Description=Check for Pi Egregore updates every 10 minutes

[Timer]
OnCalendar=*:0/10
Persistent=true

[Install]
WantedBy=timers.target
""", encoding="utf-8")
    run("systemctl", "--user", "disable", "--now", "pi-workspace-sync.timer", check=False)
    run("systemctl", "--user", "daemon-reload")
    run("systemctl", "--user", "enable", "--now", "pi-egregore-sync.timer")


def main():
    install_files()
    first_sync_and_register()
    if platform.system() == "Darwin":
        schedule_macos()
    elif platform.system() == "Linux":
        schedule_linux()
    else:
        raise SystemExit("Only macOS and Linux (including WSL) are supported")
    print(f"Installed. Active release: {(STATE / 'current').resolve()}")
    if OLD_STATE.exists():
        print(f"The old folder {OLD_STATE} is untouched. Remove it once no Pi process from before the migration is running.")


if __name__ == "__main__":
    main()
