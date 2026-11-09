/* The runtime every Lanecast theme page loads: <script src="../lanecast-theme.js"></script>
 *
 * Inside Lanecast the page runs in a frame and talks to the app with postMessage. Opened
 * anywhere else (an OBS browser source, a browser tab) it connects to the app's WebSocket
 * feed instead, ws://localhost:8080/ unless ?feed=ws://host:port/ says otherwise, and the
 * director calls do nothing. Either way the page sees the same messages.
 *
 *   Lanecast.on('state', s => ...)            every change: event, heat, title, clock, phase, lanes, cameras
 *   Lanecast.on('heat.finish', e => ...)      or any other event: event.change, heat.lineup, race.start,
 *                                             race.reset, lane.split, lane.finish, heat.finish, event.finish
 *   Lanecast.on('control', m => ...)          a message sent by this theme's control panel
 *   Lanecast.on('overlay', m => ...)          a message sent by the overlay
 *   Lanecast.on('dialog', m => ...)           a message sent by one of the theme's dialogs
 *   Lanecast.on('settings', s => ...)         the theme's saved settings, at start and whenever they change
 *   Lanecast.state                            the latest state message
 *   Lanecast.settings                         the theme's saved settings (an object you define)
 *   Lanecast.camera(idOrName)                 put that camera on the program
 *   Lanecast.layout({ x, y, w, h, fit })      place the camera: fractions of the picture (0-1), fit 'cover' | 'contain'
 *   Lanecast.position(name, camera?)          steer a camera to a position saved under that name (the program camera
 *                                             unless one is named); state.cameras[i].positions lists the names
 *   Lanecast.steer({ pan, tilt, zoom }, camera?)  drive a camera, each -1..1 (right, up, in; the size is the speed). Call it again
 *                                             several times a second while it should keep moving: it stops by itself within a
 *                                             second of the last call. Lanecast.steer() stops at once
 *   Lanecast.send(message)                    to the theme's other pages: they get it as on('<your role>')
 *   Lanecast.saveSettings({ ... })            merge into the saved settings; every page gets 'settings'
 *   Lanecast.dialog('settings.html', opts)    pop out a page of this theme as a modal: { title, width, height }
 *   Lanecast.closeDialog()                    close it (from inside or outside)
 *   Lanecast.log(...)                         show up in Lanecast's console
 *
 * Full reference: docs/themes.md
 */
(function () {
    'use strict';
    const handlers = {};
    const on = (name, fn) => { (handlers[name] ||= []).push(fn); return () => { handlers[name] = handlers[name].filter(f => f !== fn); }; };
    const fire = (name, payload) => { for (const fn of handlers[name] || []) { try { fn(payload); } catch (e) { console.error('[theme] handler for ' + name, e); } } for (const fn of handlers['*'] || []) fn(name, payload); };
    const framed = window.parent !== window;
    const role = new URLSearchParams(location.search).get('role') || 'overlay';
    const api = { state: null, role, framed, cameras: [], settings: {} };
    let post = () => {};

    function receive(message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'state') { api.state = message; api.cameras = message.cameras || api.cameras; fire('state', message); }
        else if (message.type === 'event') fire(message.name, message);
        else if (message.type === 'control' || message.type === 'overlay' || message.type === 'dialog') fire(message.type, message.data);
        else if (message.type === 'settings') { api.settings = message.data || {}; fire('settings', api.settings); }
        else if (message.type === 'hello') { api.theme = message.theme; api.size = message.size; api.settings = message.settings || {}; fire('hello', message); fire('settings', api.settings); }
    }
    if (framed) {
        window.addEventListener('message', e => { if (e.source === window.parent) receive(e.data); });
        post = message => window.parent.postMessage(message, '*');
    } else {
        const url = new URLSearchParams(location.search).get('feed') || 'ws://localhost:8080/';
        let socket;
        const connect = () => {
            try { socket = new WebSocket(url); } catch (e) { setTimeout(connect, 3000); return; }
            socket.onmessage = e => { try { receive(JSON.parse(e.data)); } catch (err) { /* not ours */ } };
            socket.onclose = () => setTimeout(connect, 3000);
            socket.onerror = () => {};
        };
        connect();
    }
    api.on = on;
    api.camera = idOrName => post({ type: 'camera', select: idOrName });
    api.layout = box => post({ type: 'layout', ...box });
    api.position = (name, camera) => post({ type: 'position', name: String(name), camera: camera === undefined ? null : camera });
    api.steer = (drive, camera) => { const v = drive || {}; post({ type: 'steer', pan: Number(v.pan) || 0, tilt: Number(v.tilt) || 0, zoom: Number(v.zoom) || 0, camera: camera === undefined ? null : camera }); };
    api.send = data => post({ type: 'send', data });
    api.saveSettings = data => post({ type: 'settings', data });
    api.dialog = (page, options = {}) => post({ type: 'dialog', page, title: options.title || '', width: options.width || 520, height: options.height || 480 });
    api.closeDialog = () => post({ type: 'closeDialog' });
    api.log = (...args) => { console.log('[theme]', ...args); post({ type: 'log', message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') }); };
    /** Ordinal: 1 -> 1st, 2 -> 2nd … */
    api.ordinal = n => { const v = Number(n); if (!v) return String(n); const s = ['th', 'st', 'nd', 'rd'], k = v % 100; return v + (s[(k - 20) % 10] || s[k] || s[0]); };
    window.Lanecast = api;
    document.addEventListener('DOMContentLoaded', () => post({ type: 'ready', role }));
})();
