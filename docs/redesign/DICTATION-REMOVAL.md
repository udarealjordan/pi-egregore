# Complete dictation removal

**Status:** Proposed implementation scope. Dictation remains present in the worktree until this slice is explicitly authorized.

## Decision

Remove Egregore's microphone dictation completely. It is not moved to an auxiliary package, hidden behind a flag, or retained as dead code.

The removed feature includes:

- `/dictate`;
- the fullscreen Composer bottom-rail microphone control;
- `REC`, transcription and download status labels;
- local `ffmpeg` capture and `whisper-cli` transcription;
- consent-gated speech-model download;
- `PI_DICTATION_*` environment controls;
- dictation-specific state, lifecycle, timers, prompt cancellation and mouse routing;
- dictation unit/integration tests;
- current user documentation and architecture descriptions.

Historical changelog and acceptance records remain as history. They are annotated or superseded by a new removal entry rather than rewritten.

## Source changes

| File | Required change |
| --- | --- |
| `extensions/pi-egregore/dictation.ts` | Delete |
| `extensions/pi-egregore/tests/dictation.test.mjs` | Delete |
| `extensions/pi-egregore/runtime.ts` | Remove import, controller variable, construction/state assignment, timer readout, disposal, prompt cancellation and `/dictate` registration |
| `extensions/pi-egregore/state.ts` | Remove `DictationController` import and `EgregoreState.dictation` |
| `extensions/pi-egregore/ui.ts` | Remove `dictationSpan` import and fallback-editor rail click routing |
| `extensions/pi-egregore/composer-editor.ts` | Remove `dictationSpan` import and decorated-editor rail click routing |
| `extensions/pi-egregore/composer-style.ts` | Remove microphone label, phase styling and width reservation from `composerBottomRail` |
| `extensions/pi-egregore/composer-icons.ts` | Remove the microphone glyph if no remaining caller uses it |
| `extensions/pi-egregore/README.md` | Remove Composer microphone description, Dictation section, command row and source-map reference |
| `docs/ARCHITECTURE.md` | Remove the current dictation ownership/lifecycle section |
| `docs/SURFACES.md` | Remove the current microphone boundary statement |
| `CHANGELOG.md` | Add a new removal entry; preserve older dictation entries as history |
| `AGENTS.md` | Replace the `pi-dictation` path example if it would otherwise read as a current feature reference |

No package dependency is removed because dictation added no npm dependency. No bundled asset is removed because speech models were downloaded to a user cache, not shipped.

## Behavior after removal

- `/dictate` is no longer registered.
- The Composer bottom rail contains directory, native Vim mode, model/thinking level and native scroll hints only.
- No microphone appears at any width or in any TUI mode.
- No `REC` timer, transcription phase or model-download prompt exists.
- The Composer no longer reserves rail width for a microphone.
- Rail clicks map only to native editor coordinates or intentional padding behavior.
- Prompt opening/closing no longer cancels capture.
- Session shutdown has no dictation controller to dispose.
- Pi and Egregore otherwise retain their existing run clock, animation and input behavior.

## Data and migration

Dictation owns no preference file, session entry or Work Record field. Therefore:

- no settings migration is required;
- no session rewrite is required;
- no compatibility alias for `/dictate` is retained;
- no user draft or transcript is changed;
- existing `ffmpeg`, `whisper-cli` or operating-system microphone permissions are not modified;
- cached Whisper models are not deleted automatically;
- temporary capture files remain governed by the existing cleanup behavior until the code is removed; the removal slice must not introduce a new background cleanup task.

Document optional manual cache cleanup separately if desired. Do not delete user files as part of code removal.

## Documentation treatment

Current guides must describe the post-removal product. Historical records must remain truthful:

- keep old changelog entries;
- keep old acceptance evidence;
- add a new changelog entry stating that dictation was removed at the user's request;
- update `docs/ACCEPTANCE.md` only with newly executed removal verification;
- generic discussion of a user dictating through macOS or another tool is not an Egregore feature reference and may remain;
- no current guide should advertise `/dictate`, a microphone rail, `PI_DICTATION_*`, or local Whisper setup as Egregore functionality.

## Verification gates

### Static

- `rg -n -i 'dictat|microphone|PI_DICTATION|whisper|ffmpeg|REC '` finds no active runtime/test/current-doc references; any remaining matches are explicitly historical or generic.
- Typecheck passes with no dangling imports or state fields.
- Package dry-run includes no dictation module or test.
- Command inventory and deploy checks do not require `/dictate`.

### Runtime

- Fresh fullscreen and regular sessions show no microphone at 24, 40, 90 and 140 columns.
- Composer bottom rail layout and model/Vim truncation remain correct after reclaiming the microphone space.
- Native editor mouse coordinates, cursor, IME markers, Vim mode, draft and undo are unchanged.
- Opening/closing Ask and other prompts does not reference dictation.
- Reload and session shutdown leave no controller, child process or timer.
- Non-TUI modes still expose the same domain tools without UI-only dictation behavior.

### Suite

- Remove dictation tests rather than skipping them.
- Run `npm test` and `npm run pack:check`.
- Add or update a regression assertion that the bottom rail never contains a microphone and `/dictate` is absent from the registered command inventory.
- Preserve all unrelated Composer, animation, copy, Ask and Tasks tests.

## Rollback

Because this is a deliberate feature removal, rollback means restoring the feature from Git history if the user later reverses the decision. There is no settings rollback and no user-data migration. The implementation commit must be isolated so a future restoration does not overwrite unrelated redesign work.
