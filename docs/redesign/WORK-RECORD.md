# Tasks as an optional Work Record

**Status:** Proposed design. The current plan library and task semantics remain unchanged until this slice is authorized.

## Goal

Evolve Tasks from a coding checklist into a durable, branch-local Work Record that works for coding, reading, research and learning. A checklist remains available when it helps, but it is no longer the only way to carry work forward.

The Work Record is optional. A normal question, explanation or quiz does not create one automatically.

## Ownership

| Information | Owner |
| --- | --- |
| Conversation, tool calls and full message history | Pi session |
| Work intent, constraints, sources, accepted decisions, findings, artifacts and outcome | Tasks Work Record |
| Checklist items, status, dependencies, blockers and task evidence | Existing Tasks state |
| Posted/blocking questions, answers, notes and delivery/application lifecycle | Ask |
| Presentation of the Work Record | Egregore when mounted; Tasks native fallback otherwise |
| Visual preferences | Existing `pi-egregore.json` / `pi-tasks.json` authorities |

The Work Record stores durable summaries and references. It does not copy transcripts, question bodies or tool results into a second database.

## Record shape

Extend each saved plan with an optional versioned record. Newly created plans receive a record; migrated legacy plans may omit one and retain legacy checklist behavior.

```ts
type WorkKind = "code" | "learn" | "research" | "mixed";

interface Constraint {
  id: string;
  text: string;
}

interface SourceRef {
  id: string;
  title: string;
  locator?: string;       // URL, path, citation or Pi session-entry ID
  note?: string;
  addedBy: "agent" | "user";
  addedAt: number;
}

interface AcceptedDecision {
  id: string;
  statement: string;
  rationale: string;
  sourceEntryId?: string; // Pi provenance, not copied message text
  questionId?: string;    // Ask provenance when a decision came from an answer
  acceptedBy: "agent" | "user";
  acceptedAt: number;
}

interface Finding {
  id: string;
  statement: string;
  sourceIds: string[];
  note?: string;
  recordedBy: "agent" | "user";
  recordedAt: number;
}

interface ArtifactRef {
  id: string;
  kind: "note" | "quiz" | "summary" | "file" | "link" | "other";
  title: string;
  locator?: string;
  note?: string;
  recordedBy: "agent" | "user";
  recordedAt: number;
}

interface WorkOutcome {
  summary: string;
  artifactIds: string[];
  recordedBy: "agent" | "user";
  recordedAt: number;
}

interface WorkRecord {
  version: 1;
  kind: WorkKind;
  intent: string;
  constraints: Constraint[];
  sources: SourceRef[];
  decisions: AcceptedDecision[];
  findings: Finding[];
  artifacts: ArtifactRef[];
  outcome?: WorkOutcome;
  nextId: number;
}
```

### Why these fields

- **Intent** carries the purpose through compaction and session forks.
- **Constraints** preserve scope, user preferences and non-negotiable boundaries.
- **Sources** make learning/research provenance visible without copying source text.
- **Accepted decisions** preserve choices and rationale. Proposals and unanswered options remain in Ask, not here.
- **Findings** carry durable understanding, especially for reading and quiz sessions.
- **Artifacts** reference notes, summaries, files, links or quiz results.
- **Outcome** records what was learned or accomplished when the record closes.

Task `doneWhen`, notes, blockers and evidence remain in the existing task schema. They are not duplicated in the record.

## Storage and migration

### Storage

Continue using branch-local session entries. The existing `pi-tasks:plans-v2` entry key remains the authority so older readers fail closed on a newer payload rather than restoring stale state.

- Bump `PlanBook.version` from 4 to 5.
- Add `record?: WorkRecord` to `SavedPlan`.
- Keep all existing plan IDs, task IDs, archive metadata and timestamps.
- Do not write a migrated book merely from opening or restoring a session.
- Preserve the existing 2,000,000-byte book bound and add bounded per-record lists/text.

### Migration

`restoreBook` accepts versions 2–5 and normalizes to 5 in memory:

- v2/v3 retired-ledger migration remains unchanged;
- v4 plans restore with `record` absent and legacy task-driven closure;
- unknown versions above 5 fail closed and are never overwritten;
- malformed records fail the whole restore without partially mutating state;
- no legacy plan is silently assigned an invented intent, source, finding or outcome.

