/* The two serial ports, opened from the main process: the timing console's scoreboard output
 * and Meet Manager's scoreboard link. Each role knows its own line settings; nothing is written
 * to either device. A port that drops out is reopened as soon as it is back.
 */
'use strict';
const { EventEmitter } = require('node:events');
const Sim = require('../protocol/simulator');

const ROLES = {
    timer: { baudRate: 9600, dataBits: 8, parity: 'even', stopBits: 1 },
    meet: { baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 }
};
const RETRY_MS = 2000;
const SIM_PORTS = [
    { path: 'sim:timer', label: 'Simulated timing console' },
    { path: 'sim:meet', label: 'Simulated Meet Manager' }
];

/** A port of the simulated meet. The meet runs from the first time the console is opened. */
let epoch = null;
class SimPort extends EventEmitter {
    constructor(path) { super(); this.kind = path.slice(4); this.interval = null; this.meetManager = null; this.walking = true; this.isOpen = false; }
    open(callback) {
        if (this.kind === 'timer') {
            if (epoch === null) epoch = performance.now();
            const source = new Sim.TimerSource(); source.seek(performance.now() - epoch);
            this.interval = setInterval(() => { const bytes = source.read(performance.now() - epoch); if (bytes.length) this.emit('data', Buffer.from(bytes)); }, 25);
        } else {
            // Meet Manager's transmit line: a scoreboard computer walks the meet until this app sends a request itself.
            this.meetManager = new Sim.MeetManager();
            this.interval = setInterval(() => { const reply = this.walking && this.meetManager.walkNext(); if (reply) this.emit('data', Buffer.from(reply)); }, 670);
        }
        this.isOpen = true; callback(null);
    }
    write(bytes, callback) {
        if (this.meetManager) { this.walking = false; for (const reply of this.meetManager.write(bytes)) setTimeout(() => this.emit('data', Buffer.from(reply)), 16); }
        if (callback) callback(null);
    }
    close(callback) { clearInterval(this.interval); this.isOpen = false; if (callback) callback(null); this.emit('close', null); }
}

const describe = p => [p.path, p.manufacturer, p.serialNumber && 'S/N ' + p.serialNumber].filter(Boolean).join(' · ');

class SerialRoles {
    /** `onData(role, Uint8Array)` and `onState(role, { state, message, path })` report to the window. */
    constructor({ simulated = false, onData, onState }) {
        this.simulated = simulated; this.onData = onData; this.onState = onState;
        this.ports = { timer: null, meet: null }; this.want = { timer: null, meet: null }; this.retry = { timer: null, meet: null };
        this.states = { timer: { state: 'closed', message: '', path: null }, meet: { state: 'closed', message: '', path: null } };
    }
    async list() {
        if (this.simulated) return SIM_PORTS;
        const { SerialPort } = require('serialport');
        const ports = await SerialPort.list();
        // USB adapters first; a Mac's Bluetooth and debug ports go to the bottom.
        const rank = p => /usb|acm/i.test(p.path) || p.vendorId ? 0 : 1;
        return ports.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path)).map(p => ({ path: p.path, label: describe(p) }));
    }
    state(role) { return this.states[role]; }
    _state(role, state, message, path) { this.states[role] = { state, message, path }; this.onState(role, this.states[role]); }
    _create(role, path) {
        if (this.simulated) {
            if (!SIM_PORTS.some(p => p.path === path)) throw new Error('No such simulated port: ' + path);
            return new SimPort(path);
        }
        const { SerialPort } = require('serialport');
        return new SerialPort({ path, ...ROLES[role], autoOpen: false });
    }
    /** Open `path` for `role`, replacing whatever that role had. Rejects if the port cannot be opened. */
    async open(role, path) {
        if (!ROLES[role]) throw new Error('Unknown port role');
        if (typeof path !== 'string' || !path) throw new Error('Choose a port first');
        const other = role === 'timer' ? 'meet' : 'timer';
        if (this.want[other] === path) throw new Error('That port is already connected as the other one. Choose a different port.');
        await this.close(role);
        this.want[role] = path;
        this._state(role, 'connecting', 'Connecting…', path);
        await this._connect(role, true);
    }
    _connect(role, first) {
        const path = this.want[role];
        let port;
        try { port = this._create(role, path); } catch (e) { this.want[role] = null; this._state(role, 'closed', 'Not connected.', null); return Promise.reject(e); }
        this.ports[role] = port;
        port.on('data', chunk => { if (this.ports[role] === port) this.onData(role, new Uint8Array(chunk)); });
        port.on('error', e => { if (this.ports[role] === port) this._state(role, 'error', e.message, path); });
        port.on('close', () => {
            if (this.ports[role] !== port) return;
            this.ports[role] = null;
            if (this.want[role] === path) this._later(role, 'Port lost · reconnecting…');
            else this._state(role, 'closed', 'Not connected.', null);
        });
        return new Promise((resolve, reject) => port.open(err => {
            if (!err) { this._state(role, 'open', '', path); resolve(); return; }
            this.ports[role] = null;
            if (first) { this.want[role] = null; this._state(role, 'closed', 'Not connected.', null); reject(new Error(`Could not open ${path}: ${err.message}`)); }
            else { this._later(role, 'Port not back yet · retrying…'); resolve(); }
        }));
    }
    _later(role, message) {
        this._state(role, 'retrying', message, this.want[role]);
        clearTimeout(this.retry[role]);
        this.retry[role] = setTimeout(() => { if (this.want[role]) this._connect(role, false).catch(() => {}); }, RETRY_MS);
    }
    async close(role) {
        if (!ROLES[role]) throw new Error('Unknown port role');
        clearTimeout(this.retry[role]); this.retry[role] = null; this.want[role] = null;
        const port = this.ports[role]; this.ports[role] = null;
        if (port && port.isOpen) await new Promise(resolve => port.close(() => resolve()));
        this._state(role, 'closed', 'Not connected.', null);
    }
    closeAll() { for (const role of Object.keys(ROLES)) { clearTimeout(this.retry[role]); this.want[role] = null; const p = this.ports[role]; this.ports[role] = null; if (p && p.isOpen) p.close(() => {}); } }
}

module.exports = { SerialRoles, ROLES, SIM_PORTS };
