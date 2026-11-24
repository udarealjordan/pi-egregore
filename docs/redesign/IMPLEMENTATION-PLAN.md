# Phased implementation and verification

**Status:** Phases 1–2 (NativeHost and semantic clean copy) are implemented in the isolated redesign worktree. Phases 3–7 remain proposed and separately authorized.

## Worktree and branch

- Worktree: `/Users/jordan/code/pi-egregore-redesign`
- Branch: `redesign/calm-core`
- Base: `origin/main` at `5181a75`
- Reapplied change: `remove-herdr` as `7987863`
- Existing checkouts/worktrees remain untouched.

Before runtime work, install dependencies in the redesign worktree with `npm ci`. Do not reuse or modify another worktree's `node_modules`.

## Global constraints

Every slice must:

- preserve Pi's native editor, Vim instance, draft, undo, completion, selection, cursor and IME contract;
- preserve Ask and Tasks state ownership;
- preserve native fallback for unknown/self-rendering/graphical surfaces;
- keep one settings authority per field;
- avoid idle animation and avoid motion while blocking input/settings owns focus;
- include regression tests for corrected behavior;
- run the relevant component tests and full `npm test` for runtime changes;
- run `npm run pack:check` when package entries, exports, files or dependencies change;
- avoid live settings changes, installation migration, publishing and deployment unless separately authorized.

Use one coherent local commit per slice. A commit is not a push or release. Pushing `main` deploys and is outside this plan.

## Phase overview

| Phase | User-visible result | Structural result |
| --- | --- | --- |
| 0 | Design reviewed | Worktree and specs only |
| 1 | Implemented: no intended visual change | NativeHost owns Pi adapter lifecycle and reports capability fallbacks |
| 2 | Implemented: clean fullscreen copy without scaffolding | Semantic copy projections and row/cell-local fallback |
| 3 | Dictation disappears completely | Smaller core and no capture/transcription subsystem |
| 4 | Calm default, Study and Expressive presets | Coherent preset transaction over existing visual authority |
| 5 | Core and auxiliary responsibilities are explicit | Code-level module split without speculative packages |
| 6 | Tasks becomes an optional Work Record | Durable coding/learning/research continuity |
| 7 | Optional later public adapter API | Only after internal contracts are proven |

Phases 1 and 2 together are the recommended first implementation slice because they fix the concrete copy defect and establish the compatibility boundary required by later surfaces.

---

## Phase 1 — Centralize native compatibility (implemented)

### Changes

- Add `extensions/pi-egregore/native/host.ts`, `capabilities.ts` and `shapes.ts`.
- Move install/teardown ownership for editor, message, tool, selection, paint and flash adapters behind NativeHost.
- Keep existing renderer modules and visual output unchanged in this phase.
- Make mount generation/inert-first teardown explicit.
- Add a read-only capability report for `/egregore` → General → Native integration.
- Ensure all private native shape reads occur in the compatibility boundary.

### Files likely touched

- `extensions/pi-egregore/runtime.ts`
- `extensions/pi-egregore/surface-lifecycle.ts`
- new `extensions/pi-egregore/native/*`
- existing adapter modules only where ownership is delegated
- General settings room and its tests
- `docs/ARCHITECTURE.md`, `extensions/pi-egregore/README.md`, `CHANGELOG.md`

### Verification

- Full `npm test`.
- Cold start, `/reload`, session switch and shutdown leave no stacked wrappers.
- Native and pi-vim editor identity, draft, undo, cursor and completion survive.
- Ask and Tasks startup order remains independent.
- Unknown host shapes produce native fallback, not startup failure.
- Capability report matches actual adapter status.
- Fullscreen and regular TUI render unchanged at representative widths.

### Rollback

Revert the NativeHost delegation commit. Because rendering behavior is unchanged, rollback should not require data or settings migration.

---

## Phase 2 — Semantic clean copy (implemented)

### Changes

- Add `pi-agent-contracts/copy` with versioned projection types, validators and pure helpers.
- Add projection registration helpers to NativeHost.
- Convert Composer, native chat and supported tool frames from geometry-only copy metadata to semantic projections.
- Replace whole-selection fallback with row-local fallback.
- Add Ask and Tasks dock/panel projections.
- Keep regular terminal selection native and document the boundary.

