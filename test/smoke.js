/* Starts the app with everything simulated, drives it the way a user would, and checks what shows.
 * Saves a screenshot per tab when given a .png path.
 *
 *   npx electron test/smoke.js [screenshot.png]
 */
'use strict';
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

// A settings file as a previous session would have left it: everything simulated, a photo as the camera.
// Nothing is simulated by default; this is how the choice persists from session to session.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lanecast-smoke-'));
app.setPath('userData', userData);
process.env.LANECAST_DELETE = '1';                  // a theme removed in this run is deleted, not sent to this computer's Trash
// The project saved last time has since been deleted: the app must still start (it once died on this line), untitled again.
fs.writeFileSync(path.join(userData, 'lanecast.json'), JSON.stringify({ simulate: { timer: true, events: true }, relayPort: 18080, projectPath: path.join(userData, 'Gone.lanecast'),
    cameras: [{ id: 'cam-pool', name: 'Pool', url: '', simulate: true, media: { path: path.join(__dirname, '..', 'build', 'icon.png') } }] }));
require('../src/main/main');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const shot = process.argv.find(a => a.endsWith('.png'));
let failed = false;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failed = true; };

app.on('browser-window-created', (event, win) => {
    win.webContents.on('console-message', e => console.log('[renderer]', e.message ?? ''));
    win.webContents.once('did-finish-load', async () => {
        const js = code => win.webContents.executeJavaScript(code);
        const text = id => `document.getElementById(${JSON.stringify(id)}).textContent`;
        const dots = `Object.fromEntries(['stream','timer','events','cameras','theme'].map(t => [t, document.getElementById('tab-' + t).firstElementChild.dataset.ready === 'true']))`;
        const badges = `[...document.querySelectorAll('.tabs .sim-badge')].filter(b => !b.hidden).map(b => b.parentElement.id.slice(4)).join(',')`;
        const click = async (id, ms = 300) => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await wait(ms); };
        await wait(2500);
        const received = [];
        const socket = new WebSocket('ws://127.0.0.1:18080/');       // the port from the settings file, clear of a Lanecast that may be running
        socket.on('message', data => received.push(JSON.parse(String(data))));
        socket.on('error', e => console.log('overlay socket error', e.message));

        // Everything simulated at start: the pretend console connects by itself, no port controls show.
        const start = await js(`({ timer: ${text('timerStatus')}, timerControls: document.getElementById('timerPort').parentElement.hidden, simPanel: !document.getElementById('simConsole').hidden && document.getElementById('timer').querySelector('.sim-panel') === null,
            meet: ${text('meetStatus')}, fetch: !document.getElementById('fetchSim').hidden && document.getElementById('loadFiles').hidden && document.getElementById('saveFiles').hidden, camSim: document.querySelectorAll('.tile .camSim:checked').length === 1, camAdd: !document.getElementById('camAdd').hidden,
            badges: ${badges}, shown: document.querySelector('[role=tabpanel]:not([hidden])').id, error: document.getElementById('error').hidden ? '' : ${text('error')},
            label: ${text('camerasLabel')}, bar: [...document.querySelector('.topbar').children].filter(c => !c.hidden).map(c => c.id || c.className.split(' ').pop()).join('+'), barHeight: document.querySelector('.topbar').offsetHeight,
            drawer: !document.getElementById('drawer').hidden, toggle: !document.getElementById('drawerToggle').hidden,
            fits: document.getElementById('stage').getBoundingClientRect().bottom <= window.innerHeight && document.documentElement.scrollHeight <= window.innerHeight + 1, banner: !!document.getElementById('banner'), follow: !!document.getElementById('follow') })`);
        check(start.label === 'Camera' && start.bar === 'group+simConsole' && start.barHeight < 76 && !start.drawer && !start.toggle, `Camera tab singular; one thin bar with the stream and simulation controls (${start.barHeight}px), no drawer for Classic`);
        check(start.fits && !start.banner && !start.follow, `the Stream tab fits the window with no scrolling, no banner, no Show latest`);
        console.log(JSON.stringify(start, null, 1));
        check(start.shown === 'stream', 'the Stream tab is shown first: ' + start.shown);
        check(start.badges === 'timer,events,cameras', 'the settings file is honoured: Sim badges on Timer, Events and Cameras, none on Stream: ' + start.badges);
        check(/^Simulated · the pretend console is connected · its controls are on the Stream tab/.test(start.timer) && start.timerControls && start.simPanel, 'timer: pretend console connected, port controls gone, a note that the controls are on the Stream tab');
        check(/^Simulated/.test(start.meet) && start.fetch, 'events: no port, Fetch simulated events in place of Load and Save');
        check(start.camSim && start.camAdd, 'cameras: the saved camera is simulated by its own switch; Add a camera stays');
        check(!start.error, 'no error shown: ' + start.error);

        // Events: fetch a made-up meet; it becomes the console's schedule.
        await click('fetchSim', 800);
        const events = await js(`({ loaded: Number(${text('eventsLoaded')}), status: ${text('fileStatus')}, ready: ${dots} })`);
        check(events.loaded === 12 && events.ready.events, `fetched 12 simulated events: ${events.status}`);

        // Simulation control, above the program: queue the second loaded event, then Run.
        await click('simEventUp', 600);
        const queued = await js(`({ event: ${text('event')}, summary: ${text('simSummary')}, running: document.getElementById('simRun').getAttribute('aria-pressed') })`);
        check(queued.event === '2 / 1' && queued.running === 'false', `event 2 heat 1 queued: ${queued.event}`);
        await click('simRun', 9500);                                                   // through the 8 s lineup into the race
        const running = await js(`({ running: document.getElementById('simRun').getAttribute('aria-pressed'), summary: ${text('simSummary')}, state: ${text('raceState')}, event: ${text('event')} })`);
        check(running.running === 'true' && running.event === '2 / 1' && running.state === 'RUNNING', `Run from the queued heat, racing: ${running.event} · ${running.state}`);
        // Events: click a lane in the start list and rename the swimmer.
        await js(`document.getElementById('tab-events').click(); document.getElementById('viewEventNo').value = 1; document.getElementById('viewEventNo').dispatchEvent(new Event('change'))`); await wait(400);
        await js(`document.querySelector('#startList tr[data-lane]').click()`); await wait(200);
        const edited = await js(`(() => { const name = document.querySelector('#startList input.edit'); if (!name) return { name: null }; const lane = Number(name.closest('tr').dataset.lane); name.value = 'Renamed, Pat'; name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return { lane }; })()`);
        await wait(300);
        const after = await js(`({ cell: document.querySelectorAll('#startList tr')[${edited.lane ?? 0}].children[1].textContent, inputs: document.querySelectorAll('#startList input').length })`);
        check(edited.lane !== undefined && after.cell === 'Pat Renamed' && after.inputs === 0, `a start-list lane renamed in place: ${after.cell}`);
        await js(`document.getElementById('tab-stream').click()`); await wait(300);
        await wait(4000);
        const r = await js(`({ timer: ${text('timerStatus')}, clock: ${text('clock')}, event: ${text('event')}, relay: ${text('relayStatus')}, clients: ${text('clients')}, packets: ${text('packets')}, ready: ${dots} })`);
        check(/^\d:\d\d\.\d$/.test(r.clock) && r.ready.timer, 'clock shows a time and the Timer dot is green: ' + r.clock);
        check(/^Listening/.test(r.relay) && r.clients === '1', 'overlay feed listening with the test overlay counted: ' + r.relay);
        check(Number(r.packets) >= 5 && received.length >= 5 && received.every(m => m.type === 'state' || m.type === 'event') && received.some(m => m.type === 'event' && m.name === 'race.start'), `packets published and received, states and events: ${r.packets} / ${received.length}, events ${received.filter(m => m.type === 'event').map(m => m.name).join(',')}`);
        check(received.some(p => p.lanes.some(l => l.name)), 'packets carry names from the start lists');

        // Cameras: the saved camera's stand-in photo plays, without ffmpeg; the program shows it.
        const cams = await js(`({ tiles: document.querySelectorAll('.tile').length, status: [...document.querySelectorAll('.tile .small')].map(s => s.textContent), engine: ${text('engineStatus')}, ready: ${dots},
            program: document.getElementById('programVideo').videoWidth, note: document.getElementById('stageNote').hidden, bug: document.getElementById('overlayFrame').src.startsWith('theme://b-classic/overlay.html'), pstatus: ${text('programStatus')}, theme: ${text('themeStatus')}, name: document.querySelector('.tile .name').textContent, badge: !document.querySelector('.tile .sim-badge').hidden })`);
        check(cams.tiles === 1 && cams.name === 'Pool' && cams.badge && /^Stand-in · 1280×720/.test(cams.status[0]), `the camera Pool shows its stand-in photo, live, with a Sim badge: ${cams.status.join(' / ')}`);
        // The Camera tab looks for cameras by itself the first time it is opened: this computer's and the network's, in one list.
        await js(`document.getElementById('tab-cameras').click()`); await wait(300);
        const looking = await js(`({ busy: document.getElementById('findDevices').disabled, status: ${text('searchStatus')}, bar: !document.getElementById('searchProgress').hidden && !!document.querySelector('#searchProgress i') })`);
        let auto; for (let i = 0; i < 50; i++) { await wait(300); auto = await js(`({ busy: document.getElementById('findDevices').disabled, status: ${text('searchStatus')}, items: document.querySelectorAll('#foundList .found-item').length, barGone: document.getElementById('searchProgress').hidden, manual: !!document.getElementById('manualAdd'), dialog: document.getElementById('manualDialog').open, columns: [document.getElementById('camAdd').getBoundingClientRect().x, document.querySelector('.camera-have').getBoundingClientRect().x] })`); if (!auto.busy) break; }
        check(looking.busy && looking.status === 'Searching for network cameras…' && looking.bar && !auto.busy && auto.barGone && /^\d+ found$|^None found$/.test(auto.status), `opening the Camera tab searches by itself, with a progress bar and a message while it does, and finishes: ${auto.status}, ${auto.items} listed`);
        check(auto.manual && !auto.dialog && auto.columns[0] < auto.columns[1], 'finding is on the left, the cameras on the right; adding by hand waits behind Add manually…');
        // When this computer's network changes, the search runs again by itself: nobody has to press Find cameras after fixing an adapter.
        win.webContents.send('cameras:network'); await wait(400);
        const again = await js(`({ busy: document.getElementById('findDevices').disabled, status: ${text('searchStatus')} })`);
        for (let i = 0; i < 50 && await js(`document.getElementById('findDevices').disabled`); i++) await wait(300);
        check(again.busy && again.status === 'Searching for network cameras…' && /^\d+ found$|^None found$/.test(await js(text('searchStatus'))), 'a change in the network starts the search again by itself');
        // A second camera, by hand: Add manually… opens the dialog, Add closes it; the tab turns plural.
        await js(`document.getElementById('manualAdd').click()`); await wait(300);
        const manual = await js(`({ open: document.getElementById('manualDialog').open, fields: [...document.getElementById('manualDialog').querySelectorAll('input')].map(i => i.id).join() })`);
        await js(`document.getElementById('camName').value = 'Finish'; document.getElementById('camUrl').value = 'rtsp://127.0.0.1:1/none'`); await click('camAddButton', 300);
        for (let i = 0; i < 30 && await js(`document.getElementById('manualDialog').open`); i++) await wait(300);          // the camera engine takes the address, a moment or several
        await wait(600);
        check(manual.open && manual.fields === 'camName,camUrl' && !(await js(`document.getElementById('manualDialog').open`)), 'Add manually… is just a name and an address; adding closes it');
        const stacked = await js(`[...document.querySelectorAll('#cameraList .tile')].map(t => { const r = t.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })`);
        check(stacked.length === 2 && stacked[0][0] === stacked[1][0] && stacked[1][1] > stacked[0][1], `the cameras are stacked one under another, not side by side: ${JSON.stringify(stacked)}`);
        // The found list always offers a simulated camera. Add opens its settings; ✕ in the corner of its box removes it, asking once more in place.
        const tileNames = () => js(`[...document.querySelectorAll('#cameraList .tile .name')].map(n => n.textContent)`);
        const removeTile = async name => { const pick = `[...document.querySelectorAll('#cameraList .tile')].find(t => t.querySelector('.name').textContent === ${JSON.stringify(name)}).querySelector('.remove')`; await js(`${pick}.click()`); await wait(200); const asked = await js(`${pick}.textContent`); await js(`${pick}.click()`); await wait(1200); return asked; };
        const offer = await js(`(() => { const item = document.querySelector('#foundList .found-item.simulated'); if (!item) return null; const out = { name: item.querySelector('strong').textContent, last: item === document.querySelector('#foundList').lastElementChild }; item.querySelector('button').click(); return out; })()`); await wait(1500);
        const simAdded = await js(`({ dialog: document.getElementById('cameraDialog').open, title: ${text('cameraDialogTitle')}, removeInside: !!document.getElementById('cdRemove') })`);
        await js(`document.getElementById('cdCancel').click()`); await wait(300);
        check(offer && offer.name === 'Simulated camera' && offer.last && simAdded.dialog && simAdded.title === 'Simulated camera' && (await tileNames()).join() === 'Pool,Finish,Simulated camera', 'the found list offers a simulated camera; Add makes one and opens its settings');
        const cornered = await js(`(() => { const t = [...document.querySelectorAll('#cameraList .tile')].at(-1), b = t.querySelector('.remove').getBoundingClientRect(), box = t.getBoundingClientRect(); return { right: Math.round(box.right - b.right), top: Math.round(b.top - box.top) }; })()`);
        const confirmText = await removeTile('Simulated camera');
        check(!simAdded.removeInside && cornered.right >= 0 && cornered.right < 30 && cornered.top >= 0 && cornered.top < 30 && confirmText === 'Remove?' && (await tileNames()).join() === 'Pool,Finish', `Remove is in the upper right corner of the camera's box (${cornered.right}px from the right, ${cornered.top}px from the top), asks once more, then removes`);
        // The found list follows: a camera added from it reads Added, and is offered again once removed.
        const foundButton = `[...document.querySelectorAll('#foundList .found-item:not(.simulated) .found-head')].map(h => ({ name: h.querySelector('strong').textContent, button: h.querySelector('button')?.textContent || '' }))`;
        const listed = (await js(foundButton)).find(f => f.button === 'Add');
        if (!listed) console.log('SKIP the found list following a removal: nothing addable was found on this computer or network');
        else {
            await js(`[...document.querySelectorAll('#foundList .found-item:not(.simulated) .found-head')].find(h => h.querySelector('strong').textContent === ${JSON.stringify(listed.name)}).querySelector('button').click()`); await wait(2500);
            const afterAdd = (await js(foundButton)).find(f => f.name === listed.name).button, had = (await tileNames()).includes(listed.name);
            await removeTile(listed.name); await wait(600);
            const afterRemove = (await js(foundButton)).find(f => f.name === listed.name).button;
            check(had && afterAdd === 'Added' && afterRemove === 'Add' && (await tileNames()).join() === 'Pool,Finish', `${listed.name}: Add in the found list reads Added; removed, it is offered again`);
        }
        const two = await js(`({ label: ${text('camerasLabel')}, tiles: [...document.querySelectorAll('.tile .name')].map(n => n.textContent), status: ${text('camAddStatus')} })`);
        check(two.label === 'Cameras' && two.tiles.join(',') === 'Pool,Finish', `a second camera: tab reads Cameras, tiles ${two.tiles.join(' and ')}`);
        // Steering: a stand-in camera at that address answers the version question, so the tile grows its controls, and they send.
        const steered = [], stand = require('node:dgram').createSocket('udp4');
        let at = 1;                                      // the stand-in says where it points too: pan 0x0<at>23 (the test moves it), tilt 0x0045, zoom 0x1234, focus 0xabcd in autofocus
        stand.on('message', (buf, from) => { const hex = buf.toString('hex'); steered.push(hex); const reply = hex === '81090002ff' ? '905002010607101501ff' : hex === '81090612ff' ? `9050000${at}020300000405ff` : hex === '81090447ff' ? '905001020304ff' : hex === '81090448ff' ? '90500a0b0c0dff' : hex === '81090438ff' ? '905002ff' : null; const say = text => stand.send(Buffer.from(text, 'hex'), from.port, from.address); if (reply) say(reply); else if (hex.startsWith('8101')) { say('9041ff'); say('9051ff'); } });      // questions answered; commands acknowledged and reported done
        const standing = await new Promise(resolve => { stand.once('error', () => resolve(false)); stand.bind(1259, '127.0.0.1', () => resolve(true)); });
        if (!standing) console.log('SKIP steering: UDP 1259 is in use on this computer');
        else {
            const finishTile = `[...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish')`;
            await js(`document.getElementById('findDevices').click()`);                                    // Find cameras asks every camera again
            let shown = false; for (let i = 0; i < 40 && !shown; i++) { await wait(300); shown = await js(`!${finishTile}.querySelector('.ptz').hidden && !document.getElementById('findDevices').disabled`); }
            const poolHidden = await js(`[...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Pool').querySelector('.ptz').hidden`);
            check(shown && poolHidden, 'a camera that answers the steering question shows pan, tilt, zoom and positions on its tile; the stand-in camera does not');
            await js(`(() => { const keys = [...${finishTile}.querySelectorAll('.ptz button')]; const right = keys.find(b => b.textContent === '▶'); right.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true })); setTimeout(() => right.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })), 450); })()`); await wait(900);
            await wait(300);
            const drives = steered.filter(m => m === '810106010a010203ff').length, moved = steered.filter(m => m !== '81090002ff');
            check(drives >= 2 && moved.includes('8101060101010303ff') && moved.indexOf('8101060101010303ff') > moved.indexOf('810106010a010203ff'), `holding ▶ drives right at the chosen speed, renewed while held (${drives} times), and letting go stops`);
            // Positions have names. Saving one reads where the camera points and keeps that; nothing is stored in the camera.
            const QUESTIONS = ['81090002ff', '81090612ff', '81090447ff', '81090448ff', '81090438ff'];
            const sentSince = from => steered.slice(from).filter(m => !QUESTIONS.includes(m));
            // Going to a position: manual focus, the absolute move to pan 0x0<pan>23 and tilt 0x0045, zoom 0x1234 with focus 0xabcd in one command, and autofocus again once the camera says it is done.
            const goes = pan => `8101043803ff,810106021814000${pan}020300000405ff,81010447010203040a0b0c0dff,8101043802ff`, ARRIVES = 900;
            const saveAs = async (scope, name) => { await js(`(() => { const root = ${scope}; root.querySelector('.ptzAdd').click(); const input = root.querySelector('.ptz-save input'); input.value = ${JSON.stringify(name)}; input.dispatchEvent(new Event('input')); root.querySelector('.ptz-save .primary').click(); })()`); await wait(900); };
            const chips = scope => js(`[...${scope}.querySelectorAll('.ptzPlace')].map(b => b.textContent)`);
            const press = (scope, name) => js(`[...${scope}.querySelectorAll('.ptzPlace')].find(b => b.dataset.position === ${JSON.stringify(name)}).click()`);
            let mark = steered.length;
            await saveAs(finishTile, 'Finish line'); at = 2; await saveAs(finishTile, 'Blocks');
            check((await chips(finishTile)).join() === 'Finish line,Blocks' && sentSince(mark).length === 0 && steered.slice(mark).filter(m => m === '81090612ff').length === 2, 'two positions saved by name on the tile: the camera is asked where it points, and nothing is stored in it');
            mark = steered.length; await press(finishTile, 'Finish line'); await wait(ARRIVES);
            check(sentSince(mark).join() === goes(1), `pressing a position sets the camera off to the pan and tilt it was saved at, with zoom and focus together, and hands back to autofocus when it arrives: ${sentSince(mark).join(' ')}`);
            // The Stream tab: Camera control appears beside Theme controls and steers from there, with the same positions.
            await js(`document.getElementById('tab-stream').click()`); await wait(400);
            const offered = await js(`({ button: !document.getElementById('cameraControlToggle').hidden, panel: !document.getElementById('cameraPanel').hidden })`);
            await js(`document.getElementById('cameraControlToggle').click()`); await wait(400);
            const panel = `document.getElementById('cameraPanel')`;
            const open = await js(`({ shown: !${panel}.hidden, name: document.getElementById('cameraPanelName').textContent, arrows: [...${panel}.querySelectorAll('.ptz button')].slice(0, 4).map(b => b.textContent).join(''), pressed: document.getElementById('cameraControlToggle').getAttribute('aria-pressed') })`);
            check(offered.button && !offered.panel && open.shown && open.name === 'Finish' && open.arrows === '◀▲▼▶' && open.pressed === 'true' && (await chips(panel)).join() === 'Finish line,Blocks', `the Stream tab offers Camera control; its panel steers ${open.name} with the same positions`);
            mark = steered.length; await press(panel, 'Blocks'); await wait(ARRIVES);
            check(sentSince(mark).join() === goes(2), 'a position pressed on the Stream tab sends the camera there');
            // A theme cues a position by its name, whatever the case; a name the camera does not have is noted, not sent.
            const overlayFrame = win.webContents.mainFrame.framesInSubtree.find(f => f.url.includes('/overlay.html'));
            mark = steered.length;
            await overlayFrame.executeJavaScript(`Lanecast.position('finish LINE', 'Finish'); Lanecast.position('Nowhere', 'Finish'); Lanecast.position('Blocks', 'Pool'); true`); await wait(ARRIVES);
            const noted = await js(`document.getElementById('themeLog').textContent`);
            check(sentSince(mark).join() === goes(1) && /no position named "Nowhere"/.test(noted) && /Pool cannot be steered/.test(noted), `a theme cues a position by name (Lanecast.position); unknown names and cameras that cannot be steered are noted in the theme console`);
            const packet = await overlayFrame.executeJavaScript(`JSON.stringify(Lanecast.state.cameras)`);
            check(/"name":"Finish","steerable":true,"positions":\["Finish line","Blocks"\]/.test(packet) && /"name":"Pool","steerable":false,"positions":\[\]/.test(packet), 'the state message tells themes which cameras can be steered and their position names');
            // A theme may also drive the camera itself (to follow something): it steers while the calls keep coming, and is stopped when they cease.
            mark = steered.length;
            await overlayFrame.executeJavaScript(`Lanecast.steer({ pan: 0.5, zoom: -0.5 }, 'Finish'); Lanecast.steer({ pan: 1 }, 'Pool'); true`); await wait(400);
            const driving = sentSince(mark).join();
            await wait(1100);
            check(driving === '810106010c010203ff,8101040734ff' && sentSince(mark).join() === '810106010c010203ff,8101040734ff,8101060101010303ff,8101040700ff', `a theme steers a camera (Lanecast.steer); when it stops saying so, the camera is stopped: ${sentSince(mark).join(' ')}`);
            await js(`document.getElementById('cameraPanelClose').click(); document.getElementById('tab-cameras').click()`); await wait(400);
            // Edit…: re-teach a position to where the camera points now; remove another; neither moves the camera. Then Home.
            const editing = (name, button) => js(`(() => { const root = ${finishTile}; if (root.querySelector('.ptzEdit').textContent !== 'Done') root.querySelector('.ptzEdit').click(); [...root.querySelectorAll('.ptzPlace')].find(b => b.dataset.position === ${JSON.stringify(name)}).click(); const label = root.querySelector('.ptz-save .primary').textContent; root.querySelector(${JSON.stringify(button)}).click(); return label; })()`);
            mark = steered.length;
            at = 3; const label = await editing('Finish line', '.ptz-save .primary'); await wait(900);
            const quiet = sentSince(mark).length === 0;
            await js(`${finishTile}.querySelector('.ptzEdit').click()`); await wait(200); mark = steered.length;
            await press(finishTile, 'Finish line'); await wait(ARRIVES);
            check(label === 'Re-teach here' && quiet && sentSince(mark).join() === goes(3), `Edit… then a position offers Re-teach here: it now goes to where the camera pointed when re-taught (${sentSince(mark)[1]})`);
            mark = steered.length;
            await editing('Blocks', '.ptz-save .ptzRemove'); await wait(900);
            await js(`(() => { const root = ${finishTile}; root.querySelector('.ptzEdit').click(); [...root.querySelectorAll('.ptz button')].find(b => b.textContent === 'Home').click(); })()`); await wait(400);
            check((await chips(finishTile)).join() === 'Finish line' && sentSince(mark).join() === '81010604ff' && await js(`document.getElementById('cameraPanel').hidden`), 'a position is removed from the tile without moving the camera; Home goes home; the panel closes');
            stand.close();
        }
        await js(`[...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish').querySelector('.camSim').click()`); await wait(1200);
        const finish = await js(`(() => { const t = [...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish'); return { badge: !t.querySelector('.sim-badge').hidden, status: t.querySelector('.small').textContent, tabBadge: ${badges} }; })()`);
        check(finish.badge && /^No stand-in yet/.test(finish.status), `Finish switched to simulated on its own: ${finish.status}`);
        await js(`[...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish').querySelector('.gear').click()`); await wait(400);
        const dlg = await js(`({ open: document.getElementById('cameraDialog').open, name: document.getElementById('cdName').value, url: document.getElementById('cdUrl').value, sim: document.getElementById('cdSimulate').checked })`);
        check(dlg.open && dlg.name === 'Finish' && dlg.url === 'rtsp://127.0.0.1:1/none' && dlg.sim, 'its settings dialog shows name, address and the switch');
        await js(`document.getElementById('cdName').value = 'Finish line'; document.getElementById('cdSimulate').checked = false`); await click('cdSave', 1200);
        const renamed = await js(`({ open: document.getElementById('cameraDialog').open, tiles: [...document.querySelectorAll('.tile .name')].map(n => n.textContent), sims: document.querySelectorAll('.tile .camSim:checked').length, select: [...document.getElementById('programCamera').options].map(o => o.text).join(',') })`);
        check(!renamed.open && renamed.tiles.join(',') === 'Pool,Finish line' && renamed.sims === 1 && renamed.select === 'Pool,Finish line', `saved: renamed to Finish line, back to real; the program camera list follows`);
        await removeTile('Finish line');
        check(await js(`document.querySelectorAll('.tile').length === 1 && ${text('camerasLabel')} === 'Camera'`), 'removed from the corner of its box; tab reads Camera again');
        // Search the network: whatever is out there today, the search finishes and says what it found, with any fix written out.
        await js(`document.getElementById('findDevices').click()`);
        let search; for (let i = 0; i < 40; i++) { await wait(300); search = await js(`({ busy: document.getElementById('findDevices').disabled, status: ${text('searchStatus')}, rows: document.querySelectorAll('#foundList .found-item').length, none: document.querySelectorAll('#foundList > p').length, fixes: [...document.querySelectorAll('#foundList .fix code')].map(c => c.textContent) })`); if (!search.busy) break; }
        check(!search.busy && /^\d+ found$|^None found$/.test(search.status) && (search.rows > 0 || search.none >= 1) && search.fixes.every(f => /\d+\.\d+\.\d+\.\d+/.test(f)), `Find cameras looks in both places and finishes: ${search.status}${search.fixes.length ? ' · fix: ' + search.fixes.join(' | ') : ''}`);
        // A camera on this computer, when there is one: open, Disconnect from the tile, Reconnect, open again.
        const device = await js(`navigator.mediaDevices.enumerateDevices().then(ds => ds.find(d => d.kind === 'videoinput' && d.deviceId) || null).then(d => d && { id: d.deviceId, label: d.label })`);
        const cameraAccess = device ? await js(`window.lanecast.cameras.access()`) : 'none';
        if (device && cameraAccess !== 'granted') console.log(`SKIP opening a camera on this computer: camera access is ${cameraAccess} for this run`);
        else if (device) {
            const local = await js(`window.lanecast.cameras.add({ name: 'Local', url: 'device:' + ${JSON.stringify(device.id)}, deviceLabel: ${JSON.stringify(device.label)} })`);
            const tileOf = `[...document.querySelectorAll('.tile')].find(t => t.dataset.id === ${JSON.stringify(local.id)})`;
            const state = () => js(`(t => t ? { status: t.querySelector('.small').textContent, button: t.querySelector('.reconnect').textContent, hidden: t.querySelector('.reconnect').hidden } : { status: '', button: '', hidden: true })(${tileOf})`);     // the tile appears at the next refresh
            let s; for (let i = 0; i < 40 && !(s = await state()).status.startsWith('Live'); i++) await wait(250);
            check(s.status.startsWith('Live') && s.button === 'Disconnect' && !s.hidden, `a camera on this computer opens; its tile offers Disconnect: ${s.status}`);
            await js(`${tileOf}.querySelector('.reconnect').click()`); await wait(400); s = await state();
            check(/^Disconnected · by you/.test(s.status) && s.button === 'Reconnect', `Disconnect from the tile lets it go: ${s.status} / ${s.button}`);
            await js(`${tileOf}.querySelector('.reconnect').click()`);
            for (let i = 0; i < 40 && !(s = await state()).status.startsWith('Live'); i++) await wait(250);
            check(s.status.startsWith('Live') && s.button === 'Disconnect', `Reconnect opens it again: ${s.status}`);
            await js(`window.lanecast.cameras.remove(${JSON.stringify(local.id)})`); await wait(1500);
        } else console.log('SKIP no camera on this computer to open');
        await js(`document.getElementById('tab-stream').click()`); await wait(1500);
        check(/^Camera engine running/.test(cams.engine), 'camera engine running: ' + cams.engine);
        const pixel = await js(`(() => { const v = document.getElementById('programVideo'), c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++; return lit; })()`);
        check(pixel > 200, `the photo is actually drawn (lit pixels in the program: ${pixel})`);
        await js(`document.getElementById('tab-cameras').click(); document.querySelector('.tile .gear').click()`); await wait(300); await click('cdClearMedia', 2500);
        const none = await js(`({ media: ${text('cdMedia')}, status: document.querySelector('.tile .small').textContent, ready: ${dots} })`);
        check(none.media === 'None yet.' && /^No stand-in yet/.test(none.status) && !none.ready.cameras, `stand-in removed in the dialog: the dot goes quiet: ${none.status}`);
        await click('cdCancel', 300); await js(`document.getElementById('tab-stream').click()`); await wait(300);
        check(cams.ready.cameras && cams.ready.stream && cams.program > 0 && cams.note && cams.bug, `program shows the camera under the theme's overlay: ${cams.program}px`);
        check(/^Classic · overlay ready$/.test(cams.theme) && cams.ready.theme, `the Classic theme is up and the Theme dot is green: ${cams.theme}`);
        // Themes: switch to the template (which has a control panel) and back.
        await js(`document.getElementById('tab-theme').click()`); await wait(300);
        const cards = await js(`[...document.querySelectorAll('#themeList .theme-item strong')].map(n => n.textContent)`);
        check(cards.join(',') === 'Classic,Template', 'the built-in themes are listed: ' + cards.join(', '));
        const useTheme = name => js(`[...document.querySelectorAll('#themeList .theme-item')].find(c => c.querySelector('strong').textContent === ${JSON.stringify(name)}).querySelector('.use').click()`);
        await useTheme('Template'); await wait(2500);
        await js(`document.getElementById('tab-stream').click()`); await wait(1200);
        const tpl = await js(`(() => { const stage = document.getElementById('stage').getBoundingClientRect(), d = document.getElementById('drawer'), dr = d.getBoundingClientRect(); return { status: ${text('themeStatus')}, drawer: !d.hidden, src: document.getElementById('controlFrame').src, toggle: !document.getElementById('drawerToggle').hidden,
            right: dr.left >= stage.right, sameHeight: Math.abs(dr.height - stage.height) < 2, width: dr.width, fits: dr.bottom <= window.innerHeight && stage.bottom <= window.innerHeight && document.documentElement.scrollHeight <= window.innerHeight + 1 }; })()`);
        check(/^Template · overlay ready · control panel ready$/.test(tpl.status) && tpl.drawer && tpl.src.startsWith('theme://b-template/control.html') && tpl.toggle, `the Template theme loads with its control panel in the drawer: ${tpl.status}`);
        check(tpl.right && tpl.sameHeight && tpl.width >= 240 && tpl.fits, `the drawer stands right of the stage, as tall as it, ${Math.round(tpl.width)}px wide, all on screen`);
        if (shot) fs.writeFileSync(shot.replace(/\.png$/, '-template.png'), (await win.webContents.capturePage()).toPNG());
        // A dialog popped out from the control panel; a setting saved there reaches the overlay and is kept.
        const frame = which => win.webContents.mainFrame.framesInSubtree.find(f => f.url.includes(`/${which}.html`));
        await frame('control').executeJavaScript(`document.getElementById('settings').click()`); await wait(1500);
        const opened = await js(`({ open: document.getElementById('themeDialog').open, title: ${text('themeDialogTitle')}, src: document.getElementById('dialogFrame').src })`);
        check(opened.open && opened.title === 'Theme settings' && opened.src.startsWith('theme://b-template/settings.html'), `the control panel pops out the settings dialog: ${opened.title}`);
        if (shot) fs.writeFileSync(shot.replace(/\.png$/, '-dialog.png'), (await win.webContents.capturePage()).toPNG());
        await frame('settings').executeJavaScript(`document.getElementById('accent').value = '#60a5fa'; document.getElementById('meet').value = 'Spring Invitational'; document.getElementById('save').click()`); await wait(800);
        const saved = await js(`document.getElementById('themeDialog').open`);
        const applied = await frame('overlay').executeJavaScript(`({ accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), meet: document.getElementById('meetName').textContent, settings: JSON.stringify(Lanecast.settings) })`);
        check(!saved && applied.accent === '#60a5fa' && applied.meet === 'Spring Invitational', `Save closes the dialog and the overlay applies the settings: ${applied.settings}`);
        const stored = JSON.parse(fs.readFileSync(path.join(userData, 'lanecast.json'), 'utf8').replace(/^\uFEFF/, '') || '{}');
        await wait(600);
        const stored2 = JSON.parse(fs.readFileSync(path.join(userData, 'lanecast.json'), 'utf8'));
        check((stored2['theme-settings:b-template'] || stored['theme-settings:b-template'] || {}).meet === 'Spring Invitational', 'the settings are kept per theme in the settings file');
        // Hide the drawer: the stage takes the width; show it again.
        const before = await js(`document.getElementById('stage').getBoundingClientRect().width`);
        await click('drawerToggle', 500);
        const hidden = await js(`({ drawer: document.getElementById('drawer').hidden, width: document.getElementById('stage').getBoundingClientRect().width, label: ${text('drawerToggle')} })`);
        check(hidden.drawer && hidden.width > before && hidden.label === 'Theme controls', `drawer hidden, stage grows from ${Math.round(before)} to ${Math.round(hidden.width)}px`);
        await click('drawerToggle', 500);
        check(await js(`!document.getElementById('drawer').hidden`), 'drawer shown again');
        await js(`document.getElementById('tab-theme').click()`); await useTheme('Classic'); await wait(2000);
        const back = await js(`({ status: ${text('themeStatus')}, drawer: document.getElementById('drawer').hidden, toggle: document.getElementById('drawerToggle').hidden })`);
        check(/^Classic · overlay ready$/.test(back.status) && back.drawer && back.toggle, `back to Classic, drawer and its toggle gone: ${back.status}`);
        // The Theme tab is laid out like the Camera tab: every theme on the left with Use, the one in use on the right; making one waits behind New theme…
        const themeTab = await js(`(() => { const items = [...document.querySelectorAll('#themeList .theme-item')]; return { left: document.getElementById('themeFind').getBoundingClientRect().x, right: document.querySelector('.theme-now').getBoundingClientRect().x,
            rows: items.map(i => [i.querySelector('strong').textContent, i.querySelector('.small').textContent, i.querySelector('.use').textContent, i.classList.contains('active')].join('|')), stacked: items.length > 1 && items[1].getBoundingClientRect().y > items[0].getBoundingClientRect().y && items[1].getBoundingClientRect().x === items[0].getBoundingClientRect().x,
            name: ${text('themeName')}, folder: !document.getElementById('openThemes').hidden, console: !document.getElementById('themeConsole').hidden, dialog: document.getElementById('newThemeDialog').open, fields: !!document.getElementById('newThemeDialog').querySelector('#newThemeName') }; })()`);
        check(themeTab.left < themeTab.right && themeTab.stacked && themeTab.rows[0] === 'Classic|Built in · v1.0.0|In use|true' && /^Template\|Built in · v[\d.]+ · control panel\|Use\|false$/.test(themeTab.rows[1]) && themeTab.name === 'Classic' && !themeTab.folder && !themeTab.dialog && themeTab.fields,
            `the Theme tab lists every theme on the left with Use, and shows the one in use on the right: ${themeTab.rows.join(' / ')}`);
        // New theme…: a name, and a theme of your own starts from the template and is switched to.
        await js(`document.getElementById('newThemeOpen').click()`); await wait(300);
        await js(`document.getElementById('newThemeName').value = 'Smoke Theme'; document.getElementById('newTheme').click()`);
        for (let i = 0; i < 30 && await js(`document.getElementById('newThemeDialog').open`); i++) await wait(300);
        await wait(2500);
        const made = await js(`({ status: ${text('themeStatus')}, about: ${text('themeAbout')}, folder: !document.getElementById('openThemes').hidden, row: (i => i && [i.querySelector('.small').textContent, i.querySelector('.use').textContent, !!i.querySelector('.remove')].join('|'))([...document.querySelectorAll('#themeList .theme-item')].find(i => i.querySelector('strong').textContent === 'Smoke Theme')), overlay: document.getElementById('overlayFrame').src })`);
        const themeFolder = path.join(userData, 'themes', 'smoke-theme');
        check(/^Smoke Theme · overlay ready · control panel ready$/.test(made.status) && made.folder && /as you save/.test(made.about) && /^Mine · v[\d.]+ · control panel\|In use\|true$/.test(made.row) && made.overlay.startsWith('theme://u-smoke-theme/') && fs.existsSync(path.join(themeFolder, 'overlay.html')) && fs.existsSync(path.join(userData, 'themes', 'preview.html')) && fs.existsSync(path.join(userData, 'themes', 'lanecast-theme.js')),
            `New theme… makes one from the template, in its own folder beside the runtime and the preview page, and switches to it: ${made.status}`);
        // Saving one of its files is enough: the theme in use is read again by itself.
        fs.appendFileSync(path.join(themeFolder, 'overlay.html'), '\n<meta name="smoke-marker" content="saved">\n');
        let followed = false; for (let i = 0; i < 20 && !followed; i++) { await wait(400); const f = win.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('theme://u-smoke-theme/overlay.html')); followed = !!f && await f.executeJavaScript(`!!document.querySelector('meta[name="smoke-marker"]')`).catch(() => false); }
        check(followed, 'a theme of your own is followed as it is saved: the overlay was read again with nobody pressing Reload');
        // Removing it: ✕, once more in place, and the stream is back on Classic.
        const removeTheme = `[...document.querySelectorAll('#themeList .theme-item')].find(i => i.querySelector('strong').textContent === 'Smoke Theme').querySelector('.remove')`;
        await js(`${removeTheme}.click()`); await wait(200); const sure = await js(`${removeTheme}.textContent`); await js(`${removeTheme}.click()`); await wait(2500);
        const gone = await js(`({ rows: [...document.querySelectorAll('#themeList .theme-item strong')].map(n => n.textContent).join(), status: ${text('themeStatus')} })`);
        check(sure === 'Remove?' && gone.rows === 'Classic,Template' && /^Classic · overlay ready$/.test(gone.status) && !fs.existsSync(themeFolder), `a theme of your own is removed from its row, asking once more; the stream goes back to Classic: ${gone.status}`);
        await js(`document.getElementById('tab-stream').click()`); await wait(300);

        if (shot) {
            for (const t of ['stream', 'timer', 'events', 'cameras']) {
                await js(`document.getElementById('tab-${t}').click()`); await wait(400);
                const file = t === 'stream' ? shot : shot.replace(/\.png$/, `-${t}.png`);
                fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); console.log('screenshot ' + file);
            }
        }

        // Simulation is per part: the timer alone goes back to real ports; Events and Cameras stay simulated.
        await js(`document.querySelector('#timer .simToggle').click()`); await wait(1500);
        const timerOff = await js(`({ timer: ${text('timerStatus')}, controls: !document.getElementById('timerPort').parentElement.hidden, panel: document.getElementById('simConsole').hidden, badges: ${badges}, dot: ${dots} })`);
        check(timerOff.timer === 'Not connected.' && timerOff.controls && timerOff.panel && timerOff.badges === 'events,cameras' && !timerOff.dot.timer, `timer back to real: ${JSON.stringify(timerOff)}`);
        // The camera keeps its own switch: a stand-in-only camera stays simulated, and so does the tab's badge.
        const camStill = await js(`({ tiles: document.querySelectorAll('.tile').length, disabled: document.querySelector('.tile .camSim').disabled, badges: ${badges} })`);
        check(camStill.tiles === 1 && camStill.disabled && camStill.badges === 'events,cameras', `a camera with no address stays a stand-in, its switch disabled: ${JSON.stringify(camStill)}`);
        await js(`document.querySelector('#timer .simToggle').click()`); await wait(2500);
        const timerOn = await js(`({ timer: ${text('timerStatus')}, badges: ${badges} })`);
        check(/connected/.test(timerOn.timer) && timerOn.badges === 'timer,events,cameras', `timer simulated again reconnects: ${JSON.stringify(timerOn)}`);

        // Projects: save everything to a file, lose a camera, open the file: the camera is back and the project's own theme copy is in use.
        const zip = require('../src/main/zip');
        const projectFile = path.join(userData, 'Spring' + '.lanecast');
        const untitled = win.getTitle(), dangling = await js(`window.lanecast.project.info()`);
        check(dangling.path === null && dangling.name === 'Untitled project', `a project path to a deleted file is dropped at start: ${JSON.stringify(dangling)}`);
        await js(`document.getElementById('projectButton').click()`); await wait(200);
        await js(`(() => { const i = document.getElementById('projectName'); i.focus(); i.value = 'Spring'; i.dispatchEvent(new Event('change')); })()`); await wait(600);
        check(untitled === 'Lanecast' && win.getTitle() === 'Lanecast – Spring' && await js(`document.getElementById('projectDialog').open`), `the Project dialog names the project; the title bar reads "${win.getTitle()}" (was "${untitled}")`);
        await js(`document.getElementById('projectDialog').close()`);
        const savedProject = await js(`window.lanecast.project.saveTo(${JSON.stringify(projectFile)})`);
        const inside = zip.read(fs.readFileSync(projectFile)).map(e => e.name);
        check(savedProject.name === 'Spring' && inside.includes('project.json') && inside.includes('theme/overlay.html') && inside.includes('theme/theme.json'), `project saved: ${inside.length} files, theme and media inside`);
        const manifest = JSON.parse(zip.read(fs.readFileSync(projectFile)).find(e => e.name === 'project.json').data.toString());
        check(manifest.cameras.length === 1 && manifest.cameras[0].name === 'Pool' && manifest.theme.id === 'b-classic' && manifest.simulate.timer && manifest.rostersSim && manifest.rostersSim.length === 12, `the manifest has the camera, the theme, the switches and the 12 fetched events`);
        await js(`window.lanecast.cameras.remove('cam-pool')`); await wait(3500);
        check(await js(`document.querySelectorAll('.tile').length`) === 0, 'camera removed before reopening');
        const reloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
        await js(`window.lanecast.project.openPath(${JSON.stringify(projectFile)})`);
        await reloaded; await wait(5000);
        const reopened = await js(`({ tiles: [...document.querySelectorAll('.tile .name')].map(n => n.textContent), status: document.querySelector('.tile .small')?.textContent, project: document.getElementById('projectName').value, theme: ${text('themeStatus')}, overlay: document.getElementById('overlayFrame').src, badges: ${badges}, events: ${text('eventsLoaded')} })`);
        check(reopened.tiles.join(',') === 'Pool' && /^No stand-in yet/.test(reopened.status) && reopened.project === 'Spring' && win.getTitle() === 'Lanecast – Spring', `project opened: the camera is back (its stand-in was removed earlier), project named in the dialog and the title bar`);
        check(/^Classic \(project\) · overlay ready/.test(reopened.theme) && reopened.overlay.startsWith('theme://p-project/overlay.html') && reopened.badges === 'timer,events,cameras' && reopened.events === '12', `the project's own copy of the theme is in use, switches and start lists restored: ${reopened.theme}`);
        socket.close();
        console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
        process.exitCode = failed ? 1 : 0;
        app.quit();                                   // through before-quit, so the ports, relay and go2rtc are closed as in real use
    });
});
