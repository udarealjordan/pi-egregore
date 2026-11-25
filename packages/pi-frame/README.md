# pi-embeddable-frame

An installable presentation package for **embedded** terminal frames. It does not register a tool or replace the editor. Use the passive primitives (`frameRows`, `frameRail`, `paintFramePerimeter`) or the opt-in state-driven layer (`presentationRows`, `createFrameController`). The package owns reusable styling, visual state rules and motion mechanics; integrations supply truthful content/state, host repaint access, focus/input facts and lifecycle boundaries.

For lookup, use [entry points](#entry-points-and-upgrades), [status presets](#optional-tool-status-preset), and [presentation](#state-driven-presentation). For setup, read [Install and develop](#install-and-develop). See **[FEATURE-GUIDE.md](FEATURE-GUIDE.md)** for development examples and how to describe a feature without knowing the API.

```ts
import { frameRows } from "pi-embeddable-frame/primitives";

const lines = frameRows({
  theme,
  width,
  rows: editor.render(width - 4),
  inset: 1,
  corners: { topLeft: " Question ", topRight: " 1 of 3 ", bottomLeft: " Esc back " },
  color: theme.colors.borderAccent,
  textColor: theme.colors.muted,
  // Animation is opt-in and should be driven by actual work, not an input prompt.
  motion: { active: running, now: Date.now(), accent: theme.colors.toolTitle },
});
```

All six rail positions (`topLeft`, `topCenter`, `topRight`, `bottomLeft`, `bottomCenter`, `bottomRight`) are optional. Center labels stay centered in terminal cells; side labels truncate before the center on narrow rails. For essential side labels, omit optional hints at small widths in the embedding extension. The frame's interior is the caller's content. Labels can already contain independent ANSI styling; `textColor` is a single fallback for unstyled labels. A `surface(text, width)` callback can preserve a host's background and text-color contract. Lines respect visible terminal cell widths and narrow frames fall back to unframed rows. `frameRail` builds one rail for editors that already own their content rows; `paintFramePerimeter` animates existing rails without touching input content. Motion travels the whole perimeter, side edges included, at one shared pace (`FRAME_SWEEP_SPEED` columns per second, a row counting as two), so frames of every size move alike; `periodMs` times only pulses. With `labels: true` (set by `presentationRows`) the light also passes through rail label text, which brightens from its own color and keeps its weight; body text never changes. Cells the light does not reach keep their bytes, so a tick rewrites only the rows it crosses. Truncated labels keep their ellipsis in the label's own style (`fitLabel`). Generated rails retain bounded drawing masks so labels containing border-shaped glyphs keep their foreground, weight and links. Unknown or ambiguous rails use only unambiguous physical edge cells; Frame does not guess horizontal ownership from glyph shape.

## Entry points and upgrades

Use **`pi-embeddable-frame/primitives`** for `frameRail`, `frameRows`, `paintFramePerimeter`, `statusPreset` and their types. Use **`pi-embeddable-frame/presentation`** for the state-driven layer. The root keeps all exports for compatibility, but integrations should import these dedicated entries rather than the root barrel.

A long-running Pi process can retain **both** an older JavaScript root namespace and an older package export map across `/reload`. The first can silently discard center labels; the second can reject a new entry with `Package subpath './primitives' is not defined by "exports"` and stop the integrating extension from loading. Dedicated entries alone do **not** solve both cases.

The local Egregore/Tasks integration uses `lib/frame.ts`; pi-ask has a self-contained `extensions/ask-user-question/frame.ts` bootstrap. They resolve the established root entry with `createRequire(import.meta.url).resolve("pi-embeddable-frame")` without evaluating its old namespace, then import the sibling `primitives.js` and, where needed, `presentation.js` by file URL. This uses the one package-owned implementation, not a copied renderer, and does not clear global caches or change user settings. The implementation files must be updated together with the integration. Public subpath imports remain the normal API for updated installations and for types; the bootstrap handles this local in-process migration.

Start a fresh Pi process after package/export or imported-module changes; `/reload` can refresh ordinary extension code but may retain cached dependencies. Regression coverage must include an old export table as well as old code, and real reload failure/recovery—not only fresh startup. This does not promise that Pi reloads every arbitrary future native dependency change.

## Building a new surface

Pick a placement first. It decides where the surface goes, whether it wants attention and how much height it may use, so it sits beside existing surfaces with the same spacing.

| Placement | Use it for | Where it goes | Weight |
| --- | --- | --- | --- |
| `input` | Something you answer, type into or step through: questions, `/btw`, `/paths` | Takes the composer's place; the composer and its draft return when it closes | Heavy |
| `panel` | Something you browse at length: plan history, settings | Full width over the transcript | Heavy |
| `dock` | Live status for current work: the Tasks dock | Just above the composer | Heavy |
| `transcript` | History: messages, tool rows and cards | In the scrollback | Light |

```ts
import { framePlacement, frameRows } from "pi-embeddable-frame";

const placement = framePlacement("input");
await ctx.ui.custom((tui, theme, _kb, done) => ({
  render: width => frameRows({ theme, width, weight: placement.weight, inset: 1,
    rows: content.slice(-placement.rows(tui.terminal.rows)), corners: { topLeft: " My surface " } }),
  handleInput: data => { /* your keys */ },
  invalidate() {},
}), placement.custom);
```

Every frame is drawn with thin rounded lines, whatever its weight. `weight: "heavy"` marks what wants attention now; show that with color and bold labels, not thicker lines. Unicode has no bold rounded corners, so bold edges always met thinner corners, and many terminals draw both weights alike. For one collapsed tool call or action, use `toolRows` so it joins the shared rail in the transcript.

Frame describes placement. Your extension still owns mounting, focus, input, state and redraws.

### Asking for text, a choice or a yes/no

Don't call Pi's built-in dialogs (`ctx.ui.input`, `ctx.ui.select`, `ctx.ui.confirm`, `ctx.ui.editor`). They draw without Frame, so they look nothing like the rest of Egregore. In the Egregore checkout, use `lib/dialogs.ts`:

```ts
import { askText, askChoice, askConfirm } from "../../lib/dialogs.ts";

const title = await askText(ctx, "Task title", task.title);          // starts filled in; undefined if cancelled
const status = await askChoice(ctx, "Task status", ["pending", "done"]);
if (await askConfirm(ctx, "Archive this plan?", "Unfinished tasks pause.")) { … }
```

Each prompt takes the composer's place (the `input` placement) with a rounded frame, the title in the corner and its keys in the footer, like adding a note to a question in `consult`. Pass `{ color }` to match your surface, for example gold for `/paths`. Outside the terminal UI they fall back to Pi's own prompts. A test fails if Egregore code calls the built-in dialogs directly.

## Design tips for a coherent terminal UI

Treat color as a small **visual grammar**, not a rule to paint every word alike:

- **Surface identity:** use the border color for a primary label, such as a chat name, question title, or message speaker.
- **Related metadata:** use a quieter, readable shade of that hue for a timestamp, model name, path, or question progress. Do not force every secondary label to the same intensity as the title.
- **Semantic state:** permit a distinct success, warning, or error color when it communicates something different from the border. A neutral tool border with a colored status symbol is intentional; a failed tool may warrant an error-colored border too. If the border represents thinking level, a completed-run label represents another state and need not match it.
- **Content:** keep draft text, Markdown, code, tool results, and question wording at readable theme text colors. A frame color is not a replacement for syntax or Markdown styling. Terminal applications normally share the terminal's font; bold, italic, spacing, and Markdown rendering can make the editor and transcript *look* different without setting different typefaces.

For example, style a centered title with the border color, style quieter corner metadata separately, and leave pre-rendered content alone:

```ts
const border = theme.colors.borderAccent;
const lines = frameRows({ theme, width, rows: messageRows, color: border,
  corners: {
    topCenter: theme.style(" Chat name ", { fg: border }),
    bottomRight: theme.fg("muted", " 19:42 "),
  },
});
```

These are suggestions, not automatic package policies. Choose the border's *meaning* for each surface before selecting colors; test light/dark contrast, ANSI labels, emoji/CJK widths, short panes, and disabled color. Motion should follow actual work and stop while the user reads or types.

## Optional tool-status preset

`statusPreset({ state, appearance, attention, markers, colors, labels })` returns a `{ marker, color, label }` presentation for `preparing`, `running`, `returned`, `failed`, `cancelled`, or `observed`. The default markers and light/dark colors match Egregore's tool cards; each can be overridden independently. For example:

```ts
const status = statusPreset({ state: toolState, appearance: theme.appearance });
const rows = frameRows({ theme, width, rows: resultRows, corners: { topLeft: ` ${status.marker} Search ` }, color: status.color });
```

This preset does **not** inspect Pi tool metadata, change execution state, or schedule a rerender. The caller determines its own state, passes the current value on render, and keeps ownership of tool lifecycle and content.

## State-driven presentation

The public entry is **`pi-embeddable-frame/presentation`**. The root still re-exports it for compatibility. Presentation imports its passive primitives directly, not through the root barrel. Egregore's Tasks adapter and settings demo use the reload bootstrap described above so an old cached package export map cannot reject this newer entry.

`framePresentationDefaults()` creates fresh version-1, serializable settings. `readFramePresentation(value)` validates colors, enums, positions and state rules, bounds period to 1.2–12 seconds and intensity to 0–1, and ignores unknown fields. Unsupported versions return fresh defaults; this parser does not authorize a persistence owner to overwrite an unknown saved version. Validate the stored version before saving.

- Independent border, highlight, title, metadata, body and active-row colors. Title is bold by default (`labelBold: true`); summary and hint rails remain bold. Active-row bold is independently configurable. This does not bold ordinary body rows.
- Theme colors or exact six-digit hex. The `highlight` token is soft white on dark themes and dark ink on light themes. Custom colors are not automatically contrast-corrected.
- Title, summary and optional hint in any of the six rail positions; same-position fields are combined. Tasks uses the bottom-right hint for additional open work rather than spending a body row.
- Shimmer or whole-border pulse, clockwise/counterclockwise direction, cycle duration and intensity.
- Optional gentle text-color pulse on labels, active rows, or both. Text is never moved, replaced or written back to source data.
- Default `work`, `changes`, or `off` motion. State overrides for `idle`, `working`, `waiting`, `done`, `blocked`, and `error` can choose `repeat`, `change`, or `off` plus independent colors. Global off and safety facts always win.

`createFrameController()` is external-clock by default and creates **no timer**. `update(facts, settings, now)` consumes semantic state, a revision token, and `suspended`, `reducedMotion`, `visible` facts. `sample(now)` advances the effect; `.active` reports whether frames are needed. The first revision establishes a baseline, not a replay. `reset()` clears history; `dispose()` is terminal and idempotent.

With `{ automatic: true, requestRender }`, it owns one timer, capped at 30 Hz. Timers stop on safety gates, completion of a one-shot, reset and disposal. Integrations with a scheduler—such as Egregore—use external-clock mode instead. No timer starts merely by importing the package or creating a controller.

`presentationRows({ theme, width, rows, title, summary, hint, presentation, frame })` uses the active state rule and renders optional semantic rows (`text`, `active`, `muted`, `warning`, `error`). Pass native input through the passive primitives instead until the integration has verified its cursor, IME, hit targets and selection contract. This release does not globally apply effects to editors or transcript tools.

## First integration: persistent Egregore Tasks

`/egregore` → **Tasks** offers live display-only state demonstrations, colors, motion, text emphasis/effects, rail positions, title and row count, plus per-state overrides. It shares the existing Save/Discard/Undo transaction and `pi-egregore.json` settings authority. `pi-footer.json` is a read-only legacy fallback until the first Save. No task, message or run clock is changed by the demo.

Egregore supplies sourced task counts and open-work rows through the dock bridge. The overview is independent of the legacy `/tasks` focus browser: active tasks come first, then blockers and pending work; completed work is counted rather than consuming rows. The independent no-Egregore Tasks fallback retains its existing appearance and browsing behavior. Historical tool acknowledgements are not animated by this integration.

Egregore's Tasks defaults give the summary and overflow hint the same accent color as its title; saved metadata-color customizations remain valid. Default motion is a quiet accent border with a near-white travelling highlight while an actual run and active task are present. Progress changes can sweep once. Waiting, typing, lost editor focus, blocking prompts, hidden/narrow frames, settings interactions and motion-off stop live motion. Explicit settings demos have their own disposable controller; reduced-motion settings still apply.

## Historical verification for the first Tasks integration

The figures below describe that earlier increment, not the current integrated suite. In the monorepo, see `docs/ACCEPTANCE.md` for the isolated Pi 1.0 terminal review and outstanding human checks.

- Frame + Egregore + Tasks suite: **217/217 passed**, `/tmp/pi-frame-final-tests.log`.
- Scoped strict TypeScript (new presentation/settings/egregore code, footer and Tasks integration): passed, `/tmp/pi-frame-scoped-tsc.log`.
- Full Egregore strict check still reports four diagnostics in the untouched `sent-messages.ts` native metadata accesses, `/tmp/pi-frame-tsc.log`. That historical increment did not fix them; the later guarded compatibility adapter supersedes this limit. See the suite acceptance record for current checks.
- Package dry-run includes runtime, declarations and both guides: `/tmp/pi-frame-pack.log`.
- Text/ANSI captures cover 24/40/90/140 columns, light/dark and working/waiting/blocked/done: `/tmp/pi-task-presentation-captures.{txt,ansi}`. Text captures were inspected; controller tests verify changing colors without changing geometry/content, finite sweeps, safety gates and timer cleanup.
- No automatic reload or live terminal/font animation verification was performed. For the current suite, start fresh and use `/egregore` → Tasks for the explicit preview.

## Install and develop

This README covers the suite source checkout and Frame's standalone library. Links outside this package point to source-checkout guides; a separately extracted Frame tarball does not include the suite's contributor or Egregore documentation.

```bash
# From the suite repository root, only for a standalone Frame registration:
pi install "$PWD/packages/pi-frame"
```

The package contains no auto-loaded extension (`pi.extensions` is empty). Install it as a dependency of an integrating package, or make it resolvable to a local extension; merely installing it does **not** change any Pi surfaces. It uses Pi's host-provided `@earendil-works/pi-tui` as a peer. Registering a resource-free package is not the same as making it resolvable to another extension. An integrating package must declare a compatible Frame runtime dependency or provide its documented local dependency arrangement. The suite already resolves Frame through its npm workspace and bundles it for packed installs; do not add a second package entry. For future distribution, include the dependency in the integration's package rather than relying on an undeclared personal symlink. Publication is a separate authorized operation, not an installation prerequisite for this checkout.

CLI path input is resolved from the invoking directory; relative paths stored in Pi settings resolve from the settings file. Tests run from the suite root with a compatible installed host:

```sh
npm ci
npm run test:frame
npm run pack:check --workspace=pi-embeddable-frame
```

See [contributor setup](../../CONTRIBUTING.md#test-environment) for `PI_FRAME_HOST_MODULES` and legacy Egregore/Ask host overrides. The optional live Tasks integration is covered by the suite's Egregore/Tasks tests, not by registering this passive library alone.

No part of this package records messages or changes tool execution. Passive primitives never schedule rendering. The optional controller can request host redraws through its supplied callback; integrations provide lifecycle/safety facts and dispose it. State-to-appearance decisions live in the package's configurable rules, not duplicated in each extension.
