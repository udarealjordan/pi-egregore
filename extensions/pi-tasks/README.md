# pi-tasks

An **independent, optional named-plan library** for Pi 1.3.0. Keep separate plans for different requests within one session, browse earlier work, and let finished checklists leave the workspace. Egregore/Composer is an optional visual host, not the owner of state. Tasks is a checklist: named plans of tasks with statuses, notes and evidence. There is no background continuation, requirement ledger, coverage proof, network request, database or new runtime package.

## Start

Load the [suite](../../docs/INSTALL.md) and start a fresh Pi process after package/imported-module changes; `/reload` can refresh ordinary extension code. Open `/tasks` to inspect work. Existing single-plan task history is **preserved and migrated in memory** into **Earlier session plan**. Migration does not write merely from opening a session; the next successful mutation saves the new library format. New sessions start with no plans or sample tasks.

The agent is instructed and equipped to create a concise named plan for a **new substantial request**, and update the existing plan for a follow-up. Trivial requests need no plan. Older plans—including unfinished ones—are retained, not overwritten.

### Inspect history without changing current work

1. In Pi, open `/tasks history`.
2. Use Up/Down to choose a saved plan, then Enter to open its work. Groups are **Current**, **Open**, **Finished**, and **Archived**; `/` filters titles.
3. Open a task's details with Enter. Read its status, done-when condition, outcome and evidence; these are recorded reports, not independent verification.
4. Escape returns through details to the work list, then to the library, or closes the panel. Do not press **S make current** or **R restore** if you only intend to inspect.

