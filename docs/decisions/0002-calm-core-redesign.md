# 0002: Calm Core redesign direction

**Status:** Accepted as design direction. NativeHost and semantic clean copy are implemented as the first authorized slice; later phases require separate authorization.

## Context

Egregore has grown from terminal presentation into a suite that also owns planning, questions, transcript adapters, appearance editing and auxiliary experiences. The user primarily uses Pi as a general-purpose agent for coding, reading, learning and conversation. They value the animation and polish, but want a calmer default, less incidental complexity, reliable clean copy, and a durable way to carry understanding forward without forcing every chat into a programming plan.

The native renderer compatibility layer is distributed across several adapters, and fullscreen copy currently reconstructs text from painted frame rows with whole-selection fallback. Regular terminal selection cannot be cleaned by an extension.

## Decision

- Keep Pi as the runtime and preserve the native editor, Vim instance, session tree, Ask semantics and Tasks state ownership.
- Make **Calm** the fresh-install default, with **Study** and **Expressive** as coherent presets.
- Retain work-driven animation; do not add idle motion.
- Centralize Pi-native assumptions behind a private NativeHost compatibility owner.
- Introduce semantic copy projections so supported fullscreen surfaces copy content without scaffolding and fall back row-by-row when provenance is uncertain.
- Document regular terminal selection as terminal-owned and outside the clean-copy guarantee.
- Remove dictation completely rather than moving it to an auxiliary package.
- Split core and auxiliary responsibilities at code level before considering new packages.
- Evolve Tasks into an optional branch-local Work Record for coding, learning and research. Casual conversation does not automatically create a plan.
- Implement in an isolated `redesign/calm-core` worktree based on `origin/main` with the `remove-herdr` change reapplied.

## Consequences

The next implementation begins with NativeHost and semantic clean copy because that fixes a concrete defect and establishes the boundary later surfaces need. Presets, dictation removal, the core/auxiliary split and Work Record follow as separate reviewed slices.

Presets remain patches over `pi-egregore.json`; they do not create a second settings authority or claim an atomic transaction across companion files. Work Record schema/tool/closure changes require separate approval because they alter public contracts and data semantics. Historical changelog and acceptance evidence remain intact.

See the [Calm Core redesign](../redesign/README.md) for the detailed design and phased plan.
