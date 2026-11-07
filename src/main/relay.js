/* The overlay feed: a WebSocket server inside the app. Every packet the window publishes is
 * sent to every overlay connected, on this machine or elsewhere on the network.
 */
'use strict';
const os = require('node:os');
const { WebSocketServer } = require('ws');

class Relay {
    constructor({ port = 8080, onStatus = () => {} } = {}) {
        this.port = port; this.onStatus = onStatus;
        this.server = null; this.clients = new Set(); this.sent = 0; this.error = ''; this.listening = false;
    }
    start() {
        this.error = ''; this.listening = false;
        try { this.server = new WebSocketServer({ port: this.port, host: '0.0.0.0' }); }
        catch (e) { this.error = e.message; this._changed(); return; }
        this.server.on('listening', () => { this.listening = true; this._changed(); });
        this.server.on('error', e => { this.error = e.code === 'EADDRINUSE' ? `port ${this.port} is in use by another program` : e.message; this.listening = false; this._changed(); });
        this.server.on('connection', socket => {
            this.clients.add(socket); this._changed();
            socket.on('message', () => {});          // overlays only listen
            socket.on('error', () => {});
            socket.on('close', () => { this.clients.delete(socket); this._changed(); });
        });
    }
    broadcast(text) {
        if (typeof text !== 'string') return;
        let delivered = 0;
        for (const socket of this.clients) if (socket.readyState === 1) { socket.send(text); delivered++; }
        if (delivered) this.sent++;
    }
    /** Addresses an overlay on another machine could use. */
    hosts() {
        const out = [];
        for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
        return out;
    }
    status() { return { port: this.port, listening: this.listening, clients: this.clients.size, sent: this.sent, error: this.error, hosts: this.hosts() }; }
    _changed() { this.onStatus(this.status()); }
    stop() {
        for (const socket of this.clients) socket.terminate();
        this.clients.clear();
        if (this.server) { this.server.close(); this.server = null; }
        this.listening = false;
    }
}

module.exports = { Relay };
