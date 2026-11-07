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

process.env.LANECAST_SIMULATE = '1';
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lanecast-smoke-')));
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
        const socket = new WebSocket('ws://127.0.0.1:8080/');
        socket.on('message', data => received.push(JSON.parse(String(data))));
        socket.on('error', e => console.log('overlay socket error', e.message));

        // Everything simulated at start: the pretend console connects by itself, no port controls show.
        const start = await js(`({ timer: ${text('timerStatus')}, timerControls: document.getElementById('timerPort').parentElement.hidden, simPanel: !document.getElementById('timerSim').hidden,
            meet: ${text('meetStatus')}, fetch: !document.getElementById('fetchSim').hidden, camSim: !document.getElementById('camSim').hidden, camAdd: document.getElementById('camAdd').hidden,
            badges: ${badges}, shown: document.querySelector('[role=tabpanel]:not([hidden])').id, error: document.getElementById('error').hidden ? '' : ${text('error')} })`);
        console.log(JSON.stringify(start, null, 1));
        check(start.shown === 'stream', 'the Stream tab is shown first: ' + start.shown);
        check(start.badges === 'stream,timer,events,cameras', 'Sim badges on Stream, Timer, Events and Cameras: ' + start.badges);
        check(/^Simulated · the pretend console is connected/.test(start.timer) && start.timerControls && start.simPanel, 'timer: pretend console connected, port controls gone, console controls shown');
        check(/^Simulated/.test(start.meet) && start.fetch, 'events: no port, Fetch simulated events offered');
        check(start.camSim && start.camAdd, 'cameras: the simulated camera card replaces Add a camera');
        check(!start.error, 'no error shown: ' + start.error);

        // Events: fetch a made-up meet; it becomes the console's schedule.
        await click('fetchSim', 800);
        const events = await js(`({ loaded: Number(${text('eventsLoaded')}), status: ${text('fileStatus')}, ready: ${dots} })`);
        check(events.loaded === 12 && events.ready.events, `fetched 12 simulated events: ${events.status}`);

        // Timer: step to the second loaded event, race it, then run the meet.
        await click('simEventUp', 600);
        await click('simRace', 2500);
        const raced = await js(`({ event: ${text('event')}, state: ${text('raceState')}, clock: ${text('clock')}, note: ${text('simNote')}, racing: document.getElementById('simRace').getAttribute('aria-pressed') })`);
        check(raced.event === '2 / 1' && raced.state === 'RUNNING' && raced.racing === 'true', `raced event 2 heat 1 by hand: ${raced.event} ${raced.state} ${raced.clock}`);
        await click('simRun', 1500);
        const running = await js(`({ running: document.getElementById('simRun').getAttribute('aria-pressed'), racing: document.getElementById('simRace').getAttribute('aria-pressed'), note: ${text('simNote')}, clock: ${text('clock')} })`);
        check(running.running === 'true' && running.racing === 'false' && /^Running the meet through 12 loaded events/.test(running.note), `running the meet: ${running.note}`);
        await wait(4000);
        const r = await js(`({ timer: ${text('timerStatus')}, clock: ${text('clock')}, event: ${text('event')}, relay: ${text('relayStatus')}, clients: ${text('clients')}, packets: ${text('packets')}, ready: ${dots} })`);
        check(/^\d:\d\d\.\d$/.test(r.clock) && r.ready.timer, 'clock shows a time and the Timer dot is green: ' + r.clock);
        check(/^Listening/.test(r.relay) && r.clients === '1', 'overlay feed listening with the test overlay counted: ' + r.relay);
        check(Number(r.packets) >= 5 && received.length >= 5 && received.at(-1).type === 'scoreboard', `packets published and received: ${r.packets} / ${received.length}`);
        check(received.some(p => p.lanes.some(l => l.name)), 'packets carry names from the start lists');

        // Cameras: the simulated camera (the drawn pool) is live without ffmpeg; the program shows it.
        const cams = await js(`({ tiles: document.querySelectorAll('.tile').length, status: [...document.querySelectorAll('.tile .small')].map(s => s.textContent), media: ${text('mediaName')}, engine: ${text('engineStatus')}, ready: ${dots},
            program: document.getElementById('programVideo').videoWidth, note: document.getElementById('stageNote').hidden, bug: !document.getElementById('bug').hidden, pstatus: ${text('programStatus')} })`);
        check(cams.tiles === 1 && /^Live · 1280×720/.test(cams.status[0]) && /drawn pool/.test(cams.media), `the simulated camera is live: ${cams.status.join(' / ')} · ${cams.media}`);
        check(/^Camera engine running/.test(cams.engine), 'camera engine running: ' + cams.engine);
        check(cams.ready.cameras && cams.ready.stream && cams.program > 0 && cams.note && cams.bug, `program shows the camera under the lower third: ${cams.program}px, ${cams.pstatus}`);

        if (shot) {
            for (const t of ['stream', 'timer', 'events', 'cameras']) {
                await js(`document.getElementById('tab-${t}').click()`); await wait(400);
                const file = t === 'stream' ? shot : shot.replace(/\.png$/, `-${t}.png`);
                fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); console.log('screenshot ' + file);
            }
        }

        // Simulation is per part: the timer alone goes back to real ports; Events and Cameras stay simulated.
        await js(`document.querySelector('#timer .simToggle').click()`); await wait(1500);
        const timerOff = await js(`({ timer: ${text('timerStatus')}, controls: !document.getElementById('timerPort').parentElement.hidden, panel: document.getElementById('timerSim').hidden, badges: ${badges}, dot: ${dots} })`);
        check(timerOff.timer === 'Not connected.' && timerOff.controls && timerOff.panel && timerOff.badges === 'stream,events,cameras' && !timerOff.dot.timer, `timer back to real: ${JSON.stringify(timerOff)}`);
        await js(`document.querySelector('#cameras .simToggle').click()`); await wait(1000);
        const camOff = await js(`({ tiles: document.querySelectorAll('.tile').length, camAdd: !document.getElementById('camAdd').hidden, badges: ${badges} })`);
        check(camOff.tiles === 0 && camOff.camAdd && camOff.badges === 'stream,events', `camera back to real: ${JSON.stringify(camOff)}`);
        await js(`document.querySelector('#timer .simToggle').click()`); await wait(2500);
        const timerOn = await js(`({ timer: ${text('timerStatus')}, badges: ${badges} })`);
        check(/connected/.test(timerOn.timer) && timerOn.badges === 'stream,timer,events', `timer simulated again reconnects: ${JSON.stringify(timerOn)}`);

        socket.close();
        console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
        process.exitCode = failed ? 1 : 0;
        app.quit();                                   // through before-quit, so the ports, relay and go2rtc are closed as in real use
    });
});
