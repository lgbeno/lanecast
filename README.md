<img src="assets/logo.svg" alt="" width="72" align="left">

# Lanecast

[lanecast.live](https://lanecast.live)

<br clear="left">

Lanecast is designed to be an all-in-one, easy-to-use software that creates professional YouTube Live streams for swim meets.

If you are reading this, you are probably that guy who was asked by your organization to fix problems with your timing system and scoreboard, and you find yourself wrangling cables around a hot pool. You're not alone, I've been there!

Lanecast is free and extensible. It is written by AI with a human touch.

It is very easy and quite fun to customize your themes with AI too!

You can use Lanecast as much as you want and owe nothing in return. If you do want to pay it forward, feel free to send a tip.

We cannot offer direct support, but we try to document things the best we can, and AI tools can provide great advice. Just send them a link to this page and ask away!

Have fun & tell your friends!

## How it works

Lanecast reads the timing console and HY-TEK Meet Manager over serial, will take the camera over the network, composites the overlays and sends the program out — on Linux, Windows and macOS, from a single install.

**Status: early.** The data side works: timer in, Meet Manager in, overlay feed out, with a simulated meet for trying it without hardware. Camera, compositing and the YouTube encoder are next; see [docs/architecture.md](docs/architecture.md) for the plan.

## What it does today

Five tabs across the top. Each tab's dot turns green when that part is ready to go, and stays quiet otherwise.

| Tab | What it does | Green when |
| --- | --- | --- |
| **Stream** | The overlay feed: a WebSocket server on port 8080 inside the app. Every scoreboard change goes to every overlay connected, on this machine or another. The current packet is shown. YouTube output will live here. | an overlay is connected |
| **Timer** | Pick the serial port the console's scoreboard output is on and press Connect. Shows the running clock, event/heat, race state and every lane. | the console's clock is arriving |
| **Events** | Pick the port on Meet Manager's scoreboard link and press Connect. Start lists accumulate as Meet Manager sends them and are kept between runs. Load reads Meet Manager's `.scb` export files, Save writes them back out, and the browser steps through events and heats. | start lists are in hand |
| **Cameras** | Not built yet. | — |
| **Theme** | Not built yet. | — |

No baud rates or parity to set: each link has one correct setting and the app uses it. A port that was connected when the app closed is reconnected at launch; a port that drops out is reopened when it comes back.

## Running it

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Without hardware:

```bash
npm run simulate
```

Both Connect buttons then open a made-up meet that repeats. Everything shown comes from the simulator, nothing from a real console.

Tests run without Electron:

```bash
npm test
```

A full check of the app on the simulated ports, including a screenshot:

```bash
npx electron test/smoke.js shot.png
```

## Installers

`npm run dist` builds the installer for the OS it runs on into `dist/`. The [build workflow](.github/workflows/build.yml) builds all three when a `v*` tag is pushed. Builds are unsigned for now: on macOS right-click → Open the first time; Windows SmartScreen will warn. On Linux, add yourself to the `dialout` group to open serial ports.

## At the pool

- The console's **scoreboard output** and Meet Manager's **scoreboard link** are two separate cables; each needs its own USB serial adapter. Lanecast only listens on both.
- Meet Manager's link has two directions on separate wires. Tap the one Meet Manager transmits on; if the Meet data panel says it is seeing the scoreboard computer's line, move the tap to the other wire.
- Overlays (an OBS browser source today, Lanecast's own compositor later) connect to `ws://<this machine>:8080/`. The panel shows the address.

Protocol notes, reconstructed from captures of real meets: [timer](docs/timer-protocol.md), [Meet Manager](docs/meet-manager-link.md). Keep captures and start-list files with athlete names out of the repository; `.gitignore` already excludes `*.scb`, `*.csv` and `captures/`.

## Licence

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the reference implementation that informed the timer decoding.
