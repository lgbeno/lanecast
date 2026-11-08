# Themes

A theme is what the stream looks like: the graphics drawn over the camera, how they move when a heat finishes, which camera is on and where it sits, and the buttons the person running the stream gets. A theme is a folder of ordinary web files. The built-in ones are a start; the point of Lanecast is that you make your own, and an AI assistant can do most of the typing: point it at this file and the template.

## A theme is a folder

```
my-theme/
  theme.json        name, version, which pages
  overlay.html      drawn over the picture (required)
  control.html      a control panel in the Stream tab (optional)
  anything else     css, js, images, fonts, sounds — referenced by relative path
```

`theme.json`:

```json
{
  "name": "Dolphins 2026",
  "version": "1.0.0",
  "author": "Pat",
  "description": "Club colours, a splash when a heat ends.",
  "overlay": "overlay.html",
  "control": { "page": "control.html", "width": 420, "height": 96 }
}
```

`control` is optional; a bare string is the page with a default size. Width and height are pixels in the Stream tab's deck; keep it small, it sits above the picture.

Built-in themes live in `themes/` in the repository and ship with the app. Yours live in the app's data folder, `themes/` inside it: **Theme tab → Open my themes folder**. **New theme from the template** copies `themes/template/` there under your name and switches to it. After editing files, press **Reload** on the Theme tab.

## The pages

Both pages are plain HTML. Lanecast loads them in sandboxed frames: the overlay over the program picture, transparent wherever you draw nothing, the exact size of the picture (16:9); the control panel in a box in the Stream tab. Size overlay graphics in `vh`/`vw` and they scale with the stream.

Each page loads the runtime with one script tag:

```html
<script src="../lanecast-theme.js"></script>
```

That path is always right: inside Lanecast it is served from the app, in a browser it is the file beside the themes. It gives the page one global, `Lanecast`.

## The runtime: `Lanecast`

| Call | What it does |
| --- | --- |
| `Lanecast.on('state', fn)` | `fn(state)` whenever the scoreboard changes: up to ten times a second in a race, once a second when nothing moves |
| `Lanecast.on('<event>', fn)` | `fn(event)` when that happens; events are listed below |
| `Lanecast.on('control', fn)` | in the overlay: `fn(data)` for each `Lanecast.send(data)` from the control panel |
| `Lanecast.on('overlay', fn)` | in the control panel: `fn(data)` for each `Lanecast.send(data)` from the overlay |
| `Lanecast.on('hello', fn)` | once, when Lanecast connects: `{ theme: { id, name }, size: { width, height } }` |
| `Lanecast.state` | the latest state message, or `null` before the first |
| `Lanecast.camera(ref)` | put a camera on the program, by its name as typed on the Camera tab, or its id. Unknown: ignored |
| `Lanecast.layout({ x, y, w, h, fit })` | place the camera inside the picture: fractions 0–1 of the picture's width and height; `fit` `'contain'` (default) or `'cover'`. `{ x: 0, y: 0, w: 1, h: 1 }` fills it |
| `Lanecast.send(data)` | overlay → control panel, or control panel → overlay; `data` is any JSON |
| `Lanecast.log(…)` | shows in the Theme tab's console, for debugging |
| `Lanecast.ordinal(n)` | `1 → "1st"`, `2 → "2nd"`… |

Handlers that throw are logged and do not stop the others.

## The state message

```json
{
  "type": "state", "v": 2,
  "event": 12, "heat": 2, "heats": 3, "title": "Girls 11-12 50 Free",
  "clock": "0:14.3", "running": true, "phase": "racing",
  "lanes": [
    { "lane": 1, "name": "", "team": "", "time": "", "place": null, "followsClock": false },
    { "lane": 2, "name": "Tessa Marlowe", "team": "DOLF", "time": "0:13.90", "place": null, "followsClock": false },
    { "lane": 3, "name": "Nia Okafor", "team": "RAYS", "time": "0:28.72", "place": 1, "followsClock": false },
    "… ten lanes"
  ],
  "cameras": [ { "id": "cam-x1", "name": "Wide" }, { "id": "cam-x2", "name": "Finish" } ],
  "camera": "cam-x1"
}
```

- `event`, `heat`: what the timing console shows. `heats`: how many heats the start lists have for this event (0 if none loaded). `title`: from the start lists, or `""`.
- `clock`: the running clock as displayed, `"m:ss.t"`. `running`: the clock is advancing.
- `phase`: `"idle"` (no event), `"lineup"` (a heat is on the board, not started), `"racing"`, `"finished"` (everyone with a name has a place).
- `lanes`: always ten. `name` and `team` come from the start lists (`""` without one). `time` is whatever the lane's display shows: a split while swimming, the final once `place` is set. `place` is a number, or `null`. `followsClock` means that lane module is showing the running clock.
- `cameras`: the cameras set up, in order; `camera`: the id of the one on the program.

