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
 *   Lanecast.on('control', m => ...)          a message from this theme's control panel
 *   Lanecast.on('overlay', m => ...)          (in the control panel) a message from the overlay
 *   Lanecast.state                            the latest state message
 *   Lanecast.camera(idOrName)                 put that camera on the program
 *   Lanecast.layout({ x, y, w, h, fit })      place the camera: fractions of the picture (0-1), fit 'cover' | 'contain'
 *   Lanecast.send(message)                    overlay -> control panel, or control panel -> overlay
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
    const api = { state: null, role, framed, cameras: [] };
    let post = () => {};

    function receive(message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'state') { api.state = message; api.cameras = message.cameras || api.cameras; fire('state', message); }
        else if (message.type === 'event') fire(message.name, message);
        else if (message.type === 'control' || message.type === 'overlay') fire(message.type, message.data);
        else if (message.type === 'hello') { api.theme = message.theme; api.size = message.size; fire('hello', message); }
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
    api.send = data => post({ type: role === 'control' ? 'control' : 'overlay', data });
    api.log = (...args) => { console.log('[theme]', ...args); post({ type: 'log', message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') }); };
    /** Ordinal: 1 -> 1st, 2 -> 2nd … */
    api.ordinal = n => { const v = Number(n); if (!v) return String(n); const s = ['th', 'st', 'nd', 'rd'], k = v % 100; return v + (s[(k - 20) % 10] || s[k] || s[0]); };
    window.Lanecast = api;
    document.addEventListener('DOMContentLoaded', () => post({ type: 'ready', role }));
})();
