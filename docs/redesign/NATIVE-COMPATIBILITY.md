# Native compatibility and clean copy

**Status:** Implemented for the first redesign slice. NativeHost, capability reporting, the shared copy contract and supported Composer/chat/tool/Ask/Tasks projections exist; later upstream API requests remain proposals.

## Problem statement

Before this slice, Egregore decorated Pi-native editors, messages and tool components through guarded instance patches distributed across `runtime.ts`, `composer-editor.ts`, `sent-messages.ts`, `activity-blocks.ts`, `web-tool-frames.ts`, `paint-guard.ts`, `copy-flash.ts` and `native-message-adapter.ts`.

Copy had a second, independent problem. The former fullscreen adapter recorded rendered frame geometry, asked Pi for native selected text, reconstructed a cleaned version from painted rows, and used it only when the whole reconstruction matched Pi's extraction. That produced the right safety instinct—never rewrite uncertain content—but an all-or-nothing result:

- one stale row, ANSI difference or extraction mismatch can restore scaffolding for the whole selection;
- Ask, docks and other custom surfaces do not register copy geometry;
- regular terminal selection cannot be intercepted at all;
- the renderer's frame glyphs, rather than semantic content, define what is removed.

The implemented slice separates two responsibilities:

1. **NativeHost** owns every Pi-specific assumption, adapter lifecycle and fallback decision.
2. **Copy projections** describe copyable semantic content independently of frame drawing.

## Ownership

| Responsibility | Authoritative owner |
| --- | --- |
| Pi model/tool loop, sessions, native selection and clipboard | Pi |
| Editor, message, tool, paint and flash adaptation to Pi internals | Egregore `native/` compatibility owner |
| Composer/chat/tool appearance and animation | Existing Egregore presentation modules |
| Question content and answer input | Ask |
| Frame glyphs, rails and passive drawing helpers | `pi-embeddable-frame` |
| Versioned copy-projection data shape and validation | `pi-agent-contracts/copy` |
| Deciding which semantic rows a surface exposes | The surface owner |
| Native fallback when a capability is unavailable | NativeHost adapter for that capability |

Frame remains passive. It must not become a global renderer, selection manager or state store.

## NativeHost

### Private module boundary

`extensions/pi-egregore/native/` owns receiver, layout and selection compatibility plus native adapter installation/teardown. Existing guarded message/tool fact readers remain in their renderer modules; new host-shape assumptions belong behind this boundary.

```text
native/
  host.ts              mount order, capability report, disposal
  capabilities.ts      supported/limited/native classification
  shapes.ts            guarded Pi layout/component shape readers
  selection.ts         Pi selection adapter and row/cell-local fallback
  copy-projection.ts   shared projection façade for Egregore surfaces

Existing editor/message/tool/paint/flash renderer modules remain where they are;
NativeHost owns their installation and teardown.
```

The first implementation does not move every existing fact reader. It makes NativeHost the only caller that installs and disposes native patches. Rendering modules remain where they are while NativeHost owns their mounting.

### Adapter contract

Each adapter declares a narrow capability and returns an idempotent cleanup. An unavailable adapter returns a reason; it does not throw into session startup.

```ts
type NativeCapability =
  | "editor-decoration"
  | "message-decoration"
  | "tool-decoration"
  | "selection-cleaning"
  | "paint-synchronization"
  | "copy-flash-decoration";

interface NativeAdapter {
  capability: NativeCapability;
  install(context: NativeAdapterContext): (() => void) | undefined;
}

interface NativeCapabilityReport {
  capability: NativeCapability;
  status: "full" | "limited" | "native";
  reason?: string;
}
```

`NativeAdapterContext` supplies only what the adapter needs: current TUI/context, theme access, render requests, state readers and projection registration. It does not expose Tasks or Ask mutation.

### Mount and teardown order

1. Resolve the actual TUI receiver through the existing forwarding-proxy-safe technique.
2. Classify capabilities from the installed host shape.
3. Install selection cleaning before the first frame that can register projections.
4. Install paint synchronization so native transcript traversal happens inside the same render transaction.
5. Install copy-flash decoration.
6. Adopt the current native/Vim editor when one is present.
7. Start message/tool synchronization.
8. Publish the capability report to `/egregore` → General → Native integration.

Teardown is reverse order and **inert-first**:

1. Mark the mount generation inactive so queued paints cannot touch a new session.
2. Stop timers and synchronization.
3. Detach editor, message and tool wrappers.
4. Restore selection, paint and flash methods only if this adapter still owns them.
5. Release projection metadata.
6. Invalidate the context reference.

No adapter may clear global module caches, rewrite Pi settings, mutate prototypes, or replace another extension's editor instance.

### Capability reporting

The user-facing report is small and factual:

