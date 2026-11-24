# Calm experience and core/auxiliary split

**Status:** Proposed design. No preset, settings schema or runtime behavior is changed by this document.

## Product intent

Egregore is a general-purpose Pi environment for coding, reading, learning and conversation. The interface should make the agent feel polished and alive without making every session feel like a project-management cockpit.

Three principles guide the experience:

1. **Calm by default.** Useful context is visible; optional metadata stays quiet.
2. **Motion follows meaning.** Animation responds to real work or deliberate interaction. It never runs merely to decorate an idle prompt.
3. **One authority per setting.** Presets select values in the existing settings authority; they do not become a second hidden configuration system.

## Three coherent presets

A preset is a named, reviewable starting point. Selecting one stages a concrete patch to the existing `pi-egregore.json` fields in the current Save/Undo/Discard transaction. It does not directly rewrite `pi-composer.json`, `pi-tasks.json` or `pi-recaps.json`.

| Preset | Intended use | Composer and transcript | Motion and detail |
| --- | --- | --- | --- |
| **Calm** *(default)* | General-purpose chat, coding and learning | Quiet frame, spaced content, session/status/send metadata, simple Git state, context hidden by default | Existing work-driven ember; Tasks change highlight; brief selection shimmer; no idle motion |
| **Study** | Reading, long explanations, quizzes and research sessions | Compact density, fewer rails, plain icons, Git/context/timing hidden, transcript timestamps optional | Selection shimmer off; Tasks border motion off; Composer remains work-driven but visually restrained |
| **Expressive** | Sessions where richer feedback and visual presence are welcome | Spaced content, fuller metadata, stronger frame/label emphasis using existing controls | Work-driven Composer and Tasks motion, selection shimmer, optional existing footer effects; still no idle loop |

### Exact preset scope

The first preset implementation covers fields already owned by `pi-egregore.json`:

- footer style, color, shape, icons and density;
- Input element visibility, placement, priority and text weight;
- Git/context/timing display fields;
- selection shimmer;
- Tasks presentation and motion;
- Ask shell presentation;
- Transcript density, Sent-time display and tool-label treatment;
- existing footer effects where they are already supported.

The following remain **companion operational controls**, outside the preset transaction:

- Composer on/off, runtime palette lease, Composer work motion and header icons in `pi-composer.json`;
- Tasks on/off, dock visibility and standalone fallback in `pi-tasks.json`;
- recap opt-in in `pi-recaps.json`.

The preset screen must say this plainly. It must not imply that one Save atomically updates multiple files.

### Preset provenance and customization

Add a versioned top-level preset record to `pi-egregore.json`:

```ts
type ExperiencePreset = "calm" | "study" | "expressive";

interface PresetState {
  version: 1;
  selected: ExperiencePreset;
  customized: boolean;
}
```

Rules:

- Fresh installs select `calm`.
- Selecting a preset materializes its values into the normal visual fields and stages them as edits.
- `selected` records provenance; the materialized fields remain authoritative.
- Changing a controlled field sets `customized: true` and displays **Custom · based on Calm** (or the selected base).
- **Reset to preset** is an explicit action that stages the preset values again.
- Existing settings without a preset record are preserved byte-for-byte in meaning and shown as **Custom** until the user explicitly chooses a preset. A missing preset field must not silently overwrite an existing customized installation.
- Unknown future preset/settings versions block Save rather than being downgraded.

### Preset preview

The existing connected-preview shell is reused:

- preset cards show a concise summary, not another settings room;
- selecting a preset previews the real native Composer plus labeled synthetic Ask/Tasks/Transcript samples;
- a diff summary lists changed groups before Save;
- Save/Discard/Undo retain their current transaction semantics;
- previews never alter the draft, run state, plans, answers or timestamps.

## Front door

`/egregore` remains the single appearance front door.

```text
Experience
  Calm | Study | Expressive | Custom

Input & footer
Work
Ask
Transcript
More settings
General
```

Changes from the current six-room structure:

- **Experience** is a compact preset strip at the top, not a seventh dense room.
- **Tasks** is renamed **Work** when the Work Record ships; before that, the label remains Tasks.
- Common controls stay visible. Fine-grained controls remain available under **Advanced**.
- General includes **Native integration** capability status from NativeHost.
- Narrow terminals retain **Rooms…** and complete keyboard navigation.

The first preset slice does not delete existing controls. It reduces the default decision burden while preserving compatibility for users who want the current level of customization.

## Core

