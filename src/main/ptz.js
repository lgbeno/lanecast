/* Steering a camera: pan, tilt, zoom, home and presets, over VISCA.
 *
 * Nearly every PTZ camera a pool will meet speaks VISCA over the network, either raw on UDP 1259
 * (the PTZOptics family and its many relatives) or in Sony's framing on UDP 52381. Whether a camera
 * can be steered is found by asking it for its version, which moves nothing: an answer means yes.
 *
 * A camera told to pan keeps panning until told to stop, so a held button is renewed several times a
 * second by the window, and if the renewals cease (the window closed, the pointer lost) the camera is
 * stopped from here.
 */
'use strict';
const dgram = require('node:dgram');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** A 16-bit value (negative ones in two's complement) as VISCA sends it: four bytes, a nibble in each. */
const nibbles = v => { const u = Math.round(Number(v) || 0) & 0xffff; return [(u >> 12) & 15, (u >> 8) & 15, (u >> 4) & 15, u & 15]; };
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
/** VISCA messages for camera address 1, as byte arrays. */
const visca = {
    versionInquiry: () => [0x81, 0x09, 0x00, 0x02, 0xff],
    positionInquiry: () => [0x81, 0x09, 0x06, 0x12, 0xff],
    /** Drive: pan and tilt in -1..1, right and up positive, the size the speed. 0, 0 stops. */
    move(pan, tilt) {
        const p = clamp(Number(pan) || 0, -1, 1), t = clamp(Number(tilt) || 0, -1, 1);
        const ps = clamp(Math.round(Math.abs(p) * 0x18), 1, 0x18), ts = clamp(Math.round(Math.abs(t) * 0x14), 1, 0x14);
        return [0x81, 0x01, 0x06, 0x01, ps, ts, p < 0 ? 0x01 : p > 0 ? 0x02 : 0x03, t > 0 ? 0x01 : t < 0 ? 0x02 : 0x03, 0xff];
    },
    /** Zoom in -1..1, in positive, the size the speed. 0 stops. */
    zoom(z) { const v = clamp(Number(z) || 0, -1, 1), s = clamp(Math.round(Math.abs(v) * 7), 0, 7); return [0x81, 0x01, 0x04, 0x07, v > 0 ? 0x20 | s : v < 0 ? 0x30 | s : 0x00, 0xff]; },
    home: () => [0x81, 0x01, 0x06, 0x04, 0xff],
    zoomInquiry: () => [0x81, 0x09, 0x04, 0x47, 0xff],
    /** Go to a pan and tilt read earlier from the position inquiry, at full speed. */
    absolute: (pan, tilt) => [0x81, 0x01, 0x06, 0x02, 0x18, 0x14, ...nibbles(pan), ...nibbles(tilt), 0xff],
    /** Go to a zoom read earlier from the zoom inquiry. */
    zoomTo: zoom => [0x81, 0x01, 0x04, 0x47, ...nibbles(zoom), 0xff],
    /** Go to preset n, or with `save` store where the camera is now as preset n. */
    preset(n, save = false) { return [0x81, 0x01, 0x04, 0x3f, save ? 0x01 : 0x02, clamp(Math.round(Number(n) || 0), 0, 127), 0xff]; }
};
/** Sony's VISCA over IP puts eight bytes in front: the kind (command or inquiry), the length, a running number. */
function frame(body, sequence, inquiry = false) {
    const header = Buffer.alloc(8); header[0] = 0x01; header[1] = inquiry ? 0x10 : 0x00; header.writeUInt16BE(body.length, 2); header.writeUInt32BE(sequence >>> 0, 4);
    return Buffer.concat([header, Buffer.from(body)]);
}
const RESET = Buffer.from([0x02, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01]);          // "start counting from one again"
/** The VISCA reply inside a datagram, framed or not: its bytes from 0x90 to 0xff, or null. */
function unframe(buf) {
    let b = buf;
    if (b.length > 8 && (b[0] === 0x01 || b[0] === 0x02) && (b[8] & 0xf0) === 0x90) b = b.subarray(8);
    return b.length >= 3 && (b[0] & 0xf0) === 0x90 && b[b.length - 1] === 0xff ? [...b] : null;
}
/** The answer to the version inquiry: 90 50 then vendor, model and version bytes. */
const isVersion = message => !!message && message[1] === 0x50 && message.length >= 7;
/** Pan and tilt out of the position inquiry's answer (four nibbles each, signed), or null. */
function position(message) {
    if (!message || message[1] !== 0x50 || message.length !== 11) return null;
    const read = i => { const v = ((message[i] & 15) << 12) | ((message[i + 1] & 15) << 8) | ((message[i + 2] & 15) << 4) | (message[i + 3] & 15); return v > 0x7fff ? v - 0x10000 : v; };
    return { pan: read(2), tilt: read(6) };
}

/** The zoom out of the zoom inquiry's answer (90 50 then four nibbles), or null. */
function zoomOf(message) {
    if (!message || message[1] !== 0x50 || message.length !== 7) return null;
    return ((message[2] & 15) << 12) | ((message[3] & 15) << 8) | ((message[4] & 15) << 4) | (message[5] & 15);
}

// Named positions. The person names where the camera points. What is kept under the name is where the camera said it was
// pointing, { pan, tilt, zoom }, read from it when the position is saved: so the position lives in the project, nothing
// has to be stored in the camera, and opening the project on another day needs no re-programming. A camera that will not
// say where it points gets the older arrangement instead: one of its own numbered presets, { preset }, chosen here.
// 0 to 9 are left alone (they are what people store from the camera's own remote), and so are 90 and up (several makers
// give those numbers special jobs, such as opening the camera's menu).
const PRESET_FIRST = 10, PRESET_LAST = 89;
/** The lowest preset number no position of this camera uses yet, or null when they are all taken. */
function allocatePreset(positions) {
    const used = new Set((positions || []).map(p => p.preset).filter(Number.isInteger));
    for (let n = PRESET_FIRST; n <= PRESET_LAST; n++) if (!used.has(n)) return n;
    return null;
}
/** A camera's positions as read from a settings or project file: [{ name, pan, tilt, zoom }] or [{ name, preset }], each name once. */
function cleanPositions(list) {
    const out = [], names = new Set(), numbers = new Set();
    for (const p of Array.isArray(list) ? list : []) {
        const name = String((p && p.name) || '').trim().slice(0, 40);
        if (!name || names.has(name.toLowerCase())) continue;
        if (whole(p.pan, -32768, 32767) && whole(p.tilt, -32768, 32767)) out.push({ name, pan: p.pan, tilt: p.tilt, zoom: whole(p.zoom, 0, 65535) ? p.zoom : null });
        else if (whole(p.preset, 0, 127) && !numbers.has(p.preset)) { numbers.add(p.preset); out.push({ name, preset: p.preset }); }
        else continue;
        names.add(name.toLowerCase());
    }
    return out;
}

const WAYS = [{ port: 1259, framed: false }, { port: 52381, framed: true }];
/** Send one inquiry and wait for its answer: the VISCA bytes, or null when nothing came. */
function ask(host, way, body, ms = 700) {
    return new Promise(resolve => {
        const socket = dgram.createSocket('udp4'); let done = false;
        const finish = value => { if (done) return; done = true; try { socket.close(); } catch (e) { /* closed */ } resolve(value); };
        socket.on('message', buf => { const message = unframe(buf); if (message && message[1] === 0x50) finish(message); });
        socket.on('error', () => finish(null));
        socket.send(way.framed ? frame(body, 1, true) : Buffer.from(body), way.port, host, error => { if (error) finish(null); });
        setTimeout(() => finish(null), ms);
    });
}
/** Can the camera at `host` be steered? { protocol: 'VISCA', port, framed, version } or null. Moves nothing. */
async function detect(host) {
    for (const way of WAYS) {
        const message = await ask(host, way, visca.versionInquiry());
        if (isVersion(message)) return { protocol: 'VISCA', port: way.port, framed: way.framed, version: message.slice(2, -1).map(b => b.toString(16).padStart(2, '0')).join('') };
    }
    return null;
}

const HOLD_MS = 900;            // a drive not renewed within this is stopped
class Ptz {
    constructor() { this.known = new Map(); this.links = new Map(); }
    /** What `detect` says for this host, remembered: a yes for the session, a no for half a minute. */
    async probe(host) {
        const had = this.known.get(host);
        if (had && (had.info || Date.now() - had.at < 30000)) return had.info;
        const info = await detect(host);
        this.known.set(host, { info, at: Date.now() });
        return info;
    }
    forget() { for (const [host, entry] of this.known) if (!entry.info) this.known.delete(host); }
    _link(host) {
        const info = this.known.get(host)?.info; if (!info) return null;
        let link = this.links.get(host);
        if (!link) {
            link = { socket: dgram.createSocket('udp4'), info, sequence: 0, timer: null };
            link.socket.on('error', () => {}); link.socket.unref();
            if (info.framed) link.socket.send(RESET, info.port, host, () => {});
            this.links.set(host, link);
        }
        return link;
    }
    _send(host, body) {
        const link = this._link(host); if (!link) return false;
        link.socket.send(link.info.framed ? frame(body, ++link.sequence) : Buffer.from(body), link.info.port, host, () => {});
        return true;
    }
    _hold(host, moving) {
        const link = this.links.get(host); if (!link) return;
        clearTimeout(link.timer); link.timer = moving ? setTimeout(() => this.stop(host), HOLD_MS) : null;
    }
    move(host, pan, tilt) { const ok = this._send(host, visca.move(pan, tilt)); this._hold(host, !!(Number(pan) || Number(tilt))); return ok; }
    zoom(host, z) { const ok = this._send(host, visca.zoom(z)); this._hold(host, !!Number(z)); return ok; }
    stop(host) { const ok = this._send(host, visca.move(0, 0)); this._send(host, visca.zoom(0)); this._hold(host, false); return ok; }
    home(host) { return this._send(host, visca.home()); }
    preset(host, n, save) { return this._send(host, visca.preset(n, save)); }
    /** Where the camera points now, { pan, tilt, zoom } in its own units (zoom null if it will not say), or null. */
    async where(host) {
        const info = this.known.get(host)?.info; if (!info) return null;
        const spot = position(await ask(host, info, visca.positionInquiry()));
        return spot ? { ...spot, zoom: zoomOf(await ask(host, info, visca.zoomInquiry())) } : null;
    }
    /** Send the camera to a place read earlier with `where`. */
    goTo(host, spot) {
        const ok = this._send(host, visca.absolute(spot.pan, spot.tilt));
        if (ok && Number.isInteger(spot.zoom)) this._send(host, visca.zoomTo(spot.zoom));
        this._hold(host, false);
        return ok;
    }
    /** Stop everything that is moving and let the sockets go: on quit. */
    close() { for (const [host, link] of this.links) { if (link.timer) this.stop(host); clearTimeout(link.timer); try { link.socket.close(); } catch (e) { /* closed */ } } this.links.clear(); }
}

module.exports = { Ptz, detect, visca, frame, unframe, isVersion, position, zoomOf, allocatePreset, cleanPositions, HOLD_MS, PRESET_FIRST, PRESET_LAST };
