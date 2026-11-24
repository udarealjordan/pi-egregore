# pi-ask

share context, seek the seams, and make a decision.
call out the unknown!

**TLDR:** (yes the juice is worth the squeeze)

- ask for more questions and you shall receive!
- regenerate remaining questions based on answers and notes (if q1 changes direction, that context carries forward)
- ask for clarity between questions (never answer a question you don't understand!)
- stop anytime and submit only what you've answered (you're free!)
- see why an option is suggested, instead of trusting an unexplained badge
- shared understanding, fewer assumptions; ask when the answer changes the path

- already interested? check out [installation](#installation)! hope you enjoy :)

**Usage:**
- best for work where understanding grows as decisions compound
  - dictation in the notes + regeneration is good for getting the thoughts out
- the most fruitful conversations happen at the edge of shared understanding

## everything underneath is vibed but the above is Lived

Ask lets the agent bring you into a decision: a focused question when it can't continue without you, or a posted question you can answer later while it keeps working.

- **`consult`** asks one to four questions and waits. One question opens a focused form; several open a sequential form with a Review screen.
- **`question_queue`** posts a question for later. It appears at the top of the Tasks dock and in `/questions`; your answer reaches the agent as a message.
- **How often the agent asks** is yours to set: `/egregore` → Ask → Question frame → **How often to ask**. *Only when needed* asks when it is blocked or before something hard to undo. *Balanced* (the default) also asks at real forks and on taste, naming or scope. *Curious* also checks in at milestones.

## Answering

- **One Enter answers** a single-choice question. In a multi-question form, Enter picks an answer and Enter again moves on; Review confirms the whole form.
- **Something else…** opens a box for your own answer.
- **+ Note** adds context to an answer: press `+` on a choice, or Tab from a written answer.
- **Ask back** with Ctrl+? when you don't understand the question. The agent answers, then asks again only if it still matters.
- **Skip** with Ctrl+S. A skip is never taken as consent.
- **Regenerate** (in F2 More, or Ctrl+R) asks the agent to rewrite the questions you haven't answered, using the answers and notes you have given.
- **Submit what you have.** In Review you can send the answered questions and leave the rest.

Suggestions show why an option is suggested (`Assistant's take · possible fit`, with the reason), not just a badge. They are the agent's judgment.

In Pi's fullscreen TUI, Ask declares semantic copy metadata through the shared contracts package, so supported question shells copy prompts, choices, notes and written answers without frame rails or action hints. Unknown or stale rows retain native copy. Regular terminal selection remains terminal-owned.

### Best usage: ask when inquiry is worth the interruption

Good questions decide something only you can decide: the goal or scope when it is unclear, a choice between reasonable approaches, taste and naming, or anything hard to undo. The agent should look up what it can find itself, recommend an option, and say what it would do without an answer. A plan for substantial work is a good moment to ask whether to adjust it.

## Keyboard controls

The footer shows the keys that apply right now; F2 More lists everything else.

| Key | Does |
| --- | --- |
| Up/Down | Move through choices |
| Enter | Answer, confirm, save, continue or submit, as the footer says |
| Space | Toggle an option in a multiple-choice question |
| Left/Right | Previous or next question (inside text, move the cursor) |
| Ctrl+Left/Right | Previous or next question, even while typing |
| `+` / Tab | Open the note for this answer |
| Shift+Enter | New line in a text box |
| Ctrl+Enter | Open Review (multi-question) or submit while editing a note |
| Ctrl+S | Skip this question (or restore it) |
| Ctrl+? | Ask the agent what it means |
| Ctrl+R | Regenerate unanswered questions |
| Ctrl+C | Clear the answer or selection; in a note, discard the edit |
| Esc | Go back one level; at the top, close (asks first if you've entered anything) |
| F2 | More actions, including pin, clear and discard |

**Pin.** The top-right **Pinned** label collapses the panel to a one-line bar so you can read the transcript; click the bar or press Enter to reopen it. The pin lasts for the session.

## Tool parameters

### consult

```json
{
  "questions": [
    {
      "question": "Which database should we use?",
      "label": "Database",
      "options": [
        { "label": "PostgreSQL" },
        { "label": "SQLite", "suggestion": { "kind": "low-friction", "basis": "A local prototype needs no server.", "caveat": "Revisit for concurrent writes." } }
      ]
    },
    { "question": "What should the release notes emphasize?", "label": "Notes" }
  ]
}
```

- `questions`: one to four. Each has `question`, an optional short `label`, optional `details`, and `options` for a decision (omit `options` for a written answer). `multiSelect: true` allows several options.
- An option has a `label` and optional `value`, `description` and `suggestion` (`kind`: `evidence`, `fit`, `low-friction` or `explore`; a non-blank `basis`; optional `caveat`).
- Results report each answer, note, skip or question back. A status of `regenerate` or `clarification_requested` asks the agent to rework or explain before asking again.

The earlier `ask_user_question` and `ask_questions` names stay registered (hidden from the model) so older sessions still render.

### question_queue

One tool with an `op`:

| `op` | Parameters |
| --- | --- |
| `post` | `question` with `question`, `urgency` (`blocking` or `deferred`), `why`, `boundary` (what waits, what continues), and optional `details`, `options`, `multiSelect`, `planId`, `taskIds` |
| `list` | Optional `offset` and `limit` (up to 20) |
| `withdraw` | `id`, its current `revision` from `list`, and a `reason` |
| `replace` | `id`, `revision`, `reason` and the new `question` |

`/questions` opens the inbox; `/questions q1` opens one question; `/questions retry q1` resends an answer that didn't reach the agent. Limits: 100 questions and 1 MiB per branch.

## Outside the terminal UI

In print, JSON or RPC mode, `consult` returns `unavailable` instead of prompting. `question_queue` can still post and list; answering needs the terminal UI.

## Privacy

Questions, answers and notes become part of the session and are sent to your model provider like any message. Ask makes no network requests of its own.

## Installation

### As part of this suite

The Egregore suite loads Ask; see the [install guide](../../docs/INSTALL.md). Don't register Ask separately as well.

### Standalone from this checkout

```sh
# From the suite repository root, instead of (not as well as) the suite
npm ci
pi install "$PWD/packages/pi-ask"
```

This loads Ask alone. Frame and the shared contracts package resolve through the checkout's dependencies. Start a fresh Pi process after updating.

## Development

From the suite root, with a compatible Pi installed:

```sh
npm run test:ask
npm run typecheck --workspace=pi-ask
npm run pack:check --workspace=pi-ask
```

`PI_ASK_HOST_MODULES` can point the tests at a specific Pi `node_modules`. There is no build step: Pi loads the TypeScript directly.

## Contributing

Issues, focused pull requests and terminal compatibility reports are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed; see [LICENSE](LICENSE).