Core is the always-available general-purpose experience:

- Composer/native-editor decoration and work-driven status animation;
- user/assistant transcript presentation and supported tool cards;
- clean fullscreen copy through NativeHost projections;
- Ask integration, including blocking and posted questions;
- `/paths` session navigation;
- preset selection and common appearance controls;
- native capability reporting;
- session/UI lifecycle and reversible teardown;
- Frame and shared contracts.

Tasks is an optional **domain experience**, but it belongs to the installed suite because it supplies the Work Record. “Optional” means it does not create plans or show an empty dock unless used—not that the core silently owns its state.

## Auxiliary experiences

Auxiliary modules add value but are not required for ordinary conversation:

| Module | Default | Reason |
| --- | --- | --- |
| Advanced appearance | Available, collapsed | Preserves deep customization without crowding the front door |
| `/btw` asides | Off until invoked | Useful for side questions; not required for the main conversation |
| Notification sounds | Off in the redesigned default; explicit `/sounds on` | Audio is preference-sensitive and should be deliberate |
| Activity recaps | Off, unchanged | Makes additional model/subscription calls and requires explicit consent |

Auxiliary code may register a command or surface only through its owner. It may not patch Pi directly; native adaptation goes through NativeHost. It may not mutate Tasks, Ask or transcript state as a side effect of presentation.

### Code organization before package split

Start with a code-level boundary, not new npm packages:

```text
extensions/pi-egregore/
  core/          Composer, transcript, paths, presets, lifecycle
  native/        Pi compatibility owner
  features/
    appearance/  advanced settings and previews
    aside/       /btw
    sounds/      notification playback
    recaps/      opt-in recap controls
  shared/        pure helpers used by core and features
```

Extract a separate package only if a feature has an independent install/use case, stable public contract and standalone tests. The initial split is about ownership and startup cost, not speculative packaging.

## Dictation

Dictation is removed completely. It is not an auxiliary module. See [DICTATION-REMOVAL.md](DICTATION-REMOVAL.md).

## Animation and polish

Animation remains a first-class part of Egregore:

- the Composer ember follows real thinking, writing, tool and compaction states;
- Tasks motion follows real work or meaningful changes;
- selection feedback is brief and interaction-owned;
- Expressive may use existing richer effects;
- Study reduces decorative motion but does not make the agent feel inert during real work;
- blocking questions, settings focus, hidden surfaces, motion-off and teardown stop animation;
- there is no idle animation loop and no animation that moves text or changes geometry.

Polished means coordinated state, spacing, color, timing and fallback—not more independent effects.

## Settings and migration boundaries

### Current authorities retained

- `pi-egregore.json`: preset provenance and all suite visual settings.
- `pi-composer.json`: Composer operational preferences.
- `pi-tasks.json`: Tasks enablement, visibility and standalone fallback.
- `pi-recaps.json`: recap opt-in.
- Session entries: branch-sensitive Work Record, questions and run facts.

### Migration rules

- Add preset support additively to the versioned visual settings.
- Preserve legacy read fallbacks and unknown-version fail-closed behavior.
- Do not rewrite legacy files merely because a preset record is absent.
- Applying a preset is an explicit edit; Save remains atomic for `pi-egregore.json` only.
- Companion controls continue to save separately and immediately.
- Removing dictation requires no preference migration because it never owned a preference file.

## General-purpose behavior

The Work Record must not turn casual chat into forced planning:

- a normal question, explanation or quiz does not create a plan;
- the agent may offer a Work Record for sustained learning or multi-step work;
- the user can decline without losing the conversation;
- Ask remains available when a real decision is needed;
- `/paths` and transcript history remain useful without Tasks;
- the Composer and animation work the same way in coding and non-coding sessions.

## Verification gates

- Fresh install resolves to Calm; existing customized settings remain unchanged until explicit preset selection.
- Preset selection produces the exact documented field patch and nothing in companion files.
- Custom edits set provenance correctly; Reset to preset is reversible before Save.
- Save/Discard/Undo/failed Save preserve native draft, plans, answers and transcript.
- Calm/Study/Expressive render at narrow/wide widths, light/dark themes, plain/Nerd icons and reduced-motion settings.
- Motion starts only for documented real work/interaction and stops on all safety gates.
- Core works without auxiliary modules; standalone Ask and Tasks remain functional.
- Unknown future preset/settings versions are preserved and block Save.
- No new public adapter API is claimed before the internal preset/preview contract is proven.
