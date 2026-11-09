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

`control` is optional; a bare string is just the page. The control panel is shown in a drawer down the right side of the Stream tab, portrait like a phone, as tall as the picture; `width` (pixels) is the width the drawer opens at (the user can drag it), and `height` is only needed if the page should not fill the drawer's height (the drawer scrolls if it is taller). The user can hide the drawer for the full picture.

Built-in themes live in `themes/` in the repository and ship with the app. Yours live in the app's data folder, `themes/` inside it. **Theme tab → New theme…** copies `themes/template/` there under the name you give and switches to it; **Open folder**, beside the theme in use, opens it. The app follows a theme of your own on disk: save a file and the overlay and control panel are read again by themselves (**Reload** is there should that ever not happen). A theme's `Lanecast.log(…)` lines and the app's notes about it show in the **Console** under the theme in use.

## The pages

Both pages are plain HTML. Lanecast loads them in sandboxed frames: the overlay over the program picture, transparent wherever you draw nothing, the exact size of the picture (16:9); the control panel in the drawer beside it. Size overlay graphics in `vh`/`vw` and they scale with the stream.

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
| `Lanecast.position(name, camera?)` | steer a camera to a position the user saved under that name (Camera tab, or **Camera control** on the Stream tab). The program camera unless `camera` (a name or id) says otherwise. Unknown name, or a camera that cannot be steered: ignored, with a line in the Theme tab's console |
| `Lanecast.steer({ pan, tilt, zoom }, camera?)` | drive a camera: each from −1 to 1 (right, up and in are positive; the size is the speed). It must be called again several times a second for as long as the camera should keep moving; within a second of the last call the camera stops by itself. `Lanecast.steer()` stops at once |
| `Lanecast.send(data)` | to the theme's other pages; each gets it as `Lanecast.on('<sender's role>', …)`: `'overlay'`, `'control'` or `'dialog'`. `data` is any JSON |
| `Lanecast.dialog(page, { title, width, height })` | pop out another page of the theme as a modal over the Stream tab, for anything too detailed for the control panel: colours, logos, titles. `page` is a file in the theme folder |
| `Lanecast.closeDialog()` | close it, from inside the dialog or from anywhere else |
| `Lanecast.settings` / `Lanecast.on('settings', fn)` | the theme's saved settings, an object of your own design; `fn` runs at start (right after hello) and on every change |
| `Lanecast.saveSettings(partial)` | merge into the saved settings; Lanecast keeps them per theme across runs and hands the result to every page |
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
  "cameras": [
    { "id": "cam-x1", "name": "Wide", "steerable": true, "positions": ["Whole pool", "Blocks", "Finish line"] },
    { "id": "cam-x2", "name": "Finish", "steerable": false, "positions": [] }
  ],
  "camera": "cam-x1"
}
```

- `event`, `heat`: what the timing console shows. `heats`: how many heats the start lists have for this event (0 if none loaded). `title`: from the start lists, or `""`.
- `clock`: the running clock as displayed, `"m:ss.t"`. `running`: the clock is advancing.
- `phase`: `"idle"` (no event), `"lineup"` (a heat is on the board, not started), `"racing"`, `"finished"` (everyone with a name has a place).
- `lanes`: always ten. `name` and `team` come from the start lists (`""` without one). `time` is whatever the lane's display shows: a split while swimming, the final once `place` is set. `place` is a number, or `null`. `followsClock` means that lane module is showing the running clock.
- `cameras`: the cameras set up, in order; `camera`: the id of the one on the program. `steerable` is true for a camera that can be panned, tilted and zoomed from the app right now; `positions` are the names of the places the user has saved for it (empty unless steerable).

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

### Moving the camera

A camera that can be steered (a PTZ camera; `steerable` in `state.cameras`) has **positions**: places the user framed and saved under a name, such as *Whole pool*, *Blocks* or *Finish line*. A theme never deals in pan and tilt numbers or preset slots, only in those names:

```js
Lanecast.on('heat.lineup', () => Lanecast.position('Blocks'));          // the swimmers stepping up
Lanecast.on('race.start',  () => Lanecast.position('Whole pool'));
Lanecast.on('lane.finish', e => { if (e.place === 1) Lanecast.position('Finish line'); });
Lanecast.position('Scoreboard', 'Deck cam');                            // another camera, by its name
```

