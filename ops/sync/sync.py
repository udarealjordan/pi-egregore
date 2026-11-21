#!/usr/bin/env python3
"""Fetch, check and activate Pi Egregore releases without touching a dev checkout."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile

URL = "https://github.com/udarealjordan/pi-workspace.git"
STATE = Path(__file__).resolve().parent
MIRROR = STATE / "upstream.git"
ACTIVE = STATE / "current"
RELEASES = STATE / "releases"
# Releases without an egregoreSync manifest predate it and still need these commands.
LEGACY_REQUIRED = {"egregore", "tasks", "questions", "quests"}


def required_commands(candidate):
    """Each release names the commands it must provide, so renames ship with the code."""
    manifest = json.loads((Path(candidate) / "package.json").read_text(encoding="utf-8"))
    declared = manifest.get("egregoreSync", {}).get("requiredCommands")
    if declared is None:
        return LEGACY_REQUIRED
    if not isinstance(declared, list) or not declared or not all(isinstance(c, str) and c for c in declared):
        raise RuntimeError("package.json egregoreSync.requiredCommands must be a non-empty list of command names")
    return set(declared)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, timeout=240, **kwargs)


def git(*args, **kwargs):
    return run("git", "--git-dir", str(MIRROR), *args, **kwargs)


def smoke(candidate):
    required = required_commands(candidate)
    with tempfile.TemporaryDirectory(prefix="pi-egregore-check-") as tmp:
        scratch = Path(tmp)
        settings = scratch / "settings.json"
        settings.write_text(json.dumps({"packages": [str(candidate)]}), encoding="utf-8")
        result = run("pi", "--offline", "--no-session", "--mode", "rpc", cwd=tmp,
                     env={**os.environ, "PI_CODING_AGENT_DIR": tmp},
                     input='{"type":"get_commands"}\n', capture_output=True)
        commands = set()
        for line in result.stdout.splitlines():
            if not line.startswith("{"):
                continue
            reply = json.loads(line)
            if reply.get("type") == "response" and reply.get("command") == "get_commands" and reply.get("success"):
                commands.update(c["name"] for c in reply["data"]["commands"] if c["source"] == "extension")
            if reply.get("type") == "extension_error":
                raise RuntimeError(f"Pi startup extension error: {reply}")
        if not required <= commands:
            raise RuntimeError(f"Missing Pi commands {sorted(required - commands)}\n{result.stderr}\n{result.stdout}")
        if result.stderr.strip():
            print(result.stderr.strip(), flush=True)


def sync():
    os.environ.update(GIT_TERMINAL_PROMPT="0", NO_COLOR="1")
    RELEASES.mkdir(exist_ok=True)
    if not MIRROR.exists():
        run("git", "init", "--bare", "-b", "main", str(MIRROR), stdout=subprocess.DEVNULL)
    git("fetch", "--quiet", "--no-tags", URL, "refs/heads/main")
    revision = git("rev-parse", "FETCH_HEAD", capture_output=True).stdout.strip()
    candidate = RELEASES / revision
    if ACTIVE.is_symlink() and ACTIVE.resolve() == candidate:
        print(f"Already current: {revision}", flush=True)
        return
    if ACTIVE.is_symlink():
        git("merge-base", "--is-ancestor", ACTIVE.resolve().name, revision)
    elif ACTIVE.exists():
        raise RuntimeError(f"Refusing to replace non-symlink {ACTIVE}")
    if not candidate.exists():
        git("worktree", "add", "--detach", str(candidate), revision)
        try:
            run("npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", cwd=candidate)
            smoke(candidate)
        except Exception:
            git("worktree", "remove", "--force", str(candidate))
            raise
    else:
        # An interrupted build may have left a checkout. Never activate it without a check.
        try:
            smoke(candidate)
        except Exception:
            git("worktree", "remove", "--force", str(candidate))
            raise
    with tempfile.TemporaryDirectory(dir=STATE) as tmp:
        link = Path(tmp) / "current"
        link.symlink_to(candidate, target_is_directory=True)
        link.replace(ACTIVE)
    print(f"Activated {revision}", flush=True)


def register(settings, replace):
    if not ACTIVE.is_symlink() or not ACTIVE.is_dir():
        raise RuntimeError("Run sync successfully before registration")
    settings.parent.mkdir(parents=True, exist_ok=True)
    raw = settings.read_bytes() if settings.exists() else None
    config = json.loads(raw) if raw is not None else {}
    packages = config.setdefault("packages", [])
    paths = [p if isinstance(p, str) else p["source"] for p in packages]
    source = str(ACTIVE)
    if source in paths:
        return
    if replace:
        index = paths.index(replace)
        old = packages[index]
        packages[index] = source if isinstance(old, str) else {**old, "source": source}
    else:
        packages.append(source)
    with tempfile.NamedTemporaryFile(prefix=".egregore-settings-", dir=settings.parent, delete=False) as tmp:
        draft = Path(tmp.name)
        tmp.write((json.dumps(config, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    try:
        if (settings.read_bytes() if settings.exists() else None) != raw:
            raise RuntimeError("Pi settings changed during registration; retry")
        if raw is not None:
            with tempfile.NamedTemporaryFile(prefix="settings.before-registration-", suffix=".json", dir=STATE, delete=False) as handle:
                handle.write(raw)
                print(f"Settings backup: {handle.name}", flush=True)
        draft.replace(settings)
    finally:
        draft.unlink(missing_ok=True)
    print(f"Registered {source} in {settings}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("sync")
    setup = commands.add_parser("register")
    setup.add_argument("--settings", type=Path, default=Path.home() / ".pi/agent/settings.json")
    setup.add_argument("--replace", help="Replace this existing source without changing its filters")
    args = parser.parse_args()
    with (STATE / "sync.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.action == "sync":
                return
            raise RuntimeError("Sync is running; try registration again shortly") from None
        if args.action == "sync":
            sync()
        else:
            register(args.settings, args.replace)


if __name__ == "__main__":
    main()