Names are shown as "First Last" even when Meet Manager sent "Last, First".

## Events

Each fires once, when it happens; every event message has `type: "event"`, `name`, and the fields below.

| `name` | When | Fields |
| --- | --- | --- |
| `event.change` | a different event number is on the board | `event, title, heats` |
| `heat.lineup` | a new event/heat is on the board (fires after `event.change` for its first heat) | `event, heat, title, lanes: [{ lane, swimmer, team }]` (the lanes with names) |
| `race.start` | the clock started advancing | `event, heat, title` |
| `race.reset` | the clock went back to zero after a start (false start, recall); `heat.lineup` is not repeated | `event, heat` |
| `lane.split` | a lane shows a time without a place | `event, heat, lane, swimmer, team, time` |
| `lane.finish` | a lane shows a place and a time | `event, heat, lane, swimmer, team, place, time` |
| `heat.finish` | every lane with a name has finished; without start lists, the clock has stopped 1.5 s after the first finish | `event, heat, title, results: [{ place, lane, swimmer, team, time }]` sorted by place |
| `event.finish` | `heat.finish` on the last heat the start lists know of | `event, title, heats` |

Typical uses: `heat.lineup` → show the lineup; `race.start` → hide it, start a clock animation, cut to the finish camera; `lane.finish` → pop that lane's result; `heat.finish` → a results board for a few seconds, cut wide; `event.finish` → an event summary or sponsor card.

## Directing the picture

The theme decides which camera is on and where it sits. `Lanecast.camera('Finish')` switches to the camera the user named *Finish* on the Camera tab (match by name, case-insensitive, or by id from `state.cameras`). `Lanecast.layout({ x: .62, y: .05, w: .34, h: .34 })` shrinks it to a picture-in-picture in the top right; `Lanecast.layout({ x: 0, y: 0, w: 1, h: 1 })` fills the picture again. Changes animate over 0.4 s. The overlay is drawn over whatever the layout leaves showing, so the rest of the picture is yours to fill with graphics.

Both pages can direct; the control panel is the natural home for manual cuts, the overlay for automatic ones.

## The control panel

Buttons for the person at the laptop: show or hide a graphic, play a sting, cut a camera, bring up a sponsor. The page talks to the overlay with `Lanecast.send({ action: 'results', on: true })` and the overlay listens with `Lanecast.on('control', m => …)`; the shape of `data` is entirely yours. The panel also receives `state` and events, so it can show the current camera or disable a button while racing. See `themes/template/control.html`.

## Trying a theme

- **Everything simulated:** Stream tab, Simulation control, Run. The simulated meet fires every event: lineup, start, splits, finishes, heat and event finish, about every 30–40 s.
- **Your pool:** Camera tab → Simulate a camera → choose a photo from where the camera will stand; now your overlay is judged against the real view.
- **Without Lanecast open:** open `overlay.html` straight in a browser. The runtime connects to Lanecast's feed on `ws://localhost:8080/` (or `?feed=ws://host:port/`) and the page gets the same messages; the director calls do nothing there. This is also how an OBS browser source would use a theme.
- **Design mode:** `python3 -m http.server` in the repository, then `src/renderer/index.html` in a browser, shows the whole window with the simulated meet; themes load from `themes/`.

## Rules of the frame

- The frames are sandboxed: no access to Lanecast's own page, no `localStorage`, no network beyond what the page itself loads. Everything a theme needs should be in its folder.
- The overlay cannot be clicked; the control panel can.
- Leave `color-scheme` alone (don't set it to `dark`): the frame is transparent only while its scheme matches the one Lanecast gives it.
- A theme that throws in a handler keeps running; look at the Theme tab's console.
- Keep `state` handlers cheap: they run ten times a second. Rebuild DOM only when something you show has changed (the template shows one way).

## For AI assistants

If you are helping someone make a theme: copy `themes/template/` (or ask them to press New theme from the template), keep the `../lanecast-theme.js` script tag, draw with HTML/CSS in `vh`, subscribe to `state` for what is on the board and to the events for what just happened, and test with everything simulated. The messages above are the whole interface; there is nothing else to learn. The repository has a skill for this at `.claude/skills/lanecast-theme/SKILL.md`.
