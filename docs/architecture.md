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
store.js    settings + start lists (JSON file)
main.js     window, file dialogs, IPC
```

- **Serial ports are opened in the main process** with `serialport`, not Web Serial. That means no picker dialog, ports are remembered and reopened at launch, a port that drops out is reopened when it returns, and reading continues when the window is hidden. Each role has fixed line settings; nothing is ever written to either device.
- **The overlay feed is a server inside the app.** Overlays (browser sources in OBS, or Lanecast's own compositor later) connect to `ws://<this machine>:8080/` and receive every packet.
- **The window decodes.** Protocol code lives in `src/protocol/` as plain modules that load in Node and in the page alike, so the tests run without Electron.
- The window runs sandboxed with context isolation; `src/main/preload.js` is the whole surface it can reach.

## The packet

One JSON object per message, built by `src/protocol/packet.js`:

```json
{ "v": 1, "type": "scoreboard",
  "event": 73, "heat": 1, "title": "MIXED 100 FREE RELAY",
  "clock": "0:13.0", "state": "running",
  "lanes": [ { "lane": 1, "name": "Alex Sample", "team": "AAA", "time": "", "place": "", "followsClock": true }, "… ten lanes" ] }
```

Fields hold what the console displays. `state` is `running`, `reset` (inferred, see the timer notes) or `unknown`. A lane's `time` is the time on its display, which may be a split or a finish; `place` is the displayed place. `followsClock` means the lane module is showing the running clock. A packet goes out on every clock change and at most once a second when nothing changes.

## What is built and what is next

| Block | State |
| --- | --- |
| Timer in (CTS scoreboard output) | Built; decoder verified against real captures |
| Meet data in (Meet Manager GENSER link, .scb files) | Built; parser verified against real captures |
| Overlay feed out (WebSocket) | Built |
| Simulated ports | Built (`npm run simulate`) |
| Camera in | Next. RTSP from the camera through a bundled [go2rtc](https://github.com/AlexxIT/go2rtc) sidecar to WebRTC, played in a `<video>` under the overlays. NDI later via the NDI SDK runtime and a native binding |
| Compositing | After camera: the window draws camera + overlays at 1080p60 |
| Stream out | After compositing: WebCodecs (hardware H.264 on Mac/Windows) or a bundled ffmpeg encodes; ffmpeg muxes and pushes RTMP to YouTube. On Linux prefer ffmpeg with VAAPI; Chromium's software encoder there is baseline OpenH264 |
| Installers | CI builds `.dmg`, `.exe`, `.AppImage`/`.deb` on tags; unsigned until there is a certificate |

## Platform notes

- **macOS:** unsigned builds need right-click → Open the first time. Signing and notarization need an Apple Developer ID.
- **Windows:** SmartScreen warns on unsigned installers.
- **Linux:** the user must be in the `dialout` group (or have a udev rule) to open serial ports.
- Serial adapters: any USB-to-RS-232 adapter with a current driver (FTDI and Prolific chips are common). The timer's scoreboard output and Meet Manager's scoreboard link are separate cables; see the protocol notes for how to tell which wire is which.
