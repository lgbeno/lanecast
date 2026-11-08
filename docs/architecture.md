# Architecture

Lanecast is one Electron app. Everything a swim-meet stream needs runs inside it, so the meet-day laptop runs one program instead of a browser, a relay, a capture tool and a streaming encoder.

## Why Electron

The app needs serial ports, a WebSocket server, hardware video decoding and encoding, and a GPU-composited page, identically on Linux, Windows and macOS. Electron ships its own Chromium, so all of that behaves the same everywhere. Tauri was considered and rejected: its Linux webview (WebKitGTK) lacks hardware H.264 and has weaker WebRTC, and the compositor would then differ by platform.

## Processes

```
main process (Node)                               window (Chromium)
──────────────────                                ─────────────────
serial.js   timer port  9600 8E1  ──bytes──▶      CTS.Decoder        clock, event/heat, lanes
            meet port   9600 8N1  ──bytes──▶      GENSER.StreamParser → RosterStore   names, teams, titles
relay.js    WebSocket server :8080 ◀─packet──     Packet.scoreboard()   one JSON object per change
cameras.js  go2rtc sidecar  RTSP in ──WebRTC──▶   <video> per camera (WHEP from 127.0.0.1:1984)
store.js    settings, start lists, cameras (JSON file)
main.js     window, file dialogs, IPC
```

- **Serial ports are opened in the main process** with `serialport`, not Web Serial. That means no picker dialog, ports are remembered and reopened at launch, a port that drops out is reopened when it returns, and reading continues when the window is hidden. Each role has fixed line settings; nothing is ever written to either device.
- **The overlay feed is a server inside the app.** Overlays (browser sources in OBS, or Lanecast's own compositor later) connect to `ws://<this machine>:8080/` and receive every packet.
- **Cameras on this computer** (webcams, capture cards, an iPhone through Continuity Camera) are opened by the window itself with `getUserMedia` by device id, stored as `device:<id>`, never touching go2rtc; main allows the `media` permission for the window and nothing else, asks macOS for camera access through `systemPreferences.askForMediaAccess` the first time (Chromium hands out a silent, frameless track until the person has allowed it), and the Mac build declares `NSCameraUsageDescription`.
- **Network cameras come through go2rtc**, a single static binary the app spawns with a config it writes (`go2rtc.yaml` in the data folder; API on 127.0.0.1:1984, WebRTC on 8555, RTSP server off). The window plays each camera with a plain `RTCPeerConnection` and a WHEP offer (`POST /api/webrtc?src=<id>`), H.264 passed through untouched. The camera list is Lanecast's; go2rtc is told at start and on each change. If go2rtc dies it is restarted; if ffmpeg is on the PATH go2rtc can also transcode and draw a test pattern (go2rtc feeds ffmpeg's output to itself over its RTSP server, so that server stays on, bound to loopback). WebRTC between the window and go2rtc pairs over the machine's LAN address, not loopback (neither side gathers loopback candidates), so the machine needs a network interface up, which it has whenever it can reach a camera.
- **The window decodes.** Protocol code lives in `src/protocol/` as plain modules that load in Node and in the page alike, so the tests run without Electron.
- **Simulation is a runtime switch per part** (timer, meet data, cameras), not a build, and each part's simulation has its own controls in place of the real ones. Timer: main swaps the real port for a pretend console (`Sim.TimerSource`), which the window feeds the loaded start lists as its schedule (`sim.schedule`) and drives by hand (`control`, `race`) or lets run the meet (`run`). Meet data: no port; `Sim.generateMeet()` makes random events (short distances favoured) straight into the roster store, under a separate key so made-up names never meet real ones. Cameras: a `SimCamera` in the window draws a chosen photo or video or a drawn pool onto a canvas and plays the captured stream like any camera, so the program and the lower third can be judged against the real view. The file's bytes come over IPC from main (only ever the file chosen in the dialog) and become a same-origin blob: a cross-origin image would taint the canvas and stop its stream. Any mix is allowed; nothing is simulated by default, and the switches, like the chosen file, are remembered between sessions.
- **Design mode.** Opened in an ordinary browser, `src/renderer/mock.js` installs a stand-in `window.lanecast` (the simulated meet in-page, a canvas as the camera, localStorage as the store), so layout and style can be worked on with a reload instead of an Electron launch. Inside Electron the file does nothing.
- The window runs sandboxed with context isolation; `src/main/preload.js` is the whole surface it can reach.

## The messages

Two kinds of JSON message, built by `src/protocol/packet.js`, go to the theme's frames and to every overlay on the WebSocket feed: a `state` message (the whole scoreboard, with `phase`, the lanes, the cameras) on every change and at most once a second otherwise, and an `event` message (`heat.lineup`, `race.start`, `lane.split`, `lane.finish`, `heat.finish`, `event.finish`, …) when something happens, derived by `src/protocol/events.js` from successive snapshots. Every field is spelled out in [themes.md](themes.md).

## What is built and what is next

| Block | State |
| --- | --- |
| Timer in (CTS scoreboard output) | Built; decoder verified against real captures |
| Meet data in (Meet Manager GENSER link, .scb files) | Built; parser verified against real captures |
| Overlay feed out (WebSocket) | Built |
| Simulation | Built, per part, from each tab's switch; off by default, remembered between sessions |
| Camera in | Built for RTSP: go2rtc sidecar → WebRTC → `<video>`, fetched per platform by `scripts/fetch-go2rtc.js` and shipped as an extra resource. NDI later via the NDI SDK runtime and a native binding |
| Themes | Built: a theme is a folder (theme.json, overlay.html, optional control.html) served over `theme://<id>/` from `themes/` or the user's data folder, run in sandboxed frames; the overlay over the picture, the control panel in the deck. Themes get `state` and `event` messages (`src/protocol/packet.js`, `src/protocol/events.js`) and can cut cameras and place them (`Lanecast.camera`, `Lanecast.layout`). Reference: [themes.md](themes.md) |
| Compositing | The Stream tab composites the program camera (placed by the theme) under the theme's overlay frame; the encoder will need a capture of this view |
| Stream out | After compositing: WebCodecs (hardware H.264 on Mac/Windows) or a bundled ffmpeg encodes; ffmpeg muxes and pushes RTMP to YouTube. On Linux prefer ffmpeg with VAAPI; Chromium's software encoder there is baseline OpenH264 |
| Installers | CI builds `.dmg`, `.exe`, `.AppImage`/`.deb` on tags; unsigned until there is a certificate |

## Platform notes

- **macOS:** unsigned builds need right-click → Open the first time. Signing and notarization need an Apple Developer ID.
- **Windows:** SmartScreen warns on unsigned installers.
- **Linux:** the user must be in the `dialout` group (or have a udev rule) to open serial ports.
- Serial adapters: any USB-to-RS-232 adapter with a current driver (FTDI and Prolific chips are common). The timer's scoreboard output and Meet Manager's scoreboard link are separate cables; see the protocol notes for how to tell which wire is which.
