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
fs.writeFileSync(path.join(userData, 'lanecast.json'), JSON.stringify({ simulate: { timer: true, events: true }, relayPort: 18080,
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
        // This computer's cameras are listed without asking for access first; the list may be empty on a build machine.
        await js(`document.getElementById('tab-cameras').click()`); await wait(800);
        const local = await js(`({ list: document.getElementById('deviceList').textContent, rows: document.querySelectorAll('.device').length, note: ${text('deviceNote')}, find: !!document.getElementById('findDevices') })`);
        check(local.find && (local.rows > 0 || /Find cameras|No cameras/.test(local.list)), `local cameras listed or none found: ${local.rows} row(s) · ${local.list.slice(0, 60)}`);
        // A second camera, by address; the tab turns plural; its own switch makes it a stand-in; its settings dialog renames it.
        await js(`document.getElementById('camName').value = 'Finish'; document.getElementById('camUrl').value = 'rtsp://127.0.0.1:1/none'`); await click('camAddButton', 1500);
        const two = await js(`({ label: ${text('camerasLabel')}, tiles: [...document.querySelectorAll('.tile .name')].map(n => n.textContent), status: ${text('camAddStatus')} })`);
        check(two.label === 'Cameras' && two.tiles.join(',') === 'Pool,Finish', `a second camera: tab reads Cameras, tiles ${two.tiles.join(' and ')}`);
        await js(`[...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish').querySelector('.camSim').click()`); await wait(1200);
        const finish = await js(`(() => { const t = [...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish'); return { badge: !t.querySelector('.sim-badge').hidden, status: t.querySelector('.small').textContent, tabBadge: ${badges} }; })()`);
        check(finish.badge && /^No stand-in yet/.test(finish.status), `Finish switched to simulated on its own: ${finish.status}`);
        await js(`[...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish').querySelector('.gear').click()`); await wait(400);
        const dlg = await js(`({ open: document.getElementById('cameraDialog').open, name: document.getElementById('cdName').value, url: document.getElementById('cdUrl').value, sim: document.getElementById('cdSimulate').checked })`);
        check(dlg.open && dlg.name === 'Finish' && dlg.url === 'rtsp://127.0.0.1:1/none' && dlg.sim, 'its settings dialog shows name, address and the switch');
        await js(`document.getElementById('cdName').value = 'Finish line'; document.getElementById('cdSimulate').checked = false`); await click('cdSave', 1200);
        const renamed = await js(`({ open: document.getElementById('cameraDialog').open, tiles: [...document.querySelectorAll('.tile .name')].map(n => n.textContent), sims: document.querySelectorAll('.tile .camSim:checked').length, select: [...document.getElementById('programCamera').options].map(o => o.text).join(',') })`);
        check(!renamed.open && renamed.tiles.join(',') === 'Pool,Finish line' && renamed.sims === 1 && renamed.select === 'Pool,Finish line', `saved: renamed to Finish line, back to real; the program camera list follows`);
        await js(`[...document.querySelectorAll('.tile')].find(t => t.querySelector('.name').textContent === 'Finish line').querySelector('.gear').click()`); await wait(300); await click('cdRemove', 1200);
        check(await js(`document.querySelectorAll('.tile').length === 1 && ${text('camerasLabel')} === 'Camera'`), 'removed from its dialog; tab reads Camera again');
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
        const cards = await js(`[...document.querySelectorAll('.theme h3')].map(h => h.firstChild.textContent)`);
        check(cards.join(',') === 'Classic,Template', 'the built-in themes are listed: ' + cards.join(', '));
        await js(`[...document.querySelectorAll('.theme')].find(c => c.querySelector('h3').firstChild.textContent === 'Template').querySelector('button').click()`); await wait(2500);
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
        await js(`document.getElementById('tab-theme').click(); [...document.querySelectorAll('.theme')].find(c => c.querySelector('h3').firstChild.textContent === 'Classic').querySelector('button').click()`); await wait(2000);
        const back = await js(`({ status: ${text('themeStatus')}, drawer: document.getElementById('drawer').hidden, toggle: document.getElementById('drawerToggle').hidden })`);
        check(/^Classic · overlay ready$/.test(back.status) && back.drawer && back.toggle, `back to Classic, drawer and its toggle gone: ${back.status}`);
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
        const reopened = await js(`({ tiles: [...document.querySelectorAll('.tile .name')].map(n => n.textContent), status: document.querySelector('.tile .small')?.textContent, project: ${text('projectButton')}, theme: ${text('themeStatus')}, overlay: document.getElementById('overlayFrame').src, badges: ${badges}, events: ${text('eventsLoaded')} })`);
        check(reopened.tiles.join(',') === 'Pool' && /^No stand-in yet/.test(reopened.status) && reopened.project === 'Spring', `project opened: the camera is back (its stand-in was removed earlier), project named in the bar`);
        check(/^Classic \(project\) · overlay ready/.test(reopened.theme) && reopened.overlay.startsWith('theme://p-project/overlay.html') && reopened.badges === 'timer,events,cameras' && reopened.events === '12', `the project's own copy of the theme is in use, switches and start lists restored: ${reopened.theme}`);
        socket.close();
        console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
        process.exitCode = failed ? 1 : 0;
        app.quit();                                   // through before-quit, so the ports, relay and go2rtc are closed as in real use
    });
});
