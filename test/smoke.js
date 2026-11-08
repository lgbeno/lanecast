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
fs.writeFileSync(path.join(userData, 'lanecast.json'), JSON.stringify({ simulate: { timer: true, events: true, cameras: true }, simMedia: { path: path.join(__dirname, '..', 'build', 'icon.png') }, relayPort: 18080 }));
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
        const badges = `[...document.querySelectorAll('.sim-badge')].filter(b => !b.hidden).map(b => b.parentElement.id.slice(4)).join(',')`;
        const click = async (id, ms = 300) => { await js(`document.getElementById(${JSON.stringify(id)}).click()`); await wait(ms); };
        await wait(2500);
        const received = [];
        const socket = new WebSocket('ws://127.0.0.1:18080/');       // the port from the settings file, clear of a Lanecast that may be running
        socket.on('message', data => received.push(JSON.parse(String(data))));
        socket.on('error', e => console.log('overlay socket error', e.message));

        // Everything simulated at start: the pretend console connects by itself, no port controls show.
        const start = await js(`({ timer: ${text('timerStatus')}, timerControls: document.getElementById('timerPort').parentElement.hidden, simPanel: !document.getElementById('simConsole').hidden && document.getElementById('timer').querySelector('.sim-panel') === null,
            meet: ${text('meetStatus')}, fetch: !document.getElementById('fetchSim').hidden && document.getElementById('loadFiles').hidden && document.getElementById('saveFiles').hidden, camSim: !document.getElementById('camSim').hidden, camAdd: document.getElementById('camAdd').hidden,
            badges: ${badges}, shown: document.querySelector('[role=tabpanel]:not([hidden])').id, error: document.getElementById('error').hidden ? '' : ${text('error')},
            label: ${text('camerasLabel')}, deck: document.getElementById('stage').previousElementSibling.className, deckHas: [...document.querySelector('.deck').children].map(c => c.id || c.className.split(' ').pop()).join('+'),
            fits: document.getElementById('stage').getBoundingClientRect().bottom <= window.innerHeight && document.documentElement.scrollHeight <= window.innerHeight + 1, banner: !!document.getElementById('banner'), follow: !!document.getElementById('follow') })`);
        check(start.label === 'Camera' && start.deck === 'deck' && start.deckHas === 'program-box+simConsole', `Camera tab singular; Go Live box above the stage beside Simulation control: ${start.deckHas}`);
        check(start.fits && !start.banner && !start.follow, `the Stream tab fits the window with no scrolling, no banner, no Show latest`);
        console.log(JSON.stringify(start, null, 1));
        check(start.shown === 'stream', 'the Stream tab is shown first: ' + start.shown);
        check(start.badges === 'timer,events,cameras', 'the settings file is honoured: Sim badges on Timer, Events and Cameras, none on Stream: ' + start.badges);
        check(/^Simulated · the pretend console is connected · its controls are on the Stream tab/.test(start.timer) && start.timerControls && start.simPanel, 'timer: pretend console connected, port controls gone, a note that the controls are on the Stream tab');
        check(/^Simulated/.test(start.meet) && start.fetch, 'events: no port, Fetch simulated events in place of Load and Save');
        check(start.camSim && start.camAdd, 'cameras: the simulated camera card replaces Add a camera');
        check(!start.error, 'no error shown: ' + start.error);

        // Events: fetch a made-up meet; it becomes the console's schedule.
        await click('fetchSim', 800);
        const events = await js(`({ loaded: Number(${text('eventsLoaded')}), status: ${text('fileStatus')}, ready: ${dots} })`);
        check(events.loaded === 12 && events.ready.events, `fetched 12 simulated events: ${events.status}`);

        // Simulation control, above the program: queue the second loaded event, then Run.
        await click('simEventUp', 600);
        const queued = await js(`({ event: ${text('event')}, summary: ${text('simSummary')}, running: document.getElementById('simRun').getAttribute('aria-pressed') })`);
        check(queued.event === '2 / 1' && /^Queued · event 2 heat 1$/.test(queued.summary) && queued.running === 'false', `event 2 heat 1 queued: ${queued.summary}`);
        await click('simRun', 9500);                                                   // through the 8 s lineup into the race
        const running = await js(`({ running: document.getElementById('simRun').getAttribute('aria-pressed'), summary: ${text('simSummary')}, state: ${text('raceState')}, event: ${text('event')} })`);
        check(running.running === 'true' && /^Running · event 2 heat 1 of 12 loaded events/.test(running.summary) && running.state === 'RUNNING', `Run from the queued heat, racing: ${running.summary} · ${running.state}`);
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
        check(Number(r.packets) >= 5 && received.length >= 5 && received.at(-1).type === 'scoreboard', `packets published and received: ${r.packets} / ${received.length}`);
        check(received.some(p => p.lanes.some(l => l.name)), 'packets carry names from the start lists');

        // Cameras: the simulated camera shows the photo from the settings file, live, without ffmpeg; the program shows it.
        const cams = await js(`({ tiles: document.querySelectorAll('.tile').length, status: [...document.querySelectorAll('.tile .small')].map(s => s.textContent), media: ${text('mediaName')}, engine: ${text('engineStatus')}, ready: ${dots},
            program: document.getElementById('programVideo').videoWidth, note: document.getElementById('stageNote').hidden, bug: !document.getElementById('bug').hidden, pstatus: ${text('programStatus')} })`);
        check(cams.tiles === 1 && /^Live · 1280×720/.test(cams.status[0]) && cams.media === 'Photo: icon.png', `the simulated camera shows the remembered photo, live: ${cams.status.join(' / ')} · ${cams.media}`);
        check(/^Camera engine running/.test(cams.engine), 'camera engine running: ' + cams.engine);
        const pixel = await js(`(() => { const v = document.getElementById('programVideo'), c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++; return lit; })()`);
        check(pixel > 200, `the photo is actually drawn (lit pixels in the program: ${pixel})`);
        await click('clearMedia', 2500);
        const none = await js(`({ media: ${text('mediaName')}, status: document.querySelector('.tile .small').textContent, ready: ${dots} })`);
        check(none.media === 'No photo or video chosen.' && none.status === 'No photo or video chosen' && !none.ready.cameras, `photo removed: nothing stands in, the dot goes quiet: ${none.media} · ${none.status}`);
        check(cams.ready.cameras && cams.ready.stream && cams.program > 0 && cams.note && cams.bug && /^Idle · program ready/.test(cams.pstatus), `program shows the camera under the lower third: ${cams.program}px, ${cams.pstatus}`);

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
        await js(`document.querySelector('#cameras .simToggle').click()`); await wait(1000);
        const camOff = await js(`({ tiles: document.querySelectorAll('.tile').length, camAdd: !document.getElementById('camAdd').hidden, badges: ${badges} })`);
        check(camOff.tiles === 0 && camOff.camAdd && camOff.badges === 'events', `camera back to real: ${JSON.stringify(camOff)}`);
        await js(`document.querySelector('#timer .simToggle').click()`); await wait(2500);
        const timerOn = await js(`({ timer: ${text('timerStatus')}, badges: ${badges} })`);
        check(/connected/.test(timerOn.timer) && timerOn.badges === 'timer,events', `timer simulated again reconnects: ${JSON.stringify(timerOn)}`);

        socket.close();
        console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
        process.exitCode = failed ? 1 : 0;
        app.quit();                                   // through before-quit, so the ports, relay and go2rtc are closed as in real use
    });
});
