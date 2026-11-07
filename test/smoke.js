/* Starts the app on the simulated ports, connects both, listens as an overlay would, and checks
 * that the clock runs, start lists arrive and packets reach the feed. Saves a screenshot.
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
        await wait(1500);
        const received = [];
        const socket = new WebSocket('ws://127.0.0.1:8080/');
        socket.on('message', data => received.push(JSON.parse(String(data))));
        socket.on('error', e => console.log('overlay socket error', e.message));
        await win.webContents.executeJavaScript(`
            document.getElementById('timerPort').value = 'sim:timer'; document.getElementById('timerConnect').click();
            document.getElementById('meetPort').value = 'sim:meet'; document.getElementById('meetConnect').click();`);
        await wait(7000);
        const text = id => `document.getElementById(${JSON.stringify(id)}).textContent`;
        const dots = `Object.fromEntries(['stream','timer','events','cameras','theme'].map(t => [t, document.getElementById('tab-' + t).firstElementChild.dataset.ready === 'true']))`;
        const r = await win.webContents.executeJavaScript(`({ timer: ${text('timerStatus')}, clock: ${text('clock')}, event: ${text('event')}, state: ${text('raceState')},
            meet: ${text('meetStatus')}, events: ${text('eventsLoaded')}, last: ${text('lastNo')}, relay: ${text('relayStatus')}, clients: ${text('clients')}, packets: ${text('packets')},
            ready: ${dots}, shown: document.querySelector('[role=tabpanel]:not([hidden])').id, error: document.getElementById('error').hidden ? '' : ${text('error')} })`);
        console.log(JSON.stringify(r, null, 1));
        check(r.shown === 'stream', 'the Stream tab is shown first: ' + r.shown);
        check(r.ready.stream && r.ready.timer && r.ready.events, 'Stream, Timer and Events dots are green');
        check(!r.ready.theme, 'the unbuilt Theme tab stays quiet');
        const badges = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.sim-badge')].filter(b => !b.hidden).length`);
        check(badges === 4, 'Sim badges on the four simulated tabs: ' + badges);
        // The simulated console by hand, from the Stream tab: pick event 2 heat 1 and start the race.
        await win.webContents.executeJavaScript(`document.getElementById('simEventUp').click()`); await wait(300);
        await win.webContents.executeJavaScript(`document.getElementById('simRace').click()`); await wait(2500);
        const driven = await win.webContents.executeJavaScript(`({ event: ${text('event')}, state: ${text('raceState')}, clock: ${text('clock')}, racing: document.getElementById('simRace').getAttribute('aria-pressed') })`);
        check(driven.event === '2 / 1' && driven.state === 'RUNNING' && driven.racing === 'true', `race started by hand on event 2: ${driven.event} ${driven.state} ${driven.clock}`);
        await win.webContents.executeJavaScript(`document.getElementById('simRace').click()`); await wait(600);
        check(r.timer === 'Connected · receiving', 'timer port reads the simulated console');
        check(/^\d:\d\d\.\d$/.test(r.clock), 'clock shows a time: ' + r.clock);
        check(r.event === '1 / 1', 'event and heat decoded: ' + r.event);
        check(/start lists? received/.test(r.meet), 'start lists arrive on the meet port: ' + r.meet);
        check(Number(r.events) >= 1, 'events stored: ' + r.events);
        check(/^Listening/.test(r.relay), 'overlay feed listening: ' + r.relay);
        check(r.clients === '1', 'the test overlay is counted: ' + r.clients);
        // During the lineup the clock sits at 0:00.0 and packets go out once a second; during a race, ten a second.
        check(Number(r.packets) >= 5, 'packets published: ' + r.packets);
        check(received.length >= 5 && received.at(-1).type === 'scoreboard' && received.at(-1).event >= 1, `overlay received ${received.length} packets`);
        check(received.some(p => p.lanes.some(l => l.name)), 'packets carry names from the start lists');
        check(!r.error, 'no error shown: ' + r.error);
        // Cameras: the engine must run; with ffmpeg about, the simulated test pattern must play.
        const engine = await win.webContents.executeJavaScript(text('engineStatus'));
        check(/^Camera engine running/.test(engine), 'camera engine running: ' + engine);
        if (/ffmpeg not found/.test(engine)) console.log('SKIP camera picture: no ffmpeg on this machine');
        else {
            await wait(6000);
            const cams = await win.webContents.executeJavaScript(`({ tiles: document.querySelectorAll('.tile').length, status: [...document.querySelectorAll('.tile .small')].map(s => s.textContent), ready: ${dots} })`);
            check(cams.tiles === 1 && /^Live · \d+×\d+/.test(cams.status[0]), 'test pattern camera is live: ' + cams.status.join(' / '));
            check(cams.ready.cameras, 'Cameras dot is green');
            const program = await win.webContents.executeJavaScript(`({ width: document.getElementById('programVideo').videoWidth, note: document.getElementById('stageNote').hidden, bug: !document.getElementById('bug').hidden, status: ${text('programStatus')}, ready: ${dots} })`);
            check(program.width > 0 && program.note && program.bug && program.ready.stream, `program shows the camera under the lower third: ${program.width}px, ${program.status}`);
        }
        // Simulation is per part. All off: the pretend ports close and the badges go.
        const badgesShown = `[...document.querySelectorAll('.sim-badge')].filter(b => !b.hidden).map(b => b.parentElement.id.slice(4)).join(',')`;
        await win.webContents.executeJavaScript(`document.querySelector('#stream .simToggle').click()`); await wait(1500);
        const off = await win.webContents.executeJavaScript(`({ timer: ${text('timerStatus')}, meet: ${text('meetStatus')}, badges: ${badgesShown}, controls: document.getElementById('simControls').hidden, checked: document.querySelector('#timer .simToggle').checked })`);
        check(off.timer === 'Not connected.' && off.meet === 'Not connected.' && off.badges === '' && off.controls && !off.checked, `all off closes both ports and clears the badges: ${JSON.stringify(off)}`);
        // Meet Manager alone: its port connects, the timer stays off, Events and Stream wear the badge.
        await win.webContents.executeJavaScript(`document.querySelector('#events .simToggle').click()`); await wait(2500);
        const events = await win.webContents.executeJavaScript(`({ timer: ${text('timerStatus')}, meet: ${text('meetStatus')}, badges: ${badgesShown}, all: document.querySelector('#stream .simToggle').indeterminate })`);
        check(events.timer === 'Not connected.' && /start list/.test(events.meet) && events.badges === 'stream,events' && events.all, `Meet Manager simulated on its own: ${JSON.stringify(events)}`);
        // Simulate all again from the Stream tab.
        await win.webContents.executeJavaScript(`document.querySelector('#stream .simToggle').click()`); await wait(2500);
        const on = await win.webContents.executeJavaScript(`({ timer: ${text('timerStatus')}, badges: ${badgesShown} })`);
        check(on.timer === 'Connected · receiving' && on.badges === 'stream,timer,events,cameras', `all on again reconnects: ${JSON.stringify(on)}`);
        if (shot) {
            // One screenshot per tab: shot.png, shot-timer.png, shot-events.png …
            for (const t of ['stream', 'timer', 'events', 'cameras']) {
                await win.webContents.executeJavaScript(`document.getElementById('tab-${t}').click()`); await wait(400);
                const file = t === 'stream' ? shot : shot.replace(/\.png$/, `-${t}.png`);
                fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); console.log('screenshot ' + file);
            }
        }
        socket.close();
        await win.webContents.executeJavaScript(`document.getElementById('timerDisconnect').click(); document.getElementById('meetDisconnect').click();`);
        await wait(500);
        const after = await win.webContents.executeJavaScript(`[${text('timerStatus')}, ${text('meetStatus')}, ${dots}]`);
        check(after[0] === 'Not connected.' && after[1] === 'Not connected.', 'both ports disconnect: ' + after.slice(0, 2).join(' / '));
        check(!after[2].timer, 'the Timer dot goes quiet once disconnected');
        console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
        process.exitCode = failed ? 1 : 0;
        app.quit();                                   // through before-quit, so the ports, relay and go2rtc are closed as in real use
    });
});
