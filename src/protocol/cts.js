/* Colorado Time Systems scoreboard output: the legacy serial feed a timing console sends to
 * its numeric scoreboard, not the meet-management results port and not the Gen7 protocol.
 * Channel/digit mapping informed by Fabrizio Bertocci's MIT coloradoScoreboard; see
 * THIRD_PARTY_NOTICES.md. This module only reads: nothing is ever written to the console.
 * Protocol notes: docs/timer-protocol.md
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const digit = v => v >= 6 && v <= 15 ? String(15 - v) : ' ';
    const number = a => { if (a.some(v => v === null || (v > 0 && v < 6))) return null; const s = a.map(digit).join('').trim(); return /^\d+$/.test(s) ? Number(s) : null; };
    function time(values, running = false) {
        const raw = values.slice(2, running ? 7 : 8);
        if (raw.some(v => v === null || (v > 0 && v < 6))) return '';
        const chars = raw.map(digit);
        if (!chars.some(c => c !== ' ')) return '';
        // Blank leading minute/second positions are normal; fractional blanks are not.
        const fraction = chars.slice(4).join('');
        if (!/^\d+$/.test(fraction)) return '';
        const minutes = Number(chars.slice(0, 2).join('').trim() || 0);
        const seconds = Number(chars.slice(2, 4).join('').trim() || 0);
        if (seconds >= 60) return '';
        return minutes + ':' + String(seconds).padStart(2, '0') + '.' + fraction;
    }
    class Decoder {
        constructor() { this.reset(); }
        reset() {
            this.channels = Array.from({ length: 32 }, () => ({ digits: Array(8).fill(null), format: Array(8).fill(null), universal: false, at: null }));
            this.pending = null; this.bytes = 0; this.blocks = 0; this.orphans = 0;
            this.event = null; this.heat = null; this.generationAt = -1; this.generation = 0;
            this.clockAt = null; this.clock = ''; this.clockSeconds = null; this.state = 'unknown';
            this.lastAdvanceAt = null; this.clockSequence = 0; this.resetSequence = -1;
        }
        feed(bytes, at = 0) {
            for (const byte of bytes) {
                if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('Invalid serial byte');
                this.bytes++;
                if (byte & 128) {
                    this.commit(at);
                    this.pending = { channel: ((byte >> 1) & 31) ^ 31, readout: !(byte & 1), universal: !!(byte & 64), values: new Map() };
                } else if (this.pending) this.pending.values.set(byte >> 4, byte & 15);
                else this.orphans++;
            }
        }
        // Blocks end at the next control byte. Never flush at a serial-read boundary.
        finish(at = 0) { this.commit(at); }
        commit(at) {
            const p = this.pending; this.pending = null;
            if (!p || !p.values.size) return;
            this.blocks++;
            const c = this.channels[p.channel];
            if (p.readout) {
                if (p.universal) c.digits.fill(null);
                c.universal = p.universal;
                for (const [index, value] of p.values) c.digits[index] = value;
                c.at = at; c.generation = this.generation;
            } else for (const [index, value] of p.values) c.format[index] = value;
            if (p.channel === 12 && p.readout) {
                const event = number(c.digits.slice(0, 3)), heat = number(c.digits.slice(5, 8));
                if (event !== this.event || heat !== this.heat) {
                    this.event = event; this.heat = heat; this.generationAt = at; this.generation++;
                }
            }
            if (p.channel === 0 && p.readout) {
                this.clockSequence++;
                this.clock = time(c.digits, true); this.clockAt = at;
                const parts = this.clock.split(':');
                const seconds = this.clock ? Number(parts[0]) * 60 + Number(parts[1]) : null;
                if (seconds !== null && this.clockSeconds !== null && seconds > this.clockSeconds) {
                    this.state = 'running'; this.lastAdvanceAt = at;
                } else if (seconds === null || (this.clockSeconds !== null && seconds < this.clockSeconds)) this.state = 'unknown';
                this.clockSeconds = seconds;
            }
            // Reset-dot observation is provisional. Require a fresh zero clock AND a
            // later format block; a stalled clock alone never proves the timer stopped.
            if (!p.readout && p.channel >= 1 && p.channel <= 10 && p.values.get(0) === 13 &&
                this.clockSeconds === 0 && this.clockAt !== null && at - this.clockAt < 500) {
                this.state = 'reset'; this.resetSequence = this.clockSequence;
            }
            if (this.state === 'reset' && this.clockSeconds > 0) this.state = 'unknown';
        }
        snapshot(at = 0) {
            const stale = this.clockAt === null || at - this.clockAt > 1500;
            let state = stale ? 'unknown' : this.state;
            if (state === 'running' && at - this.lastAdvanceAt > 1500) state = 'unknown';
            const lanes = Array.from({ length: 10 }, (_, i) => {
                const c = this.channels[i + 1];
                const fresh = c.generation === this.generation && state !== 'reset';
                return { lane: i + 1, displayedLane: digit(c.digits[0]).trim(),
                    place: fresh ? digit(c.digits[1]).trim() : '',
                    time: fresh && !c.universal ? time(c.digits) : '', followsClock: c.universal };
            });
            return { event: this.event, heat: this.heat, clock: this.clock, state, stale, lanes,
                bytes: this.bytes, blocks: this.blocks, orphans: this.orphans,
                channels: this.channels.map((c, i) => ({ channel: i, display: c.digits.map(digit).join(''),
                    readout: c.digits.slice(), format: c.format.slice(), universal: c.universal })) };
        }
    }
    /** One Meet Manager start-list file (.scb): "#<event> <title>", then 38-character lane slots in groups of ten. */
    function parseSCB(text) {
        const lines = text.replace(/^﻿/, '').replace(/\r/g, '').split('\n');
        if (lines.at(-1) === '') lines.pop();
        const header = /^#(\d+)\s+(.+)$/.exec(lines.shift() || '');
        if (!header) throw new Error('SCB must begin with #event and an event title');
        if (!lines.length || lines.length % 10) throw new Error('SCB must contain groups of 10 lane slots; blank slots must be preserved');
        const slots = lines.map((line, i) => {
            const delimiter = line.indexOf('--');
            if (delimiter < 0) throw new Error('Missing SCB team separator at slot ' + (i + 1));
            return { name: line.slice(0, delimiter).trim(), team: line.slice(delimiter + 2).trim() };
        });
        return { event: Number(header[1]), title: header[2].trim(), heats: Array.from({ length: slots.length / 10 }, (_, i) => slots.slice(i * 10, i * 10 + 10)) };
    }
    /** The inverse of parseSCB: one event as Meet Manager writes it, CRLF lines and 38-character slots
     *  (name padded to 20, "--", team padded to 16). A heat that is missing is written as ten empty slots. */
    function formatSCB({ event, title, heats }) {
        const lines = ['#' + event + ' ' + (String(title || '').trim() || 'Event ' + event)];
        for (const heat of heats) for (let i = 0; i < 10; i++) {
            const a = (heat && heat[i]) || {};
            lines.push(String(a.name || '').slice(0, 20).padEnd(20) + '--' + String(a.team || '').slice(0, 16).padEnd(16));
        }
        return lines.join('\r\n') + '\r\n';
    }
    function csvRows(text) {
        const rows = []; let row = [], field = '', quoted = false;
        text = text.replace(/^﻿/, '');
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '"') {
                if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
            } else if (!quoted && (ch === ',' || ch === '\n')) {
                row.push(field.replace(/\r$/, '')); field = '';
                if (ch === '\n') { rows.push(row); row = []; }
            } else field += ch;
        }
        if (quoted) throw new Error('Unclosed CSV quote');
        if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
        return rows;
    }
    /** A serial-monitor CSV export (Time, Dir, Hex Data, Bytes columns) as timed chunks: [{ at, bytes }], ms from the first. */
    function parseCapture(text) {
        const rows = csvRows(text), headers = rows.shift() || [];
        const col = name => { const i = headers.indexOf(name); if (i < 0) throw new Error('Missing CSV column: ' + name); return i; };
        const ti = col('Time'), di = col('Dir'), hi = col('Hex Data'), bi = col('Bytes');
        let previous = null, day = 0, origin = null;
        const chunks = [];
        for (const [index, row] of rows.entries()) {
            if (row.every(v => !v.trim())) continue;
            if (!/^RX\b/.test(row[di] || '')) continue;
            const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(row[ti] || '');
            if (!match || +match[1] > 23 || +match[2] > 59 || +match[3] > 59) throw new Error('Invalid time on CSV row ' + (index + 2));
            let ms = ((+match[1] * 60 + +match[2]) * 60 + +match[3]) * 1000 + +match[4];
            if (previous !== null && ms < previous) {
                if (previous - ms < 43200000) throw new Error('Capture timestamps go backwards');
                day += 86400000;
            }
            previous = ms; ms += day; if (origin === null) origin = ms;
            const hex = (row[hi] || '').trim();
            if (!/^(?:[a-f\d]{2})(?:\s+[a-f\d]{2})*$/i.test(hex)) throw new Error('Invalid hex on CSV row ' + (index + 2));
            const bytes = Uint8Array.from(hex.split(/\s+/), v => parseInt(v, 16));
            if (!/^\d+$/.test(row[bi] || '') || bytes.length !== Number(row[bi])) throw new Error('Byte count mismatch on CSV row ' + (index + 2));
            chunks.push({ at: ms - origin, bytes });
        }
        if (!chunks.length) throw new Error('No RX data found');
        return chunks;
    }
    /** How steadily the clock counts through a capture. A correctly framed feed steps one tenth at a
     *  time; one recorded at the wrong baud or parity jumps about. */
    function clockSteps(chunks) {
        const d = new Decoder(); let sequence = 0, previous = null, changes = 0, steady = 0;
        for (const c of chunks) for (let i = 0; i < c.bytes.length; i++) {
            d.feed(c.bytes.subarray(i, i + 1), c.at);
            if (d.clockSequence === sequence) continue;
            sequence = d.clockSequence;
            const tenths = d.clock ? Math.round(Number(d.clock.split(':')[0]) * 600 + Number(d.clock.split(':')[1]) * 10) : null;
            if (tenths !== null && previous !== null && tenths !== previous) { changes++; if (tenths - previous === 1) steady++; }
            if (tenths !== null) previous = tenths;
        }
        return { clocks: sequence, changes, steady };
    }
    class Replay {
        constructor(chunks) { this.chunks = chunks; this.decoder = new Decoder(); this.index = 0; this.at = 0; this.duration = chunks.at(-1)?.at || 0; }
        seek(at) {
            at = Math.max(0, Math.min(this.duration, at));
            if (at < this.at) { this.decoder.reset(); this.index = 0; }
            while (this.index < this.chunks.length && this.chunks[this.index].at <= at) {
                const c = this.chunks[this.index++]; this.decoder.feed(c.bytes, c.at);
            }
            if (this.index === this.chunks.length) this.decoder.finish(this.duration);
            this.at = at; return this.decoder.snapshot(at);
        }
    }
    /** Hands out a capture's bytes as they arrived. A capture stamps a whole chunk with the time it was
     *  read, but its bytes took time on the line before that, so they are spread back over it at line
     *  rate (11 bits a byte). Chunk times start at zero. */
    class Pacer {
        constructor(chunks, baud = 9600) { this.chunks = chunks; this.perByte = 11000 / baud; this.duration = chunks.length ? chunks.at(-1).at : 0; this.rewind(); }
        rewind() { this.index = 0; this.offset = 0; }
        /** Everything not yet handed out that had arrived by `target` ms: [{ at, bytes }]. */
        take(target) {
            const out = [];
            while (this.index < this.chunks.length) {
                const c = this.chunks[this.index];
                const began = Math.max(this.index ? this.chunks[this.index - 1].at : -Infinity, c.at - c.bytes.length * this.perByte);
                const end = target >= c.at ? c.bytes.length : Math.max(0, Math.floor(c.bytes.length * (target - began) / (c.at - began)));
                if (end > this.offset) { out.push({ at: Math.min(target, c.at), bytes: c.bytes.subarray(this.offset, end) }); this.offset = end; }
                if (end < c.bytes.length) break;
                this.index++; this.offset = 0;
            }
            return out;
        }
    }
    return { Decoder, Replay, Pacer, parseSCB, formatSCB, parseCapture, clockSteps };
});