Inspection does not switch plans, start work or complete tasks. Use the [command table](#commands) for an intentional switch; appearance settings for Egregore's overview belong to `/egregore`, not this panel.

## Responsibility and returning to work

A blocked task can record three facts: `reason` (what is missing), `blockerOwner` (`user`, `agent`, or `external`) and `unblockWhen` (the observable condition that allows progress). The owner and release condition are optional for compatibility with older records; the agent guidance asks for them on new blockers. Old records without them remain explicitly unspecified rather than guessing who must act. These fields describe the blocker, not authorization or a new task status. Leaving blocked state clears them.

- **Needs your input:** information or a decision belongs to you. The agent should ask a specific question and link the affected work.
- **Agent to resolve:** the agent owns the next investigation or repair. Work it can actively perform within scope should generally be active, not left blocked.
- **Waiting externally:** an external prerequisite must change. The agent records what would allow progress; there is no automatic polling loop.
- **Waiting on work:** unfinished `dependsOn` tasks explain a prerequisite. Not-started work is not labelled ready merely because it is next in the list.

Questions lead the work list with their affected plan/task and stated boundary. **Needs your input**, **Your perspective · can wait**, **Response saved · delivery pending**, and **Agent to apply answer** distinguish who can move the interaction forward. A delivered skipped/clarification response needs agent follow-up, not an invented approval. After applying an answer, the agent is instructed to reassess remaining prerequisites, update stale blockers and continue authorized work. Applying an answer does not automatically mutate or complete tasks.

Questions are surfaced, never gates. A linked unresolved question does not block starting, completing or archiving a task or plan; the checklist owner records what actually happened. Ask still owns the answer, and the agent should apply it rather than infer approval from silence.

The compact Composer dock groups attention separately from the expanded work list. An actual unanswered blocking question comes first, with its ID, affected-task count and `/questions qN` answer route. Delivered answers and pending delivery have their own agent/delivery labels. Agent activity, external waiting, agent-owned obstacles and not-started work are separate compact rows. Long blocker prose stays in `/tasks`; the dock uses one concise recorded release condition or reason per group. User-owned blocked tasks already represented by a linked unresolved question are counted there rather than repeated as dense rows. Additional questions/groups remain accessible through `/questions` and `/tasks`; these are grouped summaries, not a full checklist. Other-plan questions are labelled explicitly. The standalone fallback and Egregore settings preview follow the same vocabulary.

The expanded work list uses compact tree branches under the plan; completed work remains behind its counted F disclosure. Details retain full reasons, responsibility, release conditions, evidence and linked questions. This is a display of recorded state, not an independent monitor of real-world readiness.

Completion guidance keeps the requested response primary. There is no automatic completion turn.

## Commands

| Command | Behavior |
| --- | --- |
| `/tasks` | Open the work list in a distinct, raised panel |
| `/tasks history` | Open the plan library: current, open, finished and archived plans |
| `/tasks new Fix the search page` | Create/select a named plan without replacing older plans |
| `/tasks new` | Ask for a plan name |
| `/tasks use p2` | Make an existing non-archived plan current; does not run it |
| `/tasks archive` or `/tasks archive p2` | Remove a plan from the dock/current selection, preserving its contents; unfinished plans require confirmation |
| `/tasks restore p2` | Unarchive a plan and make it current; does not restart tasks |
| `/tasks rename A better name` | Rename the current plan |
| `/tasks add Some work to do` | Add a task yourself; create a fresh plan if none is current |
| `/tasks clear` | Confirm clearing the current plan's tasks; block agent regeneration until an explicit New/Add |
| `/tasks hide` | Hide only the dock; keep tracking and `/tasks` panel access active; save this preference |
| `/tasks unhide` | Restore dock visibility without enabling Tasks if it is off |
| `/tasks off` | Disable the tool, fresh context reminders and task UI; preserve **all plans** |
| `/tasks on` | Re-enable Tasks with its library and current selection intact |

Plan IDs (`p1`, `p2`, …) appear in history. Task IDs (`t1`, `t2`, …) are local to each plan. You do not need IDs for ordinary panel navigation.

**To hide visuals without changing work, use `/tasks hide`.** This removes the Tasks dock from Egregore and the native fallback. It does not hide transcript tool cards, disable tracking, change plans, or prevent `/tasks` from opening the panel. The preference survives reload and off/on; `/tasks unhide` restores normal dock behavior. Hiding Tasks does not silently hide Ask: unresolved questions use Ask's standalone attention cue. Link availability and attention hosting are separate protocol facts.

**Archive is the normal way to dismiss work**, not Clear. Archive is reversible and retains the readable checklist, notes and evidence. Clear empties a plan after confirmation; older raw session entries remain, but its previous task contents are not a separate item in the plan library. No automatic deletion or pruning is performed.

## Completed plans get out of the way

The visible Tasks dock uses the same active Pi accent (purple in the Composer palette) and border-matched title as assistant messages, both above Egregore's composer and in its independent native fallback. The `tasks` tool's call and result each have a matching purple frame; task bodies retain readable text and separate warning/error colors. Tiny terminals use unframed rows. Framing does not make the dock permanent after closure: when every task is **done** or **cancelled**, it shows a brief **✓ Plan finished · … · saved in /tasks** acknowledgment; after approximately **four seconds**, the entire plan dock disappears and the editor reclaims its space. The plan and its outcomes remain available through `/tasks` and `/tasks history`.

- Counts distinguish completed tasks from cancellations; an all-cancelled plan is not reported as successfully completed.
- Resume/reload does not replay an old completion acknowledgment. A recent one uses its original expiry rather than restarting four seconds.
- The expiry changes only the display. It writes no new history, makes no model call, and never continues the agent.
- Inspecting or selecting a finished plan does not recreate the dock. Adding work or explicitly reopening a task makes the plan open again.
- Closing/archiving a plan does not silently select or start another unfinished plan.
- There is at most one current plan. Others are paused records; task status is not proof that work is executing.

## Panel controls

The modal has an **opaque raised surface, accent perimeter and contrasting selection fill**, including when Egregore is absent. It is one priority-ordered list: unresolved questions first, then active, blocked and not-started work. The plan title is the header and counts are `${done} of ${total} done` plus blockers or cancellations only when they exist. The active task has a bold title and a separate, softer background tint even when another row is selected; its sourced **Working** or **Paused** label remains explicit. Blockers keep a warning mark and reason. Selection uses `›`.

Completed and cancelled work is a count, not a row: press **F** to reveal it. Full details use a short field list and an up-to-80-cell reading column. The footer is one action bar; segments drop from the end on narrow terminals, but the final help/back key always remains.

### Keys

- **Up/Down:** choose a record; scroll within details or help
- **Enter:** open task details, or answer the selected question above the panel
- **E:** edit the selected task in the current plan (also from its details)
- **F:** show/hide completed and cancelled work
- **H:** open the plan library; **A** add a task; **N** create a plan
- **S:** make a historical non-archived plan current; **R** restore an archived plan
- **T:** rename the viewed plan; **X** archive it; **C** clear its tasks with confirmation
- **O:** turn Tasks off; **?** open the one-screen key help; **Escape** returns one level or closes
- **Ctrl+C:** close the panel directly

Destructive keys are discoverable through **?**, not hidden in the list footer. `A`, `E` and `C` require the viewed plan to be current and unarchived; `T` and `X` work on any unarchived viewed plan; archived plans allow **R** only.

### Questions and coherent presentation

Ask owns questions, drafts, answers and their revisions. Tasks displays read-only versioned projections through a process-local data protocol; it never fabricates an answer or changes Ask state itself. Unresolved posted questions from the whole session lead the work list, including other plans and unlinked questions, because they are the one thing that may need the user. Selection follows the question key, so a question arriving above it does not move it. Rows name their link (`This session`, `<plan> / <task titles>`, or `<plan> / plan boundary`) and say **Waiting for you** or **Can wait**. Enter opens a focused Ask overlay. Escape first handles nested review/note/custom/clarification modes; outer Escape keeps the draft and returns to the same row. Urgency-only changes retain input and refresh the displayed boundary. Answer, skip and clarification kinds remain distinct from delivery stage. `/questions` remains available without Tasks or Egregore, and existing synchronous Ask tools are unchanged.

Blocking and deferred questions are distinct. The dock summary distinguishes `N needs you`, `N can wait`, `N delivery pending` and `N agent follow-up`; task completion counts do not imply question resolution. Deferred linked questions become blocking when the agent reaches their task boundary; submitted answers retain their delivery identity during this transition. None of these states gates task transitions; they inform the agent and the user. This does not intercept arbitrary bash calls or external side effects; do not treat it as universal approval enforcement. Withdrawal/replacement is not approval, does not change task status, and requires scope reconciliation before resuming changed work. Application is an agent report, not verification, and does not automatically complete Tasks.

Compact work cards replace repeated `Task · done:` prefixes with the shared vocabulary: success `✓` **Done**, accent `●` **In progress**, warning `!` **Blocked**, muted `○` **Not started**, and `–` **Cancelled**. Titles remain normal text, not green paragraphs. Status summaries appear once as `${done} of ${total} done`, followed only by the active/blocked/cancelled counts that exist. Updates without a status change retain the underlying status color. The frame and its title remain accent-colored, and plan listings use the plan word (Current/Open/Finished/Archived) instead of a glyph. Expand for textual status, attributed outcome notes, evidence and references. Wrapping aligns continuation lines beneath the title. Tiny unframed cards retain textual summaries; essential states do not depend on color. The transcript and native `/tasks` browser share this status vocabulary through `typography.ts`. In the browser, selection uses its own `›` marker and raised selection fill; status colors affect marks rather than entire titles. Work completion is summarized rather than repeated beneath every completed item. Question attention retains explicit qualifications, with gaps between records.

**Enter opens panel details; E edits; H opens the library; F reveals completed work.**

`/egregore` → Tasks still owns the persistent **Egregore overview** appearance, not arbitrary modal layout. The native browser keeps theme/raised-surface behavior; Ask overlays use `/egregore` → Ask's existing shell settings. Eligible Egregore transcript controls retain their scope; Tasks and Ask self-rendering cards keep their own result semantics. No duplicate preferences were added.

### Plan library

The library groups plans as **Current**, **Open**, **Finished**, and **Archived**, only non-empty, each sorted by most recent update. Rows show the plan name, progress and a short age. `/` starts a title search; typing filters case-insensitively, Enter keeps the filter and Escape clears it. Up/Down selects and Enter **opens a plan for inspection**. Browsing the library does **not** change the current plan, task statuses or execution. The opened plan's header says **Current**, **Open**, **Finished** or **Archived** and offers only the actions valid for it.

### The dock

Both hosts render the same facts: the plan name as the frame title, one summary string and the same open-work rows, in the same order. Active work reads `● Working · <title>` or `● Paused · <title>`, blockers read `! <title> · <reason>`, and pending work reads `○ <title>`. Done and cancelled work is never a row; it is a count. Long titles wrap within a fixed physical-line budget; active text gets spare lines first and an ellipsis marks clipped text. Selecting another plan or restoring a session/branch resets the dock; compaction preserves it.

When the dock is hidden, the composer keeps a fallback hint of the active task title; while the dock is visible it does not duplicate it. There is no separate focus/compact appearance: `pi-tasks.json` stores only enablement and dock visibility.

Transcript tool cards show the operation and committed task titles with explicit statuses, rather than raw implementation details. Single-task updates show only the changed task, and additions show the added tasks. Full titles wrap without an ellipsis or task-count cutoff. Plan creation includes the new name; history listings and plan switches have concise renderers.

## Independent controls

**`/tasks off` does not change Egregore's editor, identity, appearance or timing.** `~/.pi/agent/pi-tasks.json` (or the configured agent directory) stores only `enabled` and `hidden`; it is written separately from Egregore. A legacy `appearance` key is read without error and dropped on the next save. Atomic preference saves use mode 0600. Corrupt preferences fail closed instead of silently re-enabling Tasks.

Egregore off/removal does not disable Tasks. Tasks uses its own compact native widget and theme-aware raised panel. Turning Tasks off is not the same as cancelling the agent's ordinary work: it blocks task mutations immediately, but cannot erase information already sent in an in-flight request or historical transcript messages.

For this checkout-loaded suite, use **`/tasks off`** to disable Tasks alone while retaining Egregore and Ask. Moving the old personal extension directory does not disable the suite entry. To remove the whole local suite, use Pi's package removal with the registered checkout path, then start fresh; see the root installation/migration guide. Only a legacy auto-discovered standalone installation is removed by moving its `~/.pi/agent/extensions/pi-tasks` directory. Saved task entries remain metadata; no session deletion is required.

## State, scope and honesty

- **One checklist, no automatic continuation:** Tasks records plans and tasks. On settlement it makes no extra model request and starts no review turn. Before finishing authorized work the agent is guided to reconcile its checklist with real outcomes and explain any open items; that is model guidance, not an independent completion verifier.
- **Per-session, branch-aware library:** reload/resume/compaction restore the library. Forks inherit the branch-point plans and evolve independently. This is not a shared project backlog.
- **Pending / active / blocked / done / cancelled:** at most one active focus task per plan. Switching does not automatically activate a task or mark the old one done.
- **Dependencies:** blocked needs a reason; starting/completing requires completed dependencies; cycles and unknown IDs are rejected. Dependencies are within a plan, not across plans.
- **Completion:** done requires a truthful outcome note; cancellation requires a note. Evidence references are not independent verification. The panel preserves note attribution separately from the latest editor. A plan closes when every task is done or cancelled.
- **User precedence:** the agent cannot reopen user-closed tasks, restore an archive, or regenerate a cleared plan by creating another one. A user New/Add unlocks the cleared-plan guard. Agent archival is limited to already-closed plans; unfinished archival is a confirmed user action.
- **Optional snapshot revision:** a write may pass the `revision` from a read view to fail closed if the library changed in between. Omitting it applies the command to live state, which already validates selection, ids, dependencies, outcomes and user-cleared boundaries. Supplying a stale revision is rejected with `The plan changed. Read tasks again before updating; preserve the user's edits.` Historical task writes require selecting the plan first.
- **Durability:** sequential tools persist canonical metadata before publishing success. Failed storage/validation leaves the visible library unchanged.
- **Bounds:** at most 100 saved plans, 100 tasks per plan, 400 KB per task snapshot and 2 MB per library snapshot. A limit produces an explicit error; older plans are never silently evicted. Full snapshots mean the session log can grow over long sessions.
- **Bounded context:** selected-plan hydration includes at most 16 open tasks, plus metadata for up to five other unfinished plans. Full history is accessible through paginated tools. Task titles are data, not instructions or permission to expand scope.

Canonical custom entries retain the **`pi-tasks:plans-v2`** entry key but now store **payload version 4** (previously 3). Keeping the key makes older readers encounter an unsupported payload and fail closed instead of skipping new records and restoring stale plans. Version-2 and version-3 libraries carried a requirement ledger; the ledger is retired, so those records are validated, discarded, and never replaced with invented coverage. Legacy **`pi-tasks:plan-v1`** snapshots are validated and migrated in memory, including notes, evidence, dependencies, monotonic task IDs and user locks. The next mutation writes version 4. Unknown payload versions and malformed records block writes. Restoration reads only `sessionManager.getBranch()`. Corrupt snapshots are not silently replaced; writes are blocked until an explicit user reset.

The feature uses context tokens while enabled. Normal tool execution and the agent's own follow-up requests retain their token/cost impact; Tasks adds no continuation of its own and makes no real-model performance claim.

## Agent tool

The model-facing `tasks` tool supports:

- **`plans`** — paginated saved-plan metadata and current selection
- **`create`** — concise `title` and optional pending `items`; select the new plan without losing old ones
- **`select`** — `planId`; select an existing non-archived plan
- **`rename`** — `planId`, `title`
- **`archive`** — `planId`; agent may archive closed plans only
- **`list`** — tasks, optional `planId`, `offset`, `limit`; reading history does not select it
- **`add`** — optional `planId`, `items`; add to the current plan
- **`update`** — task `id`, `changes`

Every write also accepts an optional `revision`. Omit it for the live plan; pass it only to assert a snapshot you read. A stale value is rejected rather than silently overwriting newer work.

### Evidence-based stopping

Use `doneWhen` to define observable outcomes and sufficient verification before checks expand. Additional checks should address a distinct risk, changed state, inconclusive result, or known instability—not repeat successful checks for reassurance. Unfinished or unverified work stays explicitly unresolved; do not weaken conditions to stop sooner.

Before finishing work on a plan, the agent is guided to compare the user's actual request and any follow-ups with its checklist, complete only verified work, revise changed steps, block with a reason, or cancel superseded steps. Continue only work already authorized; otherwise explain the remaining work or ask one consequential question. Material outcomes and unresolved gaps should be reported; the user's actual request and chosen direction remain primary.

The offline comparison workflow is in `eval/harness/README.md` at the suite root. No model-performance improvement is claimed by the deterministic tests.

### Atomic outcomes

Capture each independently verifiable user-visible outcome, even a small wording change. Do not create a task for every tool call. Use `doneWhen` for task-level checks. A follow-up extends the same plan; an unrelated request gets another plan. Exploratory suggestions are not accepted work unless authorized.

List/history pages default to 20 and are capped at 20. Mutation responses include assigned IDs and the new library revision. The visible Add/Create result uses one `+ Added N tasks · not started` acknowledgment followed by `○`-prefixed titles; `pending` remains the stored status, not an approval request. This does not change the `/tasks` status controls or turn a successful add into a completion claim. `planId` defaults to current where meaningful; an initial legacy-style Add can create the first unnamed session plan for compatibility, but cannot overwrite or silently recreate a plan from history. Long tool-result notes are explicitly shortened; the panel retains full text.

Only the user controls enable/disable, restores archived plans and clears lists. Archive is not deletion. Creating/selecting a plan never authorizes additional work beyond the user's request.

## Egregore dock

The Egregore host consumes the same snapshot as the native fallback: plan title, summary, open-work rows ordered active → blocked → pending, and machine counts (done/blocked/cancelled plus the active identity) for progress feedback. The machine facts never reorder the stored plan or change a task status. Completed work stays in the counts and the full `/tasks` list rather than occupying the dock.

Customize this surface through **`/egregore` → Tasks**. Egregore uses the reusable `pi-embeddable-frame` presentation rules and its existing clock. Default motion is a soft travelling highlight during actual active work, with a bounded sweep on progress changes; waiting, typing, dialogs, hidden/narrow frames and motion-off stay still. Demo states in settings never create tasks or start a run.

`/tasks hide`, `off`, closure expiry and history remain unchanged. The shared `tasks` tool-call/result frame styling is unchanged.

## Optional Egregore integration

The `pi-agent-contracts` package defines the small, versioned event protocol (`pi-agent-contracts/dock`). `lib/task-frame.ts` defines the shared visual frame using the active theme's Pi accent. Egregore and Tasks do not import each other's implementations.

- Egregore advertises availability and optional semantic colors.
- Tasks publishes only the current plan's bounded display snapshot—or an empty snapshot once hidden/archived/off.
- Egregore acknowledges mounting; otherwise Tasks keeps a native fallback, without duplicate widgets.
- Timers and subscriptions are session-scoped. Expiry is cancelled on shutdown/off, and is absent in non-TUI modes.
- Only Egregore owns the editor/header/footer. Tasks never replaces them.

This is an interoperability convention among trusted extensions, not a security boundary. See `../pi-egregore/DOCK.md` for the production protocol. Earlier design research remains in Git history, not in the current interface.

## Validation

```sh
# From the suite repository root, with dependencies and a compatible Pi host installed:
npm run test:tasks && npm run test:workspace
```

Tests use installed pi packages rather than duplicate dependencies. Coverage includes v1/v2/v3 migration to the checklist form, plan isolation, archive protections, optional revision assertions, history pagination, no-continuation settlement, completion expiry, failed storage, branch/compaction restoration, user precedence, off/on and headless behavior, browse-only navigation, stale dialogs, explicit modal backgrounds, Unicode/narrow layouts and Egregore integration. Strict TypeScript checks cover both extensions and the bridge.

Offline fullscreen/regular PTY tests execute actual plan-creation/task tool calls, verify dock auto-hide and retained history, exercise New/Add dialogs, browse/select/archive/restore, independent toggles, reload, no-Egregore rendering, panel contrast, details, resize and saved settings. Real terminal captures were reviewed at 110×40 and 64×24. Fixtures are under `/tmp/pi-home-research/`, not installed in normal sessions. No paid model evaluation was run.