- **Full:** Egregore can decorate and clean copy for supported surfaces.
- **Limited:** Some native shapes are unavailable; affected surfaces retain Pi rendering/copy.
- **Native:** This host does not expose the required capability.

General settings may list reasons such as “selection API unavailable,” “unknown message shape,” or “custom tool renderer.” This is diagnostic display only: no telemetry, network request or automatic host mutation.

## Semantic copy projections

### Contract location

The data-only `pi-agent-contracts/copy` entry provides the projection contract. It contains types, validators and pure cell/text helpers. It has no component registry, timers, clipboard access or dependency on Egregore runtime state.

Ask and Egregore both already depend on `pi-agent-contracts`, so the contract can be shared without making Ask depend on Egregore.

### Projection shape

A projection describes the latest rendered frame of one component. Coordinates are terminal-cell columns, not JavaScript string offsets.

```ts
type CopySegmentKind = "content" | "metadata" | "decoration" | "padding";

interface CopySegment {
  /** Inclusive terminal-cell column. */
  start: number;
  /** Exclusive terminal-cell column. */
  end: number;
  /** Plain visible text corresponding to [start, end). No ANSI/OSC. */
  text: string;
  kind: CopySegmentKind;
}

interface CopyRow {
  /** Row within this component's rendered output. */
  row: number;
  segments: CopySegment[];
}

interface CopyProjection {
  version: 1;
  surfaceId: string;       // stable, namespaced, e.g. "pi-egregore:composer"
  width: number;
  height: number;
  rows: CopyRow[];
  /** Render-generation token used to reject stale layout/projection pairs. */
  revision: string | number;
}
```

The contract must validate:

- positive width/height and exact row coverage;
- ordered, non-overlapping segments inside the row width;
- plain text without terminal controls;
- segment text whose terminal-cell width matches `end - start`, or an explicit documented wide-character mapping;
- known version and bounded row/segment counts.

A projection is ephemeral render metadata. It is never written to preferences, session entries or transcripts.

### Registration without a global registry

A surface attaches its latest projection to its own component instance using a shared optional convention:

```ts
type CopyAwareComponent = Component & {
  piCopyProjection?: CopyProjection;
};
```

NativeHost's selection adapter reads this property while traversing Pi's recorded layout. This avoids a second global component registry and keeps ownership with the component. Native wrappers set and delete the property; Ask sets it on its own component; Tasks can set it on its dock component.

The property is an internal suite convention, not a new Pi public API. If Pi later exposes an official copy hook, NativeHost can migrate to it without changing surface semantics.

### How surfaces construct projections

The surface owner supplies semantic content and geometry before frame decoration.

- **Composer:** native editor content rows are content; top/bottom rails, side edges, Egregore padding and native horizontal inset are decoration/padding. Completion rows below the bottom rail remain outside the Composer projection and retain native behavior.
- **Chat:** message body rows are content; frame rails, side borders, identity/time rails and Egregore edge spacing are not content.
- **Collapsed tool row:** the left rail is decoration; marker, name, target, detail and child rows are content unless the tool owner explicitly classifies otherwise.
- **Expanded/web tool:** body and output are content; outer frame and status rail are decoration.
- **Ask:** question text, options, notes and written answers are content; key hints, frame rails and shell chrome are decoration.
- **Tasks dock/panel:** task text and meaningful status labels are content; border, padding and purely visual hints are decoration.
- **Unknown/self-rendering/graphical tool:** no projection unless its owner explicitly supplies one.

Literal `│`, `╭`, pipes, code indentation and blank lines inside content remain content because they came from the semantic row—not because a glyph filter recognized them.

### Selection algorithm

For each selected screen row:

1. Resolve the owning component and its latest projection from Pi's recorded layout.
2. Validate width, height, revision and the rendered-row provenance.
3. Intersect Pi's selected cell range with each content/metadata segment.
4. Slice the segment's plain text by terminal-cell width.
5. Omit decoration/padding-only intersections.
6. If the row has no valid projection, use Pi's native extraction **for that row only**.
7. Join retained rows using Pi's screen-row selection behavior in the first slice.

Important properties:

- A stale or unknown row does not disable cleaning for every other row.
- A selection containing only decoration returns no text.
- A mixed selection can contain cleaned Egregore rows and native third-party rows.
- Copy never rerenders, mutates the draft, executes a tool or changes selection/cursor state.
- The first slice preserves screen-row newlines. Source-aware Markdown/newline reconstruction can be evaluated later without coupling it to scaffold removal.

### Copy policy

- `content`: copied when selected.
- `metadata`: copied when explicitly selected; whole-surface copy may omit it according to the surface's declared policy.
- `decoration`: never copied.
- `padding`: never copied.

The initial policy excludes frame rails and shell hints. It does not attempt to infer whether text is “important” from its glyph or color.

### Fullscreen versus regular mode

