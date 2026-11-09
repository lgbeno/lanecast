# For AI agents

Lanecast is a desktop app (Electron) that turns a swim meet into a live stream: it reads the timing console and Meet Manager over serial, shows the pool's cameras, and draws a **theme** over the picture. People run it at a pool; most of them are volunteers, not engineers.

You are most likely here for one of two jobs.

## 1. Make or change a theme

A theme is a folder of plain web files. You do not need to read the app's source, run the app, or have a meet.

| Read | For |
| --- | --- |
| [docs/agents/making-a-theme.md](docs/agents/making-a-theme.md) | **Start here.** What to ask the person, where the files go, the order to build in, how to see your work, and the checklist for done |
| [docs/agents/theme-requirements.md](docs/agents/theme-requirements.md) | Before building: the form for writing down what the theme should be, how to fill it in with the person, and how to get from it to a theme |
| [docs/agents/theme-messages.md](docs/agents/theme-messages.md) | Every message a theme receives, with real examples and a whole heat played out |
| [docs/agents/theme-cookbook.md](docs/agents/theme-cookbook.md) | Working code for the things themes usually do: results boards, picture-in-picture, camera cues, a control panel, saved colours and logos |
| [docs/themes.md](docs/themes.md) | The reference for the whole `Lanecast` interface |

To see a theme react to a race with nothing else running, open [`themes/preview.html`](themes/preview.html) in a browser: `themes/preview.html?theme=template`. It plays a scripted heat into the theme and logs what the theme asks the app to do.

The two rules that catch people out: a theme's pages cannot use `alert`, `localStorage` or anything outside their own folder, and the overlay must stay transparent wherever it draws nothing.

## 2. Change the app

| Where | What |
| --- | --- |
| `src/protocol/` | The timing console and Meet Manager decoders, the simulator, the messages themes get. Plain modules that run in Node and in the window |
| `src/main/` | The main process: serial ports, cameras, PTZ, network search, themes, projects |
| `src/renderer/` | The window: `index.html`, `app.js`, `style.css`; `mock.js` stands in for the main process in design mode |
| `themes/` | The built-in themes, the runtime every theme loads, and the preview page |
| `test/` | Unit tests (`*.test.js`) and `smoke.js`, which drives the real app |
| `docs/` | [architecture](docs/architecture.md), the [timer](docs/timer-protocol.md) and [Meet Manager](docs/meet-manager-link.md) protocols, [themes](docs/themes.md) |

```bash
npm install                      # also fetches the camera engine and brands the development app
npm test                         # unit tests; this is what CI runs
npx electron test/smoke.js       # starts the app with everything simulated and checks what shows (not in CI)
npm start                        # run the app
```

Design mode shows the whole window in a browser, with the main process mocked: `python3 -m http.server` in the repository, then open `src/renderer/index.html`.

House rules, learned the hard way:

- **Say what to do, not why it broke.** Messages in the window are for a volunteer at a pool. No lessons in networking.
- **Things keep up by themselves.** Prefer finding, watching and refreshing over a button the person has to remember to press.
- **Anything manual or rare goes behind one quiet button and a dialog.** The main view is for the common path.
- **No protocol settings in the window.** Baud rates and the like have one right value; the app uses it.
- **No real meet data in the repository:** no athlete names, no captures from a real meet.
- **The app only listens on the serial ports.** It never writes to the timing console.
- **No new dependencies** without a reason that survives a second look; much here is small and written out on purpose.
- **Check on real behaviour.** If a change can be seen, see it (design mode, the smoke run, the preview page) before calling it done, and say plainly what was not checked.
