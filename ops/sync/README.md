# Egregore sync

Each machine (Mac, PC under WSL, VPS) checks `main` on GitHub every 10 minutes. A push or merge to `main` deploys. To undo a deploy, revert and push; don't rewrite `main`.

For each new commit the job:

1. builds a detached checkout under `~/.local/share/pi-egregore-sync/releases/<commit>`,
2. installs locked runtime dependencies with npm scripts disabled,
3. starts Pi offline and checks that the release provides every command listed in `package.json` → `egregoreSync.requiredCommands`,
4. points `current` at the new checkout.

A release that fails the check is discarded and `current` stays where it was. Older checkouts are kept so running Pi processes aren't pulled off them. Start a fresh Pi process to use an update.

The job never edits Pi settings after installation, syncs credentials, updates Pi itself or restarts Pi.

## Renaming or removing a command

Update `egregoreSync.requiredCommands` in `package.json` in the same commit. The check reads the list from the release it is testing, so nothing changes on the machines.

## Install or migrate a machine

From a checkout of this repository:

```sh
python3 ops/sync/install.py
```

The installer copies `sync.py` into `~/.local/share/pi-egregore-sync`, activates the first release, and points Pi's settings at `~/.local/share/pi-egregore-sync/current`. It replaces the old `pi-workspace-sync` entry and keeps its extension filters. It schedules the job (launchd `io.pi-egregore.sync` on macOS, systemd user timer `pi-egregore-sync.timer` on Linux) and turns off the old `pi-workspace-sync` job. The old folder stays until you delete it.

## Check on it

- macOS: `launchctl kickstart gui/$(id -u)/io.pi-egregore.sync`, then `tail -n 30 ~/.local/share/pi-egregore-sync/sync.log`.
- Linux and WSL: `systemctl --user start pi-egregore-sync.service`, then `journalctl --user -u pi-egregore-sync.service -n 30`.
- Anywhere: `readlink ~/.local/share/pi-egregore-sync/current` shows the active commit.

## Test

```sh
python3 ops/sync/test_sync.py
```

The test clones this checkout into a temporary folder and runs real git, npm and Pi. It covers a broken release that must not activate, a good one that must, declared command lists, and settings registration that keeps existing filters.

## Try the dev checkout instead

To run `~/code/pi-egregore` in one Pi process without the other configured extensions: `pi -ne -e "$HOME/code/pi-egregore"`.
