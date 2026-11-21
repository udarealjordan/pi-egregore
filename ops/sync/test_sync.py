"""Exercise actual git, npm and Pi using a disposable copy of the deployed revision,
or of this checkout when run from the repository."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import sync


class DeploymentTest(unittest.TestCase):
    @staticmethod
    def _write(directory, manifest):
        directory.mkdir()
        (directory / "package.json").write_text(json.dumps(manifest))
        return directory

    def test_publish_only_after_smoke_and_preserve_local_filters(self):
        live = sync.ACTIVE.resolve() if sync.ACTIVE.is_symlink() else Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            upstream = root / "upstream"
            subprocess.run(["git", "clone", "--quiet", str(live), str(upstream)], check=True)

            def commit(*args):
                return sync.run("git", "-c", "user.name=Sync Test", "-c", "user.email=test@example.invalid",
                                "-c", "commit.gpgsign=false", *args, cwd=upstream)

            commit("switch", "-C", "main")
            state = root / "state"
            state.mkdir()
            sync.URL, sync.STATE = str(upstream), state
            sync.MIRROR, sync.RELEASES, sync.ACTIVE = state / "git", state / "releases", state / "current"
            sync.sync()
            original = sync.ACTIVE.resolve()
            manifest = upstream / "package.json"
            intact = manifest.read_text()
            broken = json.loads(intact)
            broken["pi"]["extensions"] = []
            manifest.write_text(json.dumps(broken))
            commit("commit", "-am", "Break extension discovery")
            with self.assertRaisesRegex(RuntimeError, "Missing Pi commands"):
                sync.sync()
            self.assertEqual(sync.ACTIVE.resolve(), original)
            self.assertEqual(list(sync.RELEASES.iterdir()), [original])
            manifest.write_text(intact)
            commit("commit", "-am", "Restore extension discovery")
            sync.sync()
            replacement = sync.ACTIVE.resolve()
            self.assertNotEqual(replacement, original)
            self.assertTrue(original.is_dir())
            sync.sync()
            self.assertEqual(sync.ACTIVE.resolve(), replacement)

            # A release declares its own commands: dropping one is allowed, an unknown one is rejected.
            declared = json.loads(intact)
            declared["egregoreSync"] = {"requiredCommands": ["egregore", "tasks"]}
            manifest.write_text(json.dumps(declared))
            commit("commit", "-am", "Declare required commands")
            sync.sync()
            declaring = sync.ACTIVE.resolve()
            self.assertNotEqual(declaring, replacement)
            declared["egregoreSync"] = {"requiredCommands": ["egregore", "no-such-command"]}
            manifest.write_text(json.dumps(declared))
            commit("commit", "-am", "Require a missing command")
            with self.assertRaisesRegex(RuntimeError, "no-such-command"):
                sync.sync()
            self.assertEqual(sync.ACTIVE.resolve(), declaring)
            declared["egregoreSync"] = {"requiredCommands": []}
            self.assertRaisesRegex(RuntimeError, "non-empty list", sync.required_commands,
                                   self._write(root / "empty", declared))

            settings = root / "pi" / "settings.json"
            settings.parent.mkdir()
            old = {"packages": [{"source": "/dev/checkout", "extensions": []}, "keep"], "custom": 1}
            settings.write_text(json.dumps(old))
            sync.register(settings, "/dev/checkout")
            updated = json.loads(settings.read_text())
            self.assertEqual(updated, {"packages": [{"source": str(sync.ACTIVE), "extensions": []}, "keep"], "custom": 1})
            self.assertEqual(json.loads(next(state.glob("settings.before-registration-*.json")).read_text()), old)
            raw = settings.read_bytes()
            sync.register(settings, "/dev/checkout")
            self.assertEqual(settings.read_bytes(), raw)


if __name__ == "__main__":
    unittest.main()