| Mode | Behavior |
| --- | --- |
| Fullscreen with Pi selection API | NativeHost maps selection through projections; supported surfaces copy without scaffolding |
| Fullscreen with partial/unknown surfaces | Valid projected rows are cleaned; unknown rows remain native |
| Fullscreen with stale projection | Only stale rows fall back to native extraction |
| Regular terminal | Terminal owns selection and clipboard; Egregore cannot guarantee scaffold-free copy |
| Non-TUI | No custom selection behavior; domain tools continue to work |

Regular-mode copy is a documented platform boundary, not an unresolved adapter bug. If clean regular-mode copy becomes a requirement, the viable options are an explicit Pi/host copy API or a user-invoked semantic copy action—not intercepting the terminal's clipboard.

## Frame integration

Frame remains responsible for drawing. Add passive projection helpers only where they eliminate duplicated geometry:

- `frameRows` callers can request a projection alongside rendered rows, or call a helper with the same content/inset/corner geometry.
- `toolRows` can expose its content-column span.
- `frameRail` remains decoration unless a surface explicitly classifies a label as metadata.

Do not change `frameRows` to return a different type in the first slice. That would force every integration and cached-export path to migrate at once. Prefer an additive helper or a local NativeHost projection builder, then extract only after representative surfaces pass.

## Adapter-specific boundaries

### Editor

- Preserve the existing native/Vim instance, draft, undo, completion, selection, cursor and IME markers.
- Wrap only public instance methods.
- Unknown editor border shapes fall back to native rendering and clear copy provenance.
- A later-installed editor is adopted in place; it is never replaced by a competing factory.

### Messages

- Keep all private-field reads in `shapes.ts`/message fact adapter.
- Revalidate streaming and content shapes on every read.
- Unsupported future content, graphics or throwing accessors stay native.
- Projection content comes from the same body rows used for rendering, so display and copy cannot drift silently.

### Tools

- Prefer Pi's public `registerToolRenderer` for suite-owned tools.
- Native `ToolExecutionComponent` wrapping remains isolated for built-in text tools that lack a public decoration hook.
- Self-rendering tools, unknown custom renderers and graphical output remain native.
- Projection never intercepts execution, changes expansion state or rewrites results.

### Paint and flash

- Paint synchronization remains an instance-scoped transaction around native rendering.
- Copy-success decoration remains Pi-owned state with Egregore-only visual wrapping.
- Neither capability gains clipboard ownership or a second timer.

## Upstream Pi API requests

The compatibility owner should shrink over time. Proposed upstream capabilities, in priority order:

1. **Component copy projection or `getCopyText(selection)` hook** with cell-accurate coordinates.
2. **Read-only selection/layout snapshot** for mapping screen selections to components.
3. **Message decoration API** that exposes body rows and semantic facts without private fields.
4. **Editor chrome API** that preserves the native editor instance and input contract.
5. **Tool renderer composition metadata** for call/result provenance without private component shapes.
6. **Pre/post-paint lifecycle hook** for extensions that need to synchronize adapters before traversal.

Until these exist, NativeHost makes the private boundary explicit and testable rather than pretending it is public.

## Verification gates

### Automated

- Projection validator: malformed versions, overlapping/out-of-bounds segments, ANSI/OSC text, cell-width mismatches and oversized projections.
- Real `TuiAltScreen` selection through Pi's native clipboard path.
- Composer native, Vim and fallback editors.
- User and assistant messages, collapsed/expanded tools, web cards, Ask forms and Tasks dock/panel.
- Partial, reverse, word-style and multi-row selections.
- Mixed projected/native components and decoration-only selections.
- Literal pipes, box-drawing text, blank lines, indentation, CJK, emoji, combining characters and ANSI links.
- Streaming updates, resize, scroll, stale projections and overlaid rows.
- Row-local fallback: one invalid row does not restore scaffolding elsewhere.
- Regular mode retains native terminal selection.
- Cleanup/reload: no stacked wrappers, retained projections or cursor/draft changes.

### Host matrix

Run the same tests against the declared minimum Pi version and the current installed host. Compatibility means the suite either decorates correctly or deliberately retains native behavior; it does not mean every host exposes every capability.

### Physical/manual

Automated selection injection does not prove real drag selection, terminal clipboard integration, IME behavior, font rendering or motion perception. These remain manual acceptance items.

## Migration sequence

1. Add the data-only copy contract and projection helpers.
2. Create NativeHost and move install/teardown ownership without changing rendering.
3. Convert Composer, chat and tool registrations from frame geometry to projections.
4. Replace all-or-nothing selection cleaning with row-local projection mapping.
5. Add Ask and Tasks projections.
6. Add capability reporting and host-matrix tests.
7. Remove obsolete geometry-only copy code once no surface uses it.

Each step must preserve native fallback and pass the full suite before the next begins.