A position holds the pan, tilt, zoom and focus the user saved. The camera takes a moment to travel, focusing as it goes, so cue a position a beat before the graphic that needs it, and consider cutting to another camera while it moves. The names are whatever the user typed, compared without regard to case; `state.cameras[i].positions` lists them, so a control panel can offer a button for each (the template's does), and a theme that depends on particular names should say which in its `description`. A name the camera does not have is ignored and noted in the Theme tab's console. Like the other director calls, this does nothing outside Lanecast.

For a theme that follows something rather than cutting between places, there is `Lanecast.steer`:

```js
// Each time round a loop of your own, say where to drive: here, slowly right and a little in.
const follow = setInterval(() => Lanecast.steer({ pan: 0.2, tilt: 0, zoom: 0.1 }), 200);
// ...and when done:
clearInterval(follow); Lanecast.steer();
```

It behaves like a held button. The camera keeps moving only while the calls keep coming, and stops by itself within a second of the last one, so a theme that stops, crashes or is switched away cannot leave a camera running. Going to a named position while steering takes over; steering while a position is being reached takes over from that.

What a theme does not have is the picture. The overlay is drawn over the camera but is not given its pixels, so a theme cannot yet look for a swimmer in it; `Lanecast.steer` is the half of following that is here today, driven by whatever the theme does know (the race state, a control in its panel, a source of its own).

## The control panel

Buttons for the person at the laptop: show or hide a graphic, play a sting, cut a camera, bring up a sponsor. Design it portrait, as you would a phone screen: the drawer is narrow and tall and scrolls. The page talks to the overlay with `Lanecast.send({ action: 'results', on: true })` and the overlay listens with `Lanecast.on('control', m => …)`; the shape of `data` is entirely yours. The panel also receives `state` and events, so it can show the current camera or disable a button while racing. See `themes/template/control.html`.

## Dialogs and settings

A control panel is narrow; detailed configuration — team colours, logos, the meet name, which graphics to use — goes in a page you pop out with `Lanecast.dialog('settings.html', { title: 'Theme settings', width: 520, height: 520 })`. The dialog is one of your pages in a modal with a Close button; inside it, `Lanecast.closeDialog()` closes it (Save and Cancel in the template).

What the user chooses is kept with `Lanecast.saveSettings({ accent: '#ffcc33', logo: 'data:image/png;base64,…' })`: Lanecast stores it per theme, across runs, and sends the merged object to every page of the theme through `Lanecast.on('settings', s => …)`, once right after hello and again on each save. The overlay applies it (set a CSS variable, show a logo); the dialog fills its form from it. Images can be read from an `<input type="file">` and saved as data URLs; keep them to a few hundred kilobytes. `themes/template/settings.html` shows all of it.

## Trying a theme

- **Everything simulated:** Stream tab, Simulation control, Run. The simulated meet fires every event: lineup, start, splits, finishes, heat and event finish, about every 30–40 s.
- **Your pool:** Camera tab → Simulate a camera → choose a photo from where the camera will stand; now your overlay is judged against the real view.
- **As a page on its own:** open `overlay.html` straight in a browser, with Lanecast running. The runtime connects to Lanecast's feed on `ws://localhost:8080/` (or `?feed=ws://host:port/`) and the page gets the same messages; the director calls do nothing there. This is also how an OBS browser source would use a theme.
- **No app at all:** open `preview.html?theme=<folder>`, which sits beside the themes (in `themes/` here, and in the app's data folder beside your own). It plays a scripted event into the theme, round and round, and logs every camera cut, layout, position and saved setting the theme asks for. `&speed=3` runs it faster; `&at=lineup`, `&at=racing` or `&at=results` starts at that moment.
- **Design mode:** `python3 -m http.server` in the repository, then `src/renderer/index.html` in a browser, shows the whole window with the simulated meet; themes load from `themes/`.

## Rules of the frame

- The frames are sandboxed: no access to Lanecast's own page, no `localStorage` or other storage (it throws), no `alert`, `confirm` or `prompt` (they do nothing). Everything a theme needs should be in its folder; do not load fonts, scripts or images from the internet.
- The overlay cannot be clicked; the control panel can.
- Leave `color-scheme` alone (don't set it to `dark`): the frame is transparent only while its scheme matches the one Lanecast gives it.
- A theme that throws in a handler keeps running; look at the Theme tab's console.
- Keep `state` handlers cheap: they run ten times a second. Rebuild DOM only when something you show has changed (the template shows one way).

## For AI assistants

There is a set of documents written for you: [a brief](agents/making-a-theme.md) (what to ask, where files go, the order to build in, how to see your work, the checklist for done), [every message with examples](agents/theme-messages.md), and [a cookbook](agents/theme-cookbook.md). `themes/preview.html?theme=<folder>` plays a scripted heat into a theme with no app and no meet, and logs what the theme asks for; look at your work there before handing it over.

In short, if you are helping someone make a theme: copy `themes/template/` (or ask them to press **New theme…** on the Theme tab, then **Open folder**), keep the `../lanecast-theme.js` script tag, draw with HTML/CSS in `vh`, subscribe to `state` for what is on the board and to the events for what just happened, and test with everything simulated. The messages above are the whole interface; there is nothing else to learn. The repository has a skill for this at `.claude/skills/lanecast-theme/SKILL.md`.