### Files likely touched

- `packages/pi-agent-contracts/src/copy.ts`
- `packages/pi-agent-contracts/package.json`
- `extensions/pi-egregore/native/selection.ts`
- `extensions/pi-egregore/copy-selection.ts` (removed after migration to `native/selection.ts`)
- Composer/chat/tool render registrations
- Ask question shell and Tasks dock/panel
- copy tests and host-shape tests
- current copy documentation

### Verification

- Projection validator tests.
- Real `TuiAltScreen` selection and native clipboard path.
- Native/Vim/fallback Composer.
- User/assistant messages, collapsed/expanded/web tools, Ask and Tasks.
- Partial/reverse/multi-row selections and mixed native/projected rows.
- Decoration-only selections return no text.
- Literal pipes, box glyphs, indentation and blank lines survive.
- CJK, emoji, combining characters, ANSI/OSC links and wide cells map correctly.
- Streaming, resize, scroll, stale projection and overlay cases fall back only on affected rows.
- Copy never changes draft, cursor, selection, run state or tool expansion.
- Regular mode remains terminal-native.
- Full `npm test`, host-shape tests and `npm run pack:check`.

### Rollback

Revert projection registration and contract additions together. Keep NativeHost from Phase 1. No user data or preferences are migrated by copy projections.

---

## Phase 3 — Remove dictation completely

Implement the scope in [DICTATION-REMOVAL.md](DICTATION-REMOVAL.md).

### Verification

- Static search finds no active dictation runtime/test/current-doc references.
- `/dictate` is absent from command inventory.
- No microphone or `REC` label at any width/mode.
- Composer rail layout and mouse coordinates remain correct.
- No controller, child process, timer or prompt-cancellation reference remains.
- Dictation tests are deleted, not skipped.
- Full `npm test` and `npm run pack:check`.

### Rollback

Restore the isolated removal commit from Git history if the decision is reversed. There is no settings/session rollback.

---

## Phase 4 — Calm presets and simpler front door

Implement [EXPERIENCE.md](EXPERIENCE.md).

### Changes

- Add versioned preset provenance to `pi-egregore.json`.
- Fresh installs select Calm; existing customized installs remain Custom until explicit selection.
- Materialize Calm/Study/Expressive as ordinary visual field patches.
- Add preset preview, diff summary, Reset to preset and customized state.
- Add the compact Experience strip without removing advanced controls.
- Keep companion files outside the preset transaction.

### Decision required before implementation

Confirm whether notification sounds should default off in the redesigned experience. The design proposes off because audio is preference-sensitive; current behavior defaults on. This is a material default change and must not slip in with presets.

### Verification

- Fresh Calm and legacy/custom migration tests.
- Exact preset field patches; no companion-file writes.
- Save/Undo/Discard/failed Save leave draft, plans, answers and transcript untouched.
- Unknown future preset/settings versions block Save and preserve bytes.
- Narrow/wide, light/dark, Nerd/plain and reduced-motion rendering.
- Motion starts/stops under documented real-work and safety gates.
- Full suite and package checks.

### Rollback

Revert preset schema/UI commit. Existing visual fields remain authoritative, so no destructive settings migration is needed.

---

## Phase 5 — Core and auxiliary module split

### Changes

- Introduce code-level `core/`, `features/` and `shared/` ownership under Egregore.
- Keep advanced appearance, `/btw`, sounds and recaps out of core startup responsibilities.
- Route any future auxiliary native adaptation through NativeHost.
- Do not create new npm packages unless an independent install/use case and standalone contract are demonstrated.

### Verification

- Core cold start does not initialize auxiliary controllers/timers.
- `/btw`, sounds and recaps retain their existing command behavior and cleanup.
- Standalone Ask, Tasks without Egregore and Frame remain unaffected.
- No duplicate extension registration or package entry.
- Full suite and packed-suite cold-load test.

### Rollback

Revert module moves/import boundaries. No data migration is involved.

---

## Phase 6 — Tasks Work Record

