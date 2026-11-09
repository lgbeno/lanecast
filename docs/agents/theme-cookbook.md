# Theme cookbook: working code for common things

Each recipe is complete enough to paste into a theme and see work in [the preview page](making-a-theme.md#seeing-your-work). They assume the page has loaded the runtime (`<script src="../lanecast-theme.js"></script>`) and use these two helpers:

```js
const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
```

Use `textContent`, never `innerHTML`, for anything that came from the meet: a swimmer's name is data, not markup.

**Recipes:** [the board](#the-board-lineup-before-results-after) · [animate once](#animate-once-not-ten-times-a-second) · [results board](#a-results-board-when-a-heat-finishes) · [splits](#flash-a-split) · [the winner](#call-the-winner) · [between events](#a-card-between-events) · [picture-in-picture](#picture-in-picture-beside-a-board) · [camera cuts](#cut-cameras-with-the-race) · [camera positions](#move-a-camera-to-a-saved-position) · [a control panel](#a-control-panel) · [settings](#colours-and-a-logo-the-person-can-change) · [fitting text](#make-long-names-fit) · [readable over water](#stay-readable-over-water)

Companions: [the brief for agents](making-a-theme.md) · [every message](theme-messages.md) · [the full reference](../themes.md)

## The board: lineup before, results after

Draw from `state`. Before the start, the lanes with a name; once anyone has finished, the finishers by place.

```html
<div id="board" hidden>
  <div id="head"><span id="title"></span><span id="clock"></span></div>
  <div id="rows"></div>
</div>
```

```js
Lanecast.on('state', s => {
  $('board').hidden = !s.event;                       // a blank scoreboard: draw nothing
  if (!s.event) return;
  $('title').textContent = s.title || `Event ${s.event}`;          // no start list: no title
  $('clock').textContent = s.clock || '0:00.0';
  const finished = s.lanes.filter(l => l.place !== null).sort((a, b) => a.place - b.place);
  const occupied = s.lanes.filter(l => l.name || l.time || l.followsClock);   // works with and without start lists
  const rows = (finished.length ? finished : occupied).map(l => {
    const row = el('div', 'row');
    row.append(el('span', 'pos', l.place !== null ? Lanecast.ordinal(l.place) : String(l.lane)),
               el('span', 'who', l.name ? `${l.name} · ${l.team}` : `Lane ${l.lane}`),
               el('span', 'time', l.time));
    return row;
  });
  draw($('rows'), rows);                              // see the next recipe
});
```

## Animate once, not ten times a second

`state` arrives up to ten times a second. If you rebuild elements each time, an entrance animation restarts each time and never finishes. Rebuild only when what you show has changed:

```js
function draw(container, rows) {
  const key = rows.map(r => r.textContent).join('|');
  if (key === container.dataset.key) return;          // nothing we show has changed
  container.dataset.key = key;
  container.replaceChildren(...rows);
}
```

The clock changes every tenth of a second, so keep it out of anything that animates: set its `textContent` directly, as above.

## A results board when a heat finishes

An event, not `state`: it happens once. Take the board down on a timer, and also when the next heat lines up, because a meet does not wait for your timer.

```html
<div id="results" class="card"><h2 id="resultsTitle"></h2><div id="resultsRows"></div></div>
```

```css
.card { position: absolute; left: 50%; top: 12vh; transform: translate(-50%, -3vh); width: 56vw; padding: 2vh 2vw; background: rgba(8, 14, 22, .92); color: white; border-radius: 1.2vh;
        opacity: 0; transition: opacity .4s, transform .4s; }
.card.show { opacity: 1; transform: translate(-50%, 0); }
```

```js
let resultsTimer = null;
const hideResults = () => { clearTimeout(resultsTimer); $('results').classList.remove('show'); };
Lanecast.on('heat.finish', e => {
  $('resultsTitle').textContent = `${e.title || 'Event ' + e.event} · Heat ${e.heat}`;
  $('resultsRows').replaceChildren(...e.results.map(r => {
    const row = el('div', 'row');
    row.append(el('span', 'pos', Lanecast.ordinal(r.place)), el('span', 'who', r.swimmer ? `${r.swimmer} · ${r.team}` : `Lane ${r.lane}`), el('span', 'time', r.time));
    return row;
  }));
  $('results').classList.add('show');
  clearTimeout(resultsTimer); resultsTimer = setTimeout(hideResults, 9000);
});
Lanecast.on('heat.lineup', hideResults);              // the next heat is up: do not cover it
Lanecast.on('race.start', hideResults);
```

## Flash a split

A 200 gives three of these a lane, a 100 one, a 50 none. Several lanes split within a second of each other, so give each lane its own element rather than one shared banner.

```js
Lanecast.on('lane.split', e => {
  const chip = el('div', 'split', `${e.lane}  ${e.swimmer || 'Lane ' + e.lane}  ${e.time}`);
  $('splits').append(chip);                           // #splits is a column in a corner; .split animates in with CSS
  setTimeout(() => chip.remove(), 3500);
});
Lanecast.on('race.reset', () => $('splits').replaceChildren());      // a false start: clear what was shown
```

## Call the winner

```js
Lanecast.on('lane.finish', e => {
  if (e.place !== 1) return;
  $('winner').textContent = e.swimmer ? `${e.swimmer} · ${e.time}` : `Lane ${e.lane} · ${e.time}`;
  $('winner').classList.add('show');
  setTimeout(() => $('winner').classList.remove('show'), 5000);
});
```

Finishes usually arrive in order, first place first, but check `e.place` rather than assume it.

## A card between events

`event.finish` needs start lists (the app must know which heat is the last), so also bring the card down on whatever comes next.

```js
Lanecast.on('event.finish', e => { $('sponsor').classList.add('show'); });
Lanecast.on('heat.lineup', () => $('sponsor').classList.remove('show'));
```

For a title card as each event begins, use `event.change`: `e.title` is the event's name, `e.heats` how many heats it has.

## Picture-in-picture beside a board

`Lanecast.layout` places the camera inside the frame, in fractions of the picture. Everything it leaves empty is yours to draw on. It animates over 0.4 seconds.

```js
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const CORNER = { x: .62, y: .06, w: .34, h: .34, fit: 'cover' };      // top right, a third the size
Lanecast.on('heat.finish', () => { Lanecast.layout(CORNER); /* …and show a board in the space */ });
Lanecast.on('heat.lineup', () => Lanecast.layout(FULL));
```

When the camera is shrunk, the frame behind it is black: draw a background for the board to sit on (a full-frame element behind your graphics), or the result is a small picture floating on black.

## Cut cameras with the race

Camera names are whatever the person typed on the Camera tab. A name nobody has is ignored (and noted, once, in the Theme tab's console), so a theme that names cameras still works for someone with one camera. If you want to do something else when a camera is missing, look in `state.cameras`:

```js
const has = name => !!Lanecast.state && Lanecast.state.cameras.some(c => c.name.toLowerCase() === name.toLowerCase());
Lanecast.on('race.start', () => Lanecast.camera('Finish'));
Lanecast.on('heat.finish', () => setTimeout(() => Lanecast.camera('Wide'), 6000));
Lanecast.on('heat.lineup', () => { if (has('Blocks')) Lanecast.camera('Blocks'); else Lanecast.camera('Wide'); });
```

Say in the theme's `description` which names it looks for, and tell the person.

## Move a camera to a saved position

A steerable camera has positions the person framed and named. A theme cues them by name; it never deals in angles. The camera needs a second or two to get there, so cue it a beat early, and if there is a second camera, cut to that while the first one travels.

```js
Lanecast.on('heat.lineup', () => Lanecast.position('Blocks'));
Lanecast.on('race.start',  () => Lanecast.position('Whole pool'));
Lanecast.on('lane.finish', e => { if (e.place === 1) Lanecast.position('Finish line'); });
```

`Lanecast.position(name)` moves **the camera on the program**. If the theme also cuts cameras, say which one to move, or the cue goes to whichever camera you just cut to (and is ignored if that one cannot be steered):

```js
Lanecast.on('race.start', () => { Lanecast.camera('Finish'); Lanecast.position('Whole pool', 'Wide'); });   // cut to Finish; meanwhile send Wide back to the whole pool
```

That is also how to hide a move: cut away, move the camera nobody is watching, and cut back when it has arrived. To offer the person a button for each position their camera has:

```js
Lanecast.on('state', s => {
  const on = s.cameras.find(c => c.id === s.camera), places = on ? on.positions : [];
  const key = places.join('|');
  if (key === $('places').dataset.key) return; $('places').dataset.key = key;
  $('places').replaceChildren(...places.map(name => { const b = el('button', '', name); b.onclick = () => Lanecast.position(name); return b; }));
});
```

## A control panel

A second page, `control.html`, named in `theme.json`. It gets the same `state` and events. It talks to the overlay with `Lanecast.send`; the shape of what you send is yours.

`control.html`:

```html
<button id="lanes" aria-pressed="true">Lane list</button>
<button id="sponsor">Show the sponsor</button>
<script src="../lanecast-theme.js"></script>
<script>
  const $ = id => document.getElementById(id);
  $('lanes').onclick = () => { const on = $('lanes').getAttribute('aria-pressed') !== 'true'; $('lanes').setAttribute('aria-pressed', String(on)); Lanecast.send({ action: 'lanes', on }); };
  $('sponsor').onclick = () => Lanecast.send({ action: 'sponsor' });
</script>
```

`overlay.html`:

```js
Lanecast.on('control', m => {
  if (m.action === 'lanes') $('rows').hidden = !m.on;
  if (m.action === 'sponsor') { $('sponsor').classList.add('show'); setTimeout(() => $('sponsor').classList.remove('show'), 8000); }
});
```

Design the panel like a phone screen: narrow, tall, one column, big buttons. It scrolls if it is long. Unlike the overlay it is not transparent; give it no background and it takes the app's dark one, so use light text.

A switch that should survive the theme being reloaded belongs in settings (next recipe), not in a variable.

## Colours and a logo the person can change

Keep what changes from meet to meet out of the code. `Lanecast.saveSettings` stores an object of your own design per theme, and every page of the theme gets it through `'settings'`: once at the start, and again after each save.

In the overlay, apply them:

```js
Lanecast.on('settings', s => {
  document.documentElement.style.setProperty('--accent', s.accent || '#ffcc33');   // your CSS uses var(--accent)
  $('meet').textContent = s.meet || '';
  $('logo').hidden = !s.logo;
  if (s.logo) $('logo').src = s.logo;
});
```

From the control panel, open a settings page as a dialog:

```js
$('settings').onclick = () => Lanecast.dialog('settings.html', { title: 'Theme settings', width: 520, height: 480 });
```

`settings.html` fills its form from the saved settings and saves on a button:

```html
<label>Accent colour <input id="accent" type="color"></label>
<label>Meet name <input id="meet"></label>
<label>Logo <input id="logoFile" type="file" accept="image/png,image/svg+xml,image/jpeg"></label>
<p id="note"></p>
<button id="save">Save</button> <button id="cancel">Cancel</button>
<script src="../lanecast-theme.js"></script>
<script>
  const $ = id => document.getElementById(id);
  let logo = '';
  Lanecast.on('settings', s => { $('accent').value = s.accent || '#ffcc33'; $('meet').value = s.meet || ''; logo = s.logo || ''; });
  $('logoFile').onchange = () => {
    const file = $('logoFile').files[0]; if (!file) return;
    if (file.size > 400 * 1024) { $('note').textContent = 'That image is over 400 KB; a smaller one, please.'; return; }   // say it in the page: alert() does nothing here
    const reader = new FileReader(); reader.onload = () => { logo = reader.result; }; reader.readAsDataURL(file);
  };
  $('save').onclick = () => { Lanecast.saveSettings({ accent: $('accent').value, meet: $('meet').value.trim(), logo }); Lanecast.closeDialog(); };
  $('cancel').onclick = () => Lanecast.closeDialog();
</script>
```

An image is saved as a data URL inside the settings, so keep it to a few hundred kilobytes. `saveSettings` merges: pass only what changed and the rest is kept.

## Make long names fit

Names vary more than you expect. Give every name a fixed box and let it shorten with an ellipsis, rather than letting it push the time off the row:

```css
.row { display: grid; grid-template-columns: 5vw 1fr 9vw; align-items: center; gap: 1vw; font-size: 2.6vh; }
.row .who { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.row .time { text-align: right; font-variant-numeric: tabular-nums; }       /* digits that do not jiggle as the time changes */
```

Check it with ten lanes and a long name, not only the preview's six short ones.

## Stay readable over water

The picture behind your graphics is a bright, moving pool. Text drawn straight onto it cannot be read.

- Put a solid or nearly solid backing behind all text: `rgba(8, 14, 22, .88)` or darker.
- Use white or a very light colour for text; keep the club's colour for accents, bars and rules.
- Keep graphics to the lower third and the corners. The swimmers are the picture.
- Sizes in `vh`: around `3vh` for the smallest text anyone must read on a phone.
- `font-variant-numeric: tabular-nums` on every clock and time.

## Try it

```
themes/preview.html?theme=your-folder                   the whole heat, in real time
themes/preview.html?theme=your-folder&at=lineup         stop and look: Pause, then Next moment
themes/preview.html?theme=your-folder&at=results&speed=3
```

The log under the picture shows each camera cut, layout, position and saved setting the theme asked for, and says when one would have been ignored.
