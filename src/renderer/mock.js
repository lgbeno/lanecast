/* Design mode: the window in an ordinary browser, for working on layout and style.
 *
 * Inside Electron the preload supplies window.lanecast and this file does nothing. Opened in a
 * browser (python3 -m http.server, then /src/renderer/index.html), there is no bridge, so this
 * stands one in: the simulated meet runs in the page, a drawn test pattern plays as the camera,
 * settings go to localStorage, and the file dialogs do nothing. Nothing here is real.
 */
'use strict';
(() => {
    if (window.lanecast) return;
    const listeners = {};
    const on = (name, callback) => { (listeners[name] ||= []).push(callback); return () => { listeners[name] = listeners[name].filter(f => f !== callback); }; };
    const emit = (name, ...args) => { for (const f of listeners[name] || []) f(...args); };
    const SIM_PORTS = [{ path: 'sim:timer', label: 'Simulated timing console' }, { path: 'sim:meet', label: 'Simulated Meet Manager' }];
    const PARTS = ['timer', 'events', 'cameras'];
    const sim = JSON.parse(localStorage.getItem('lanecast-mock:simulate') || '{"timer":true,"events":true,"cameras":true}');
    const epoch = performance.now(), console_ = new Sim.TimerSource();
    const ports = { timer: { state: 'closed', message: '', path: null, stop: null }, meet: { state: 'closed', message: '', path: null, stop: null } };
    const state = role => ({ state: ports[role].state, message: ports[role].message, path: ports[role].path });
    const setState = (role, s, message, path) => { Object.assign(ports[role], { state: s, message, path }); emit('serial:state', role, state(role)); };
    const begin = (role, path) => {
        if (path === 'sim:timer') {
            console_.seek(performance.now() - epoch);
            const id = setInterval(() => { const b = console_.read(performance.now() - epoch); if (b.length) emit('serial:data', role, b); }, 25);
            return () => clearInterval(id);
        }
        const mm = new Sim.MeetManager();
        const id = setInterval(() => { const r = mm.walkNext(); if (r) emit('serial:data', role, r); }, 670);
        return () => clearInterval(id);
    };
    const simState = () => { const m = console_.manual; return { ...sim, ffmpeg: true, event: m?.event ?? null, heat: m?.heat ?? null, racing: !!m?.racing }; };

    // A camera that is drawn, not received: colour bars and a moving clock on a canvas.
    let pattern = null;
    function patternStream() {
        if (pattern) return pattern;
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d'), colours = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
        const draw = () => {
            colours.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * 1280 / 7, 0, 1280 / 7 + 1, 520); });
            ctx.fillStyle = '#101010'; ctx.fillRect(0, 520, 1280, 200);
            ctx.fillStyle = '#fff'; ctx.font = '700 64px ui-monospace, monospace'; ctx.textAlign = 'center';
            ctx.fillText(new Date().toLocaleTimeString(), 640, 640);
            ctx.font = '600 28px system-ui'; ctx.fillText('design mode · drawn in the page', 640, 690);
            requestAnimationFrame(draw);
        };
        draw();
        return pattern = canvas.captureStream(30);
    }
    const cameras = JSON.parse(localStorage.getItem('lanecast-mock:cameras') || '[]');
    const saveCameras = () => localStorage.setItem('lanecast-mock:cameras', JSON.stringify(cameras));

    window.lanecast = {
        info: async () => ({ version: 'design mode', platform: 'browser' }),
        serial: {
            list: async role => (role === 'meet' ? sim.events : sim.timer) ? [SIM_PORTS[role === 'meet' ? 1 : 0]] : [],
            open: async (role, path) => {
                if (!SIM_PORTS.some(p => p.path === path)) throw new Error('Choose a port first');
                if (ports[role].stop) ports[role].stop();
                setState(role, 'connecting', 'Connecting…', path);
                ports[role].stop = begin(role, path);
                setState(role, 'open', '', path);
            },
            close: async role => { if (ports[role].stop) ports[role].stop(); ports[role].stop = null; setState(role, 'closed', 'Not connected.', null); },
            state: async role => state(role),
            onData: cb => on('serial:data', cb), onState: cb => on('serial:state', cb)
        },
        sim: {
            state: async () => simState(),
            set: async (part, onNow) => {
                for (const p of part === 'all' ? PARTS : [part]) {
                    sim[p] = !!onNow;
                    const role = p === 'timer' ? 'timer' : p === 'events' ? 'meet' : null;
                    if (role && ports[role].stop) await window.lanecast.serial.close(role);
                }
                localStorage.setItem('lanecast-mock:simulate', JSON.stringify(sim)); emit('sim:changed', simState());
            },
            control: async (event, heat) => { console_.control(event, heat); return simState(); },
            race: async onNow => { console_.race(onNow); return simState(); },
            onChange: cb => on('sim:changed', cb)
        },
        relay: { sent: 0, status: async () => ({ port: 8080, listening: true, clients: 1, sent: window.lanecast.relay.sent, error: '', hosts: ['192.168.1.20'] }), send: () => { window.lanecast.relay.sent++; }, onStatus: cb => on('relay:status', cb) },
        cameras: {
            status: async () => ({ running: true, error: '', api: '', version: 'design mode', installed: true, ffmpeg: true, log: [] }),
            list: async () => (sim.cameras ? [{ id: 'cam-pattern', name: 'Test pattern', url: 'pattern' }] : []).concat(cameras).map(c => ({ ...c, producers: 1, consumers: 1 })),
            add: async ({ name, url }) => { if (!url) throw new Error('Enter the camera’s address'); const camera = { id: 'cam-' + Date.now().toString(36), name: name || `Camera ${cameras.length + 1}`, url }; cameras.push(camera); saveCameras(); return camera; },
            remove: async id => { const i = cameras.findIndex(c => c.id === id); if (i >= 0) { cameras.splice(i, 1); saveCameras(); } },
            onStatus: cb => on('cameras:status', cb),
            /** Design mode only: every camera shows the drawn pattern. */
            mockStream: () => patternStream()
        },
        store: {
            get: async key => { try { return JSON.parse(localStorage.getItem('lanecast-mock:' + key)); } catch (e) { return null; } },
            set: async (key, value) => { if (value == null) localStorage.removeItem('lanecast-mock:' + key); else localStorage.setItem('lanecast-mock:' + key, JSON.stringify(value)); }
        },
        files: { loadStartLists: async () => [], saveStartLists: async () => null },
        designMode: true
    };
})();