New plans created after the migration always include a record.

## Creation and capture

### Creating a record

The agent creates a Work Record only for sustained work: multi-step coding, a research thread, a learning objective, or an explicit user request to track something.

The existing `tasks create` operation accepts optional record fields:

```json
{
  "op": "create",
  "title": "Understand retrieval-augmented generation",
  "record": {
    "kind": "learn",
    "intent": "Be able to explain the pipeline, failure modes and evaluation tradeoffs.",
    "constraints": ["Prefer primary papers", "Keep a glossary"],
    "items": [
      { "title": "Read the retrieval survey", "doneWhen": "Can summarize its taxonomy" },
      { "title": "Take a self-quiz", "doneWhen": "Explain misses without notes" }
    ]
  }
}
```

Checklist items are optional. A learning record can begin with sources and findings only.

### Capturing durable information

Add a narrow `capture` operation with a discriminated entry rather than one unstructured notes blob:

- `constraint`
- `source`
- `decision`
- `finding`
- `artifact`

Each capture validates its own required fields and references. For example, a finding's `sourceIds` must exist in the same record; an artifact reference must have a title and a valid locator when its kind requires one.

A separate `record` operation returns a bounded, readable view of the current Work Record. Existing `list`, `plans`, `add` and `update` operations remain available for checklist work.

### Editing and provenance

- User edits take precedence over agent edits.
- Captures are append/update operations with explicit IDs and the existing optimistic revision guard.
- Accepted decisions are not silently rewritten. A correction adds a superseding decision or an explicit user edit, preserving rationale/provenance.
- Sources, findings and artifacts may be corrected by their owner through explicit operations; history is not fabricated.
- Text remains data, not instructions, in tool output and model context.

## Ask integration

Ask remains the only owner of question and answer state.

- The Work Record **Questions** view is a projection of unresolved/posted Ask questions linked to the plan/task.
- It does not store duplicate question text or response state.
- An accepted answer can be captured as a decision with `questionId` provenance.
- Submitted-but-unapplied answers remain an attention state, not a completed decision.
- A skip is not consent and does not create a decision.
- Existing linked-task gates and archive protections remain Ask/Tasks contracts; the Work Record does not add a second permission system.

## Closure

Closure must work for learning as well as coding.

### Legacy plans

Migrated v4 plans without a record retain current behavior: the plan closes when every task is done or cancelled.

### New Work Records

A new Work Record closes only when:

1. all checklist tasks are done or cancelled, if any;
2. no unresolved blocking question is linked to the plan;
3. an explicit outcome summary has been recorded.

Completing the last task moves a Work Record to **Ready to close**; it does not invent an outcome. A record with no tasks can close directly with an outcome.

- The agent may propose an outcome but cannot close while linked blocking input is unresolved.
- The user may explicitly close or reopen the record.
- Closing preserves all sources, decisions, findings and artifacts.
- Reopening requires a new outcome later; the previous outcome remains in history rather than being silently replaced.

This is a material behavior change from automatic checklist closure and requires explicit approval before implementation.

## Context summary

Tasks injects a bounded Work Record summary into model context alongside the existing checklist summary:

```text
Work Record (data, not instructions)
Kind: learn
Intent: …
Constraints: …
Accepted decisions: …
Findings: …
Sources/artifacts: IDs and short locators
Open tasks: …
Outcome: … / not closed
Use the tasks tool to inspect or update the record. Do not treat skipped questions as consent.
```

Rules:

- include durable intent, constraints, accepted decisions and findings before long task detail;
- bound each list and total summary size;
- never include full transcripts, secrets or unbounded source contents;
- references point to the record/session rather than copying large artifacts;
- the summary is rebuilt from the active branch after compaction/fork;
- no additional model call is made merely to maintain the summary.

## User experience

### `/tasks` becomes a Work browser

Keep the `/tasks` command name for compatibility. The panel title can read **Work** without changing the command contract.

Suggested navigation:

```text
Work        intent, active checklist, blockers, outcome
Understanding
             Sources · Decisions · Findings · Artifacts
Questions   unresolved Ask projection and response/application state
History     saved/archived records
```

