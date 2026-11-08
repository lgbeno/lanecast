/* Design mode: the window in an ordinary browser, for working on layout and style.
 *
 * Inside Electron the preload supplies window.lanecast and this file does nothing. Opened in a
 * browser (python3 -m http.server, then /src/renderer/index.html), there is no bridge, so this
 * stands one in: the simulated console runs in the page, a chosen photo or video (or the drawn
 * pool) stands in for the camera, settings go to localStorage, and the file dialogs do nothing.
 * Nothing here is real.
 */
'use strict';
(() => {
    if (window.lanecast) return;
    const listeners = {};
    const on = (name, callback) => { (listeners[name] ||= []).push(callback); return () => { listeners[name] = listeners[name].filter(f => f !== callback); }; };
    const emit = (name, ...args) => { for (const f of listeners[name] || []) f(...args); };
    const PARTS = ['timer', 'events'];
    const SIM_PORT = { path: 'sim:timer', label: 'Simulated timing console' };
    const sim = JSON.parse(localStorage.getItem('lanecast-mock:simulate') || '{"timer":true,"events":true}');
    const epoch = performance.now(), console_ = new Sim.TimerSource();
    const ports = { timer: { state: 'closed', message: '', path: null, stop: null }, meet: { state: 'closed', message: '', path: null, stop: null } };
    const state = role => ({ state: ports[role].state, message: ports[role].message, path: ports[role].path });
    const setState = (role, s, message, path) => { Object.assign(ports[role], { state: s, message, path }); emit('serial:state', role, state(role)); };
    const simState = () => ({ ...sim, ...console_.status() });
    const cameras = JSON.parse(localStorage.getItem('lanecast-mock:cameras') || '[]');
    const saveCameras = () => localStorage.setItem('lanecast-mock:cameras', JSON.stringify(cameras));

    window.lanecast = {
        info: async () => ({ version: 'design mode', platform: 'browser' }),
        serial: {
            list: async role => role === 'timer' && sim.timer ? [SIM_PORT] : [],
            open: async (role, path) => {
                if (role !== 'timer' || path !== SIM_PORT.path) throw new Error('Choose a port first');
                if (ports[role].stop) ports[role].stop();
                setState(role, 'connecting', 'Connecting…', path);
                console_.seek(performance.now() - epoch);
                const id = setInterval(() => { const b = console_.read(performance.now() - epoch); if (b.length) emit('serial:data', role, b); }, 25);
                ports[role].stop = () => clearInterval(id);
                setState(role, 'open', '', path);
            },
            close: async role => { if (ports[role].stop) ports[role].stop(); ports[role].stop = null; setState(role, 'closed', 'Not connected.', null); },
            state: async role => state(role),
            onData: cb => on('serial:data', cb), onState: cb => on('serial:state', cb)
        },
        sim: {
            state: async () => simState(),
            set: async (part, onNow) => {
                if (!PARTS.includes(part)) throw new Error('Unknown part');
                sim[part] = !!onNow;
                if (part === 'timer' && ports.timer.stop) await window.lanecast.serial.close('timer');
                localStorage.setItem('lanecast-mock:simulate', JSON.stringify(sim)); emit('sim:changed', simState());
            },
            control: async (event, heat) => { console_.control(event, heat); return simState(); },
            race: async onNow => { console_.race(onNow); return simState(); },
            run: async (onNow, event, heat) => { console_.run(onNow, event, heat); return simState(); },
            schedule: async meet => { console_.setMeet(meet); return simState(); },
            onChange: cb => on('sim:changed', cb)
        },
        relay: { sent: 0, status: async () => ({ port: 8080, listening: true, clients: 1, sent: window.lanecast.relay.sent, error: '', hosts: ['192.168.1.20'] }), send: () => { window.lanecast.relay.sent++; }, onStatus: cb => on('relay:status', cb) },
        cameras: {
            status: async () => ({ running: true, error: '', api: '', version: 'design mode', installed: true, ffmpeg: true, log: [] }),
            list: async () => cameras.map(c => ({ ...c, local: /^device:/.test(c.url), producers: 1, consumers: 1 })),
            add: async ({ name, url, simulate }) => { url = url || ''; if (!url && !simulate) throw new Error('Enter the camera’s address, or add it as simulated'); const camera = { id: 'cam-' + Date.now().toString(36), name: name || `Camera ${cameras.length + 1}`, url, simulate: !!simulate, media: null }; cameras.push(camera); saveCameras(); return camera; },
            update: async (id, patch) => { const c = cameras.find(x => x.id === id); if (!c) throw new Error('No such camera'); if (patch.name !== undefined) c.name = String(patch.name).trim() || c.name; if (patch.url !== undefined) c.url = String(patch.url).trim(); if (patch.simulate !== undefined) c.simulate = !!patch.simulate; if (!c.url && !c.simulate) c.simulate = true; saveCameras(); return c; },
            remove: async id => { const i = cameras.findIndex(c => c.id === id); if (i >= 0) { cameras.splice(i, 1); saveCameras(); } },
            /** A photo or video from this machine, through the browser's own picker; kept for this page load only. */
            chooseMedia: id => new Promise(resolve => {
                const c = cameras.find(x => x.id === id); if (!c) { resolve(null); return; }
                const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,video/*';
                input.onchange = () => { const file = input.files[0]; if (file) c.media = { name: file.name, kind: file.type.startsWith('video/') ? 'video' : 'image', url: URL.createObjectURL(file), version: Date.now() }; resolve(c); };
                input.oncancel = () => resolve(c);
                input.click();
            }),
            clearMedia: async id => { const c = cameras.find(x => x.id === id); if (c) c.media = null; return c; },
            mediaBytes: async () => null,
            onStatus: cb => on('cameras:status', cb),
            /** Design mode only: a "real" camera added here shows a drawn test card. */
            mockStream: (() => {
                let stream = null;
                return () => {
                    if (stream) return stream;
                    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
                    const ctx = canvas.getContext('2d'), colours = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
                    const draw = () => {
                        colours.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * 1280 / 7, 0, 1280 / 7 + 1, 520); });
                        ctx.fillStyle = '#101010'; ctx.fillRect(0, 520, 1280, 200);
                        ctx.fillStyle = '#fff'; ctx.font = '700 64px ui-monospace, monospace'; ctx.textAlign = 'center';
                        ctx.fillText(new Date().toLocaleTimeString(), 640, 640);
                        ctx.font = '600 28px system-ui'; ctx.fillText('design mode · a camera added here', 640, 690);
                        requestAnimationFrame(draw);
                    };
                    draw();
                    return stream = canvas.captureStream(30);
                };
            })()
        },
        themes: {
            list: async () => [
                { id: 'classic', name: 'Classic', version: '1.0.0', author: 'Lanecast', description: 'A lower third: event and heat, the title, the clock, the lanes.', source: 'built-in', overlay: 'overlay.html', control: null, url: '../../themes/classic/' },
                { id: 'template', name: 'Template', version: '1.0.0', author: 'Lanecast', description: 'A starting point for your own theme, with a control panel.', source: 'built-in', overlay: 'overlay.html', control: { page: 'control.html', width: 420, height: 96 }, url: '../../themes/template/' }
            ],
            active: async () => localStorage.getItem('lanecast-mock:theme') || 'classic',
            select: async id => { localStorage.setItem('lanecast-mock:theme', id); return id; },
            create: async () => { throw new Error('Design mode cannot write files; run the app for that'); },
            openFolder: async () => 'Design mode has no themes folder; run the app for that.',
            folder: async () => ''
        },
        store: {
            get: async key => { try { return JSON.parse(localStorage.getItem('lanecast-mock:' + key)); } catch (e) { return null; } },
            set: async (key, value) => { if (value == null) localStorage.removeItem('lanecast-mock:' + key); else localStorage.setItem('lanecast-mock:' + key, JSON.stringify(value)); }
        },
        files: { loadStartLists: async () => [], saveStartLists: async () => null },
        designMode: true
    };
})();
