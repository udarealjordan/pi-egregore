# Tool rows and cards

Available in Composer after a fresh Pi process. Rendering uses no classifier, network call, external formatter or tool execution. Each native tool keeps its transcript position.

## Collapsed: one row per call

A collapsed call is a single row on a left rail: status marker, tool name, target, and a quiet detail at the right edge. Adjacent calls share the rail and read as one block, with a blank line before and after the run. Assistant turns that show no text don't break a run.

```
┃ ✓ Read     extensions/pi-tasks/typography.ts          22 lines
┃ ✓ Edit     composer-style.ts                            +3 −1
┃ × Bash     npm test                                    exit 1
┃   1 failing test: preview-selection
┃ ◉ Bash     npm run build                              running
┃   compiling 14 of 20 modules
```

| Tool/content | Detail at the right | Note lines beneath |
| --- | --- | --- |
| Read | Returned line count | |
| Write | Input line count | |
| Edit | Added/removed counts from the supplied diff | |
| Bash / PowerShell | Line count, or `exit N` when nonzero | First error line on failure; latest output line while running |
| Grep / Find / List | Line count | Limit and truncation notices |
| Codemode | Call count and wall time | Up to three child calls (problems and live work first), then `+N more` |
| JSON / JSONL | `JSON · 4 fields` or record count | First diagnostic field the data reports |
| Web search / fetch | Result count when known | First error line |
| Tasks, Ask | The change itself (`Done`, `Started`, `Asked`…) and plan progress | Blocker reason, or your answer |

Success shows only the marker; `failed`, `cancelled` and `running` are written. The rail stays quiet unless a call is running, failed or needs attention.

## Readable expansion

Click a collapsed row to expand it into a framed card. Click the card heading to collapse. Pi's tool-expansion shortcut (normally Ctrl+O) still controls native expansion.

- Scripts, shell commands, and written source render as actual lines, not JSON-escaped strings.
- Single JSON objects/arrays and complete JSONL records get a readable nested view. Strings are decoded **once**. Literal backslash-n text stays literal; actual newline characters become lines.
- A bounded parser preserves numeric source lexemes and duplicate keys. It does not round large IDs, assign input keys onto objects, or evaluate anything.
- Codemode drops **only** its exact first separate native `Script completed/failed / Wall time / Output` block from readable output. Duration is retained. A matching-looking prefix embedded in a script's own text stays visible.
- Codemode shows **Script · submitted** before **Recorded calls** and results. Submitted source is not proof that every line ran. Compact action rows use recorded calls only, prioritizing failed, cancelled and running calls before routine calls; the selected subset keeps execution order. Each action is one terminal row, shortened with `…` when necessary. Expand to inspect full targets and commands. Missing call metadata never causes source parsing or invented actions.
- Child calls retain their separate state, available error text, duration and reported cost. Successful child text is neutral, with a colored status symbol; entire rows no longer glow green.
- Other tool inputs follow results. Targets already shown in the header and requested edits already represented by a supplied diff are not duplicated; raw arguments remain available.
- Expanded body clicks, modified clicks, drags and wheel events remain available for selection and scrolling, except the small explicit raw/readable link.

## Raw access

Expanded cards end with **› Raw payload**. Click that label for sanitized original output, raw arguments and result details. **‹ Readable view** returns to the formatted view.

Keyboard users can set the session-wide expanded view:

- `/composer output raw`
- `/composer output readable`

Then use the configured expansion shortcut. This changes only the current session's presentation; it is not saved as a preference and does not alter tool results. Collapsed cards remain compact in either mode. The original stored payload is never changed. Terminal-control sanitization still applies to displayed raw text.

## Problems and limits remain visible

“Returned” means a final result without the tool error flag, not that the user's task or tests succeeded. “Cancelled” requires explicit cancellation metadata. A caught child error makes a returned Codemode card amber and retains a failure count.

Status colors also have symbols: gray `·` preparing, blue `◉` running, green `✓` returned, red `×` failed, amber `■` cancelled, amber `!` child issues. Compact Egregore headers omit the routine “returned” word; exceptional states remain labeled. Expanded card headers may spell out “returned”. Normal card borders are neutral; failures and child issues keep a stronger outline. Light/dark themes use separate palettes.

Nonzero exit codes, tool truncation, full-output paths, changed resolved paths, long-line truncation, match/result/entry limits and omitted child summaries are surfaced outside the ordinary two-row allowance. Exit zero stays quiet in compact mode and is visible when expanded.

Structured compact diagnostics recognize nonempty keys named `error`, `errors`, `warning`, or `warnings`, at any depth. They count all such fields and show one excerpt. This is a labeled field summary, **not** a new tool-status verdict or a universal error detector. Plain-log promotion recognizes explicit diagnostic prefixes; it does not semantically classify arbitrary prose.

## Bounded and native fallbacks

Structured parsing is limited to 262,144 JavaScript characters, 20,000 values, depth 48, and 256 JSONL records. The readable tree caps at 2,000 visual rows and explicitly offers raw access for the rest. Invalid, partial, scalar, mixed-log, overly deep or oversized structured content stays plain text. Syntax highlighting is skipped for oversized source, without dropping the text.

Questions, Tasks, images/non-text results, embedded terminal graphics, hidden components, widths below 24 columns, custom self-rendering tools, and unknown tools with custom renderers retain native rendering. Known file/search-tool renderer identities distinguish built-ins from custom overrides. Native Edit's self-shell is deliberately recognized. Shell renderer factories produce per-instance closures, so stable function-identity matching is not available for those; custom self-rendering shell interfaces stay native.

The Pi 1.0 `ToolExecutionComponent` metadata boundary is guarded but is not a supported cross-version metadata API. The adapter never re-registers tools, mutates results, patches global prototypes, or moves transcript children. It restores instance methods on disposal and does not overwrite later decorators.

Persisted Codemode `details.calls` summaries take precedence over live events. Event-only fallback retains at most 64 children per parent and 1,024 parent records; omissions are explicit. It never invents child result bodies or parses scripts to infer actions.

## Historical verification for the readable-output increment

These records describe that earlier increment, not current suite status. See [current acceptance](../../docs/ACCEPTANCE.md) for superseding results and remaining human checks.

- Actual native Read, Write, Edit, Bash, PowerShell, Grep, Find and List definitions, plus the native Codemode renderer, are exercised in `tests/tool-cards.test.mjs`.
- Tests cover compact height, 24/40/90/140-column widths, streaming, errors, cancellation, nested child failures, raw links and session commands, selection, cleanup, custom UI/graphics fallbacks, and initial paint on both Pi terminal renderers.
- Structured tests cover numeric precision, duplicate keys, dangerous-looking keys, JSONL, decode-once strings, controls, malformed/deep/large input, diagnostic counts and readable caps.
- Generated captures were inspected at 90 and 40 columns: `/tmp/pi-readable-tool-captures.txt`. These are text captures, **not** a live font/terminal visual check.
- **38 focused rendering tests and the live raw/readable command integration test pass:** `/tmp/pi-readable-scoped-final.log`, `/tmp/pi-readable-command-test.log`.
- Strict Egregore TypeScript passes: `/tmp/pi-readable-tsc.log`.
- Historical workspace run: 147/150 passed in `/tmp/pi-readable-final.log`. The three failures are two mounted Vim animation assertions and a Composer test's missing `requestRender` stub. They were unresolved in that increment; later suite work supersedes this limit. Do not interpret these as current failures.

For current code, start a fresh Pi process. No automatic reload is performed by these adapters.
