# Making a Lanecast theme: a brief for AI agents

You have been asked to make, or change, what a swim meet's live stream looks like. This page is everything you need to do that well. It is written for an AI agent; a person can follow it too.

**Contents:** [what a theme is](#what-a-theme-is) · [ask first](#ask-the-person-first) · [where the files go](#where-the-files-go) · [seeing your work](#seeing-your-work) · [build in this order](#build-in-this-order) · [the rules of the frame](#the-rules-of-the-frame) · [done means](#done-means) · [when it does not work](#when-it-does-not-work)

Companions: [every message, with examples](theme-messages.md) · [working code for common things](theme-cookbook.md) · [the full reference](../themes.md)

## What a theme is

A folder of ordinary web files. Lanecast shows them in frames and feeds them the race.

```
dolphins-2026/
  theme.json        the name, and which pages
  overlay.html      drawn over the camera picture (required)
  control.html      buttons for the person running the stream (optional)
  settings.html     any other page, opened as a dialog (optional)
  …                 css, js, images, fonts: anything, by relative path
```

- The **overlay** is a transparent page exactly the size of the picture (16:9). You draw graphics; the camera shows through everywhere else. Nobody can click it.
- The **control panel** is a narrow, tall page in a drawer beside the picture. The person running the stream clicks it.
- Every page loads one script, which gives it the global `Lanecast`:

  ```html
  <script src="../lanecast-theme.js"></script>
  ```

  Keep that tag exactly as written. Do not copy the runtime into the theme, and do not change the path.

That is the whole model. There is no build step, no framework and no package to install. Write HTML, CSS and JavaScript.

## Ask the person first

A theme is built around a particular pool and club. Before writing anything, find out what you cannot guess. Ask only what matters for what they asked for.

| Ask | Because |
| --- | --- |
| The club's colours, and a logo file if they have one | The look. Ask for hex values or let them pick later in a settings dialog |
| What should be on screen, and when: before the start, during the race, after a heat | This is the design. "A results board after each heat" is a different theme from "a clock in the corner" |
| The names of their cameras, exactly as typed on the Camera tab | `Lanecast.camera('Finish')` only works if a camera is called *Finish* |
| Whether a camera can be steered, and the names of its saved positions | `Lanecast.position('Blocks')` only works if they saved a position called *Blocks* |
| Whether they want buttons, and for what | Decides if there is a control panel at all |
| Sponsors, a meet name, anything that changes from meet to meet | Belongs in a settings dialog, not hard-coded |

If they have not set up cameras or positions yet, build the theme so it works without them (see [the cookbook](theme-cookbook.md#cut-cameras-with-the-race)), and tell them the names your theme looks for.

## Where the files go

**A new theme of the person's own** lives in the app's data folder, in `themes/`:

| System | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/Lanecast/themes/` |
| Windows | `%APPDATA%\Lanecast\themes\` |
| Linux | `~/.config/Lanecast/themes/` |

The easy way to start: the person presses **Theme tab → New theme…** and types a name. That copies the template into a new folder there and switches to it; **Open folder** shows where it is. Or make the folder yourself, by copying [`themes/template/`](../../themes/template) from this repository.

That folder also holds `lanecast-theme.js` and `preview.html`. The app keeps both current; leave them alone.

**A built-in theme** (one that ships with the app) lives in [`themes/`](../../themes) in this repository. Only add one there if you were asked to change the app itself.

`theme.json`:

```json
{
  "name": "Dolphins 2026",
  "version": "1.0.0",
  "author": "Pat",
  "description": "Club colours; a results board after each heat. Expects cameras named Wide and Finish.",
  "overlay": "overlay.html",
  "control": { "page": "control.html", "width": 340 }
}
```

| Field | Notes |
| --- | --- |
| `name` | Shown on the Theme tab |
| `version`, `author`, `description` | Shown beside it. Use `description` to say which camera and position names the theme expects |
| `overlay` | The overlay page. Defaults to `overlay.html` |
| `control` | Leave out for no control panel. `width` is the drawer's opening width in pixels (the person can drag it; never less than 240) |

## Seeing your work

Do not hand over a theme you have not looked at. There are two ways to look, and the first needs nothing but a browser.

### The preview page (no app, no meet)

`preview.html` sits beside the themes. Open it with the theme's folder name:

```
themes/preview.html?theme=template                      in this repository
…/Lanecast/themes/preview.html?theme=dolphins-2026      a theme of the person's own
```

It loads the theme as Lanecast does and plays a scripted event into it, round and round: two heats of a 100, six swimmers, with the lineup, the start, a split, the finishes, the heat finishing and the event finishing. Under the picture it logs everything the theme asks of the app (camera cuts, layout, positions, dialogs, saved settings), including what would have been ignored and why.

| Add to the address | To |
| --- | --- |
| `&speed=3` or `&speed=8` | run the race faster |
| `&at=lineup`, `&at=racing`, `&at=results` | start at that moment |
| `&control=` | hide the control panel |

The buttons at the top pause it and jump to the next moment. The preview has two cameras: **Wide**, which can be steered and has positions *Whole pool*, *Blocks* and *Finish line*; and **Finish**, which cannot.

If you can take screenshots of a web page, take one at each moment (`&at=lineup`, `&at=racing`, `&at=results`) and look at them. That is how you find the text that overflows, the board that covers the swimmers, the colour that cannot be read over water.

> Opened straight from disk, the preview's frames are a little less strict than Lanecast's, because a browser will not let the strict kind read local files; the page says so at the top. Served by any static web server (`python3 -m http.server` in the folder that holds `preview.html`) they are exactly as strict. The difference only matters if you broke [a rule of the frame](#the-rules-of-the-frame).

### In the app

The app follows a theme of the person's own on disk: **save a file and the stream reads it again**. Nobody has to press anything.

For a race to react to, the person turns on simulation: **Timer tab → Simulate**, **Events tab → Simulate → Fetch simulated events**, then **Stream tab → Run**. The simulated meet lines up a heat, races it with a split at every 50, shows results, and moves on, about every 35 to 55 seconds. To judge the graphics against their own pool, they add a simulated camera with a photo taken from where the camera stands.

What the theme logs with `Lanecast.log(…)`, and the app's notes about it (a camera or position name it did not recognise), appear in the **Console** on the Theme tab.

## Build in this order

Each step leaves something that works. Look at it in the preview before going on.

1. **The skeleton.** `theme.json`, and an `overlay.html` that loads the runtime and shows one thing from the state. This is a complete, working theme:

   ```html
   <!doctype html>
   <html lang="en">
   <head>
   <meta charset="utf-8">
   <style>
     html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; font-family: system-ui, sans-serif; }
     #bar { position: absolute; left: 4vw; bottom: 6vh; padding: 1.2vh 1.6vw; background: rgba(8, 14, 22, .86); color: white; font-size: 3vh; border-radius: .8vh; }
     #bar[hidden] { display: none; }
   </style>
   </head>
   <body>
   <div id="bar" hidden></div>
   <script src="../lanecast-theme.js"></script>
   <script>
     const bar = document.getElementById('bar');
     Lanecast.on('state', s => {
       bar.hidden = !s.event;                                   // nothing on the board: draw nothing
       if (s.event) bar.textContent = `${s.title || 'Event ' + s.event} · Heat ${s.heat} · ${s.clock}`;
     });
   </script>
   </body>
   </html>
   ```

2. **What is on the board.** Draw from `state`: the title, the clock, the lanes. Before the start show the lineup (lanes with a `name`); after, the finishers sorted by `place`. See [the state message](theme-messages.md#state).
3. **What just happened.** Animate from events: `heat.lineup`, `race.start`, `lane.split`, `lane.finish`, `heat.finish`, `event.finish`. See [events](theme-messages.md#events).
4. **The picture.** If it helps, cut cameras, shrink the picture beside a board, cue a camera position. See [directing](theme-cookbook.md#cut-cameras-with-the-race).
5. **A control panel**, only if a person should trigger something: show or hide a graphic, a sponsor, a manual cut.
6. **Settings**, for what changes from meet to meet: colours, a logo, the meet's name. A dialog page, saved by Lanecast per theme.

The two halves of every theme: **redraw from `state`** (it says what is true now, and a theme loaded mid-race gets it at once) and **animate from events** (they say what just happened, once each). Do not try to work out "the heat just finished" from `state`; there is an event for it. Do not rely on an event to know what is on the board; a theme can be switched on in the middle of a heat and will have missed it.

## The rules of the frame

Lanecast runs a theme's pages in frames that may run scripts and nothing more. These are not style advice; breaking one makes the theme fail in the app.

| Rule | What happens otherwise |
| --- | --- |
| No `alert`, `confirm` or `prompt` | They silently do nothing. Say it in the page |
| No `localStorage`, `sessionStorage`, cookies or IndexedDB | They throw. Keep choices with `Lanecast.saveSettings` |
| Everything the theme needs is in its folder | A pool's network is often poor or absent. No fonts, scripts or images from the internet |
| The overlay's background stays transparent | An opaque `html` or `body` background hides the camera |
| Do not set `color-scheme: dark` on the page | The frame stops being transparent |
| Size the overlay in `vh` and `vw` | The picture is shown at many sizes; pixel sizes will be wrong at most of them |
| Keep `state` handlers cheap | They run up to ten times a second. Rebuild elements only when what they show has changed, or animations restart every tick |
| Use the names and times as given | `clock`, lane `time` and `place` are what the timing console displays. Do not run a clock of your own or re-sort by time |
| The overlay cannot be clicked | Put anything clickable in the control panel |
| Draw nothing when `event` is empty | Between sessions the board is blank; an empty frame on screen looks broken |

Also expect data to be missing. Without start lists there are no names, no `title`, and `heats` is `0`; lanes still show times and places. A theme should look right with names and without.

## Done means

- [ ] `theme.json` has a name and a description that says which camera and position names the theme expects, if any
- [ ] Every page has the `../lanecast-theme.js` script tag, unchanged
- [ ] You looked at it at the lineup, mid-race and on the results, in the preview or the app
- [ ] It draws nothing when there is no event, and looks right when there are no names
- [ ] Long names fit: try a swimmer called `Maximiliana Featherstonehaugh-Okonkwo`
- [ ] Ten lanes fit, not just the six in the preview
- [ ] Text can be read over a bright pool: a solid or near-solid backing behind it, not text straight on the picture
- [ ] Nothing is loaded from the internet, and no rule of the frame is broken
- [ ] Camera and position names it uses are optional: with none of them set up, the theme still works
- [ ] You told the person which camera and position names to create, and anything you could not check

## When it does not work

| What you see | Usually | Do |
| --- | --- | --- |
| The overlay is blank and nothing ever draws | The runtime did not load, or a script threw before subscribing | Check the script tag is `../lanecast-theme.js` and comes before your own script; look at the browser's console in the preview |
| `Lanecast is not defined` | Your script runs before the runtime's tag, or the path was changed | Put the runtime's tag first |
| The camera picture has gone, a white or black page instead | An opaque background on `html` or `body`, or `color-scheme` was set | `background: transparent` on both; remove `color-scheme` |
| An animation restarts continuously | The element is rebuilt on every `state` | Rebuild only when the content changed ([cookbook](theme-cookbook.md#animate-once-not-ten-times-a-second)) |
| Names are missing | No start lists are loaded | That is normal; show lanes without names |
| A camera cut does nothing | No camera has that name | The preview's log and the Theme tab's console say so. Use the person's names, or check `state.cameras` first |
| Works in the preview opened from disk, fails in the app | A rule of the frame, most often storage or `alert` | Serve the preview over http to reproduce it; fix the rule |
| The control panel's button does nothing | The overlay is not listening, or listens for a different shape | The two ends must agree: `Lanecast.send({ action: 'x' })` and `Lanecast.on('control', m => { if (m.action === 'x') … })` |
| Settings are forgotten | They were kept in a variable or in storage | `Lanecast.saveSettings({ … })`, and apply them in `Lanecast.on('settings', …)` |