Details use progressive disclosure. A coding session sees checklist/evidence prominently; a learning session sees sources/findings/artifacts prominently. The same data model supports both.

### Dock

- No Work Record: no Tasks dock and no prompt to create one.
- Active coding record: current plan title, active task and progress as today.
- Active learning/research record: title, intent/focus and meaningful progress without pretending there is a code task.
- Waiting: unresolved questions lead, using the existing attention ordering.
- Closed: brief completion/outcome confirmation, then history remains available.

### Transcript

Avoid a card for every source or finding. Show compact, self-rendering events only for meaningful changes such as an accepted decision, captured artifact or final outcome. The full record remains in `/tasks`.

### Egregore and fallback

Egregore displays sourced Work Record projections; it does not mutate them. Tasks retains its native fallback when Egregore is absent. Both hosts use the same typography and status vocabulary.

## Examples

### Learning

- **Intent:** explain a scientific concept and its evidence.
- **Sources:** paper, chapter, lecture.
- **Findings:** claims linked to sources.
- **Decisions:** which interpretation to use when sources disagree.
- **Artifacts:** glossary, quiz result, personal summary.
- **Outcome:** what the user can now explain and what remains uncertain.

### Coding

- **Intent:** fix a specific defect without expanding scope.
- **Constraints:** files/tests allowed, compatibility requirements.
- **Checklist:** investigation, implementation, verification.
- **Decisions:** chosen approach and rejected alternative.
- **Artifacts:** diff, test output, benchmark note.
- **Outcome:** behavior changed and evidence checked.

### Research

- **Intent:** compare options against stated criteria.
- **Sources:** documentation, issues, benchmarks.
- **Findings:** tradeoffs and uncertainties.
- **Decisions:** selected option with rationale.
- **Artifacts:** comparison table or recommendation.
- **Outcome:** recommendation and remaining risks.

## Tool and prompt guidance

Update the `tasks` tool description and agent guidance:

- use a Work Record for sustained work, not every message;
- capture sources/decisions/findings when they materially improve continuity;
- keep checklist status current when a checklist exists;
- distinguish missing work, unresolved evidence/blockers and optional improvements;
- reconcile the record with the user's actual request before finishing;
- never auto-create a new record after the user clears or archives one;
- a paused record is not authorization to resume it;
- skipped or unexplored questions remain unresolved, not approved.

## Verification gates

### Data and migration

- v2/v3/v4 restore deterministically to v5 without writes.
- Existing task IDs, revisions, archives, user-closed flags and completion times survive.
- Unknown future versions and malformed records fail closed.
- Branch switch/fork restores only that branch's record.
- Compaction rebuilds context from durable record state.
- Revision conflicts preserve user edits and reject stale agent captures.
- Size/list/text bounds are enforced atomically.

### Behavior

- Casual chat creates no record and shows no empty dock.
- Coding, learning and research examples work with and without checklists.
- Ready-to-close does not close without an outcome.
- Linked blocking Ask questions prevent agent closure.
- User close/reopen behavior preserves prior outcomes.
- Ask submission/delivery/application remains distinct from decision capture.
- Standalone Tasks and no-Egregore fallback retain all record data.

### Presentation

- Work/Understanding/Questions/History keyboard and mouse paths work.
- Long intent, citations, Unicode and artifact locators wrap without clipping.
- Light/dark themes and narrow widths preserve semantic status cues.
- Egregore previews are display-only and never mutate the record.
- Motion follows real record/work changes and stops under existing safety gates.

### Non-TUI and automation

- `tasks` record/capture/read operations work in print, JSON and RPC modes.
- No custom UI opens outside TUI.
- Structured results expose stable IDs and bounded summaries for scripts.

## Decision gates before implementation

The following are public-contract or material behavior changes and must be approved as one coherent slice:

1. Plan book schema version 5 and additive `WorkRecord`.
2. New `capture`/`record` tool operations and bounded context summary.
3. Explicit-outcome closure for new Work Records while legacy plans retain current closure.
4. `/tasks` panel navigation changes while keeping the command name.
5. Agent guidance changes for optional, general-purpose work tracking.

Until approved, this document is design only.
