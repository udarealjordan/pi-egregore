# Calm Core redesign

**Status:** NativeHost and semantic clean copy (phases 1–2) are implemented in the isolated redesign worktree. Presets, dictation removal, the core/auxiliary split and Work Record remain proposed and separately authorized.

This is the implementation design for the next Egregore increment. It keeps Pi as the agent runtime and preserves the native editor, Vim instance, session tree, Ask semantics and Tasks ownership. The goal is a polished general-purpose agent environment for coding, reading and learning—not a programming-only workbench.

## Decisions carried into this design

- The default experience is **Calm**.
- Work-driven animation remains part of the product. There is no idle animation loop.
- Dictation is removed completely; it is not moved to an auxiliary package.
- Tasks evolves into an optional durable **Work Record**. Casual conversation does not create a plan automatically.
- The first implementation slice is the native compatibility owner plus semantic copy projections.
- The redesign worktree is `redesign/calm-core`, based on `origin/main` with the `remove-herdr` change reapplied.

## Documents

1. [Native compatibility and clean copy](NATIVE-COMPATIBILITY.md): one owner for host adapters, explicit capability/fallback reporting, and copy projections independent of frame glyphs.
2. [Calm experience and core/auxiliary split](EXPERIENCE.md): three coherent presets, a smaller front door, and clear core versus auxiliary boundaries.
3. [Complete dictation removal](DICTATION-REMOVAL.md): source, test, documentation and data boundaries for removing the feature completely.
4. [Tasks as a Work Record](WORK-RECORD.md): durable intent, sources, decisions, artifacts, questions and outcomes for coding or learning.
5. [Phased implementation and verification](IMPLEMENTATION-PLAN.md): ordered slices, migration boundaries and acceptance gates.

## Non-goals

- Replacing Pi's model/tool loop, session manager, permission model or native editor.
- Building a cloud service, multiplayer system or second sandbox.
- Making every conversation produce a task plan.
- Adding a public surface-registration API before internal adapters prove the contract.
- Promising clean terminal selection in regular mode, where the terminal owns the clipboard.
- Deleting historical changelog or acceptance evidence. New behavior is recorded as a new increment.

## Product shape

```text
Pi runtime
  ├── model/tool loop, sessions, native editor, host permissions
  └── public extension/TUI APIs

Egregore core
  ├── Composer and transcript presentation
  ├── Ask integration and /paths
  ├── Calm/Study/Expressive presets
  ├── clean fullscreen copy
  └── NativeHost lifecycle

Optional domain experience
  └── Tasks Work Record (checklist when useful)

Auxiliary experiences
  ├── advanced appearance
  ├── /btw asides
  ├── sounds
  └── opt-in recaps

Shared passive libraries
  ├── pi-embeddable-frame
  └── pi-agent-contracts
```

The important boundary is not visual. Domain state stays with Tasks and Ask; presentation stays with Egregore and Frame; Pi-native assumptions stay inside the compatibility owner.
