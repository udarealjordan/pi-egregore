# Tasks

A visible checklist for substantial work. The agent keeps named plans of tasks in the session; you see the current plan above the input and can browse earlier ones with `/tasks`.

```
╭ Photos for Mom ━━━━━━━━━━━━━━━━━━━ 1 waiting on you · 1 of 4 done ╮
┃ ? Which cover photo? · /questions q1                              ┃
┃ ✓ Gather the photos                                               ┃
┃ ◉ Print 4×6 copies                                                ┃
┃ ! Order the album · waiting for the shop to reopen                ┃
┃ ○ Mail it                                                         ┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
```

## The dock

- **Rows follow the plan's order** around the work in progress: the task just finished, the active task, what comes next, then any earlier tasks not yet started. Tasks that don't fit become `+ N more`.
- **Glyphs:** `✓` done, `◉` in progress (with `· paused` when the agent isn't running), `!` blocked with its reason, `○` not started (with `· after …` when it waits on another task), `–` dropped.
- **Phases:** when a plan has more than one phase, each phase gets a header with its progress, such as `Research · 2/3`.
- **Questions** the agent posted for you lead the dock as `?` rows. Answer with `/questions` or from the `/tasks` panel. Once you answer, the row goes away.
- **When every task is done or dropped,** the dock shows `✓ Plan finished` for about four seconds and then gets out of the way. The plan stays in `/tasks history`.
- Use `/tasks hide` to hide it while keeping the plan.

## In the transcript

Each Tasks call is one row on the shared tool rail. The verb is the change, and plan progress sits on the right:

```
┃ ◆ Plan     Photos for Mom · 4 tasks          0/4
┃ ✓ Done     Gather the photos                 1/4
┃ ◉ Started  Print 4×6 copies                  1/4
┃ ! Blocked  Order the album                   1/4
┃   waiting for the shop to reopen
```

Click a row, or press Pi's expand key, to see the full checklist with notes and evidence.

## Commands

| Command | What it does |
| --- | --- |
| `/tasks` | Open the panel for the current plan |
| `/tasks new <name>` | Start a named plan (older plans are kept) |
| `/tasks add <task>` | Add a task to the current plan |
| `/tasks history` | Browse earlier plans |

Everything else lives in the panel's keys (press `?` there): switch to a plan (`S`), rename (`T`), archive (`X`), restore (`R`), clear (`C`), turn Tasks off (`O`). For keyboards and scripts, `/tasks use`, `archive`, `restore`, `rename`, `clear`, `hide`, `unhide`, `on` and `off` still work when typed.

### Inspect history without changing current work

`/tasks history` lists plans as Current, Open, Finished and Archived; `/` filters by title. Opening a plan from the list shows its tasks without making it current or starting anything. Escape steps back.

## Panel keys

- **Up/Down** choose a row; **Enter** opens a task's details or answers the selected question.
- **E** edit a task, **A** add, **N** new plan, **F** show finished and dropped work.
- **H** plan library, **S** make a plan current, **R** restore an archived plan.
- **T** rename, **X** archive, **C** clear (asks first), **O** turn Tasks off.
- **?** help, **Escape** back, **Ctrl+C** close.

## For the agent

The `tasks` tool takes one operation:

- `create` with a `title` and optional `items` starts a plan and makes it current.
- `add` appends `items` to the current plan.
- `update` changes one task by `id`: `status` (`pending`, `active`, `blocked` with a `reason`, `done` with a `note`, or `cancelled`), `title`, `phase`, `doneWhen`, `dependsOn`, `note`, `evidence`.
- `list` and `plans` read; `select`, `rename` and `archive` manage plans.

One task is active at a time. Only you can reopen a task you closed, restore an archive or regenerate a plan you cleared. Questions for later go through Ask's `question_queue` with `planId` and `taskIds`; their answers arrive as messages, and the agent updates the tasks itself.

## Storage

Plans live in the session as custom entries, per branch, so forks and rewinds keep the state of the branch you're on. Older plan records (`pi-tasks:plan-v1`, earlier library versions, blocker-owner fields) are still read. `~/.pi/agent/pi-tasks.json` stores only whether Tasks is on and whether the dock is hidden.

Limits: 100 plans, 100 tasks per plan, and bounded snapshot sizes. Hitting one is an explicit error; nothing is evicted silently.

## Without Egregore

Tasks works on its own with a native dock above the input and the same `/tasks` panel. Egregore, when loaded, draws the dock instead; neither replaces the other's state.

## Tests

```sh
npm run test:tasks && npm run test:egregore
```
