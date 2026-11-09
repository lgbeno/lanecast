---
name: lanecast-theme
description: Make or change a Lanecast theme — the graphics drawn over a swim-meet stream, how they react to the race (heat lined up, race start, lane and heat finishes), which camera is on and where, and the theme's control panel. Use when someone asks for a stream overlay, lower third, results board, scoreboard graphic, sponsor card, camera cut or control button for Lanecast.
---

# Lanecast themes

A theme is a folder: `theme.json`, `overlay.html` (drawn over the picture), optionally `control.html` (a panel in the Stream tab), plus any css/js/images. Read `docs/themes.md` in the Lanecast repository for the full message reference; this is the short form.

## Start

- A new theme: copy `themes/template/` into the user's themes folder (Theme tab → Open my themes folder; or they press **New theme from the template**). Give it a name in `theme.json`.
- An existing theme: edit it in place. Built-in themes under `themes/` in the repository are examples; the user's are in the app's data folder.
- Keep this script tag in every page, exactly: `<script src="../lanecast-theme.js"></script>`.
- After changes, the user presses **Reload** on the Theme tab (or switches theme and back).

## The interface (everything there is)

```js
Lanecast.on('state', s => …)        // s: { event, heat, heats, title, clock, running, phase, lanes[10], cameras, camera }
Lanecast.on('heat.lineup', e => …)  // e.lanes: [{ lane, swimmer, team }]
Lanecast.on('race.start', e => …)
Lanecast.on('race.reset', e => …)
Lanecast.on('lane.split', e => …)   // lane, swimmer, team, time
Lanecast.on('lane.finish', e => …)  // lane, swimmer, team, place, time
Lanecast.on('heat.finish', e => …)  // results: [{ place, lane, swimmer, team, time }] by place
Lanecast.on('event.finish', e => …) // event, title, heats
Lanecast.on('event.change', e => …)
Lanecast.on('control', m => …)      // overlay: a message from the control panel
Lanecast.on('overlay', m => …)      // control panel: a message from the overlay
Lanecast.camera('Finish')           // cut to a camera by the name the user gave it (or id)
Lanecast.layout({ x, y, w, h, fit })// place the camera, fractions 0–1; fit 'contain' | 'cover'
Lanecast.position('Finish line')    // steer the program camera (PTZ) to a position the user saved under that name;
                                    // Lanecast.position('Blocks', 'Wide') for another camera. state.cameras[i] = { id, name, steerable, positions: [names] }
Lanecast.send({ … })                // to the theme's other pages, as on('overlay'|'control'|'dialog')
Lanecast.dialog('settings.html', { title, width, height })   // pop out a page as a modal; Lanecast.closeDialog() closes it
Lanecast.saveSettings({ … }); Lanecast.on('settings', s => …)   // the theme's own saved settings, per theme, across runs
Lanecast.log(…)                     // Theme tab console
Lanecast.ordinal(3)                 // "3rd"
```

`lanes[i]`: `{ lane, name, team, time, place (number|null), followsClock }`. `phase`: `idle | lineup | racing | finished`. Names are "First Last".

## How to build one well

1. Draw with HTML and CSS. Size in `vh`/`vw`: the overlay frame is the picture (16:9) and scales with the stream. Transparent background; draw only what should be seen.
2. Redraw from `state` (what is on the board) and animate from events (what just happened). Rebuild DOM only when the content changed; `state` arrives ten times a second.
3. Before the start, show the lineup (`lanes` with a `name`); during, splits as they appear; after, finishers sorted by `place`. `heat.finish` is the moment for a results board; `event.finish` for a summary or sponsor card.
4. Direct the picture if it helps: `race.start` → `Lanecast.camera('Finish')`; `heat.finish` → back to `'Wide'` after a few seconds; `Lanecast.layout` for picture-in-picture while a board is up. Camera names are whatever the user typed; match them to the user's setup or make them configurable in the control panel.
   A steerable camera can also be moved: cue the user's named positions from events (`heat.lineup` → `Lanecast.position('Blocks')`, `race.start` → `'Whole pool'`, first `lane.finish` → `'Finish line'`). Only names, never pan/tilt numbers; the camera needs a second or two to travel, so cue early. Use the names in `state.cameras[i].positions`, and tell the user which names the theme expects them to save.
5. A control panel is for things a person should trigger: show/hide a graphic, a sponsor, a manual cut. It lives in a drawer down the right of the Stream tab, portrait like a phone and as tall as the picture: stack controls vertically, set `control.width` in `theme.json`, leave `height` out so the page fills the drawer (it scrolls if taller).
6. Detailed configuration (colours, logos, titles) goes in a dialog page popped out from the control panel, saved with `saveSettings` and applied by the overlay on `'settings'`; see `themes/template/settings.html`.
7. Test with everything simulated (Stream tab → Simulation control → Run): the simulated meet fires every event every 30–40 s. For the real view, Camera tab → Simulate a camera → a photo from the camera position.

## Don'ts

- No other script loading paths for the runtime; no `localStorage`, no network calls from the frame (it is sandboxed).
- Don't block in handlers; don't rebuild everything on every `state`.
- Don't invent fields or expect other scoreboard JSON formats; the messages above are the whole interface.
