# Pi Egregore

A calmer, more legible way to work with Pi. Egregore frames the conversation around Pi's native editor, Tasks keeps a visible checklist of the work, and Ask brings you in when a decision is yours.

An *egregore* is a thought-form that grows from shared attention and intention. The name describes the working relationship you build with the agent over time. It makes no claim about consciousness.

## What's in the suite

| Part | What it does | Guide |
| --- | --- | --- |
| Egregore | Composer frame, chat and tool frames, footer, and `/egregore` appearance settings with live preview | [Egregore](extensions/pi-egregore/README.md) |
| Tasks | Named plans of tasks with status, notes and history; the `tasks` tool and `/tasks` | [Tasks](extensions/pi-tasks/README.md) |
| Ask | Questions that pause for your answer, and posted questions that can wait | [Ask](packages/pi-ask/README.md) |
| Frame | The shared frame every surface draws with: rounded frames, line weights, tool rows and standard placements | [Frame](packages/pi-frame/README.md) |
| Contracts | Small versioned data protocols between the parts | [Contracts](packages/pi-agent-contracts/README.md) |

Pi stays the host. It owns sessions, the model and tool loop, and the native editor. The root package loads Egregore, Tasks and Ask once and bundles Frame and Contracts as libraries.

## Find your way

| I want to… | Start here |
| --- | --- |
| Install on another computer | [Install](docs/INSTALL.md) |
| Change how things look | [Egregore settings](extensions/pi-egregore/FOOTER.md) and [preview walkthrough](docs/TRY-PREVIEW.md) |
| Work with plans and tasks | [Tasks commands](extensions/pi-tasks/README.md#commands) |
| Answer or revise questions | [Ask usage](packages/pi-ask/README.md#best-usage-ask-when-inquiry-is-worth-the-interruption) |
| Look up a setting | [Settings reference](docs/SETTINGS-REVIEW.md) |
| Change the code | [Contributing](CONTRIBUTING.md) and [architecture](docs/ARCHITECTURE.md) |
| Build your own surface | [Building a new surface](packages/pi-frame/README.md#building-a-new-surface) |
| Build on Tasks or Ask | [Primitive contracts](docs/PRIMITIVES.md) |

The [documentation index](docs/README.md) lists everything else.

## How it fits together

Every surface in the suite is one of four kinds, and Frame names them so a new component lands in the right place with the same spacing:

- **Input** takes the composer's place while you answer or type: questions (`consult`) and side questions (`/btw`).
- **Panel** opens centered over the transcript for browsing: `/paths`, plan history, `/egregore`.
- **Dock** shows live status just above the composer: the Tasks checklist.
- **Transcript** is history: your messages, the agent's replies, and tool calls as rows on one rail.

All frames are thin and rounded. What wants attention now (the composer, a question, the live dock) stands out by color and bold labels. To build your own surface, start with [Building a new surface](packages/pi-frame/README.md#building-a-new-surface).

## What persists

- **Tasks, posted questions and side questions** live in the session, per branch. Forks and rewinds keep the state of the branch you're on. Side questions never enter the model's context.
- **Appearance** lives in `pi-egregore.json` in the Pi agent directory. Tasks keeps its on/off and dock visibility in `pi-tasks.json`.

## Deploying

Pushing to `main` deploys to every machine that runs the sync job. See [ops/sync](ops/sync/README.md) for how releases are checked and activated, and how to install the job on a new machine.

## Develop

Requires Pi 1.3.0 or newer, Node.js 22.23.2 or newer, npm and Git. From the repository root:

```sh
npm ci
npm test
npm run pack:check
```

Tests run against the installed Pi host. [Contributor setup](CONTRIBUTING.md#test-environment) covers host overrides and running one component's tests. The [evaluation harness](eval/harness/README.md) is for development only and does not ship.

Pi loads this checkout directly. Start a fresh Pi process after changing package exports or imported modules, since `/reload` can keep old modules.

To try the checkout on its own: `pi -ne -e "$HOME/code/pi-egregore"`.