Implement [WORK-RECORD.md](WORK-RECORD.md) only after explicit approval of its public contract and closure behavior.

### Changes

- Plan book schema v5 with additive optional `WorkRecord`.
- `capture` and `record` tool operations.
- Bounded Work Record context summary.
- Work/Understanding/Questions/History panel navigation.
- Ready-to-close/outcome semantics for new records; legacy closure retained for migrated plans.
- Egregore dock/transcript projections and native fallback.

### Verification

- v2–v4 migration and unknown-version fail-closed tests.
- Branch/fork/compaction restoration.
- Optimistic revision conflicts and user-edit precedence.
- Casual chat creates no record/dock.
- Coding, learning and research fixtures with and without checklists.
- Ask submission/delivery/application remains separate from decision capture.
- Closure/reopen preserves outcome history.
- Bounded summaries and artifact/source references.
- TUI, non-TUI, standalone Tasks and no-Egregore modes.
- Full suite and package checks.

### Rollback

Revert the schema/tool/UI commit before any v5 data is created. If v5 session data already exists, older code must fail closed rather than silently downgrade; rollback then requires a reviewed migration or branch restoration, not a blind checkout.

---

## Phase 7 — Public adapter API, only if justified

After internal NativeHost, copy projections and Work Record contracts are proven:

- evaluate a versioned public surface adapter contract;
- require at least one independently developed integration or representative external owner;
- publish compatibility policy, examples and fallback semantics;
- keep Frame passive and avoid a global renderer.

This phase is not authorized by the current design work.

---

## Cross-phase verification matrix

### Automated per runtime slice

```sh
npm test
npm run pack:check
git diff --check
```

Run the relevant focused suite while iterating, but do not substitute it for the full chain.

### Host matrix

- Declared minimum Pi host.
- Current installed Pi host.
- Native editor and installed pi-vim where applicable.
- Fullscreen and regular TUI.
- TUI, print/JSON and RPC modes.

### Terminal/UI checks

- 24/40/64/90/140 columns and short terminals.
- Light/dark themes, 256-color/truecolor, plain/Nerd icons.
- CJK, emoji, combining characters, ANSI labels and literal border glyphs.
- Keyboard and mouse paths, resize, scroll, streaming and reload.
- Cursor/IME markers, Vim mode/undo, selection/copy and native fallback.
- Motion safety gates and disposal.

### Physical/manual acceptance

Automated tests do not establish:

- physical drag selection or terminal clipboard integration;
- IME candidate-window behavior;
- font/glyph legibility on the user's terminal;
- perceived animation quality or reduced-motion comfort;
- screen-reader accessibility;
- authenticated provider/tool workflows.

Record these separately. Do not mark them passed from unit tests or screenshots alone.

## Evidence and documentation

For each implemented slice:

1. Update the relevant current guide and architecture description.
2. Add a new changelog entry for releasable behavior changes.
3. Add a dated acceptance record with exact commands and observed results.
4. Keep historical evidence intact.
5. Distinguish automated, isolated-terminal, live-configuration and human observations.
6. Do not commit private sessions, credentials, preferences, captures or model transcripts.

## Stop conditions

Stop and ask before proceeding if:

- a slice requires a public contract or data migration not described here;
- native fallback would be removed to make a test pass;
- a preset would write companion preference files atomically without tested rollback;
- auxiliary code needs direct Pi patches outside NativeHost;
- Work Record closure would change existing user data semantics;
- the remote branch advances and the redesign branch needs integration;
- deployment, live settings changes, publication or authenticated model evaluation is proposed.

## Definition of done for the redesign

The redesign is complete when:

- supported fullscreen surfaces copy semantic text without Egregore scaffolding;
- NativeHost is the sole owner of Pi-native compatibility and reports fallbacks truthfully;
- Calm is the fresh-install default and Study/Expressive are coherent, reversible presets;
- dictation is fully removed;
- core and auxiliary responsibilities are explicit without speculative packaging;
- Tasks can carry durable coding or learning work without forcing plans on casual chat;
- Pi remains the runtime and native editor remains intact;
- full automated, host-matrix, package and documented manual gates have been run for each implemented phase.
