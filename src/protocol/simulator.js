/* Simulated devices for running the app without hardware (`npm run simulate`).
 *
 * Two made-up devices run a short meet on a loop: a timing console's scoreboard output and
 * Meet Manager's generic scoreboard link. The bytes are built from this project's own reading
 * of both protocols, so they exercise the app end to end. They are not evidence about the real
 * links. Every name is invented.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Sim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    // Lanes 1-8 in order; null is an empty lane. `seconds` is roughly the winning time.
    const MEET = [
        { event: 1, title: 'Girls 11-12 50 Free', gender: 'G', seconds: 28, heats: [
            [null, ['Marlowe, Tessa', 'DOLF'], ['Okafor, Nia', 'RAYS'], ['Lindqvist, Freya', 'DOLF'], ['Castellano, Mia', 'WAVE'], ['Brightwater, June', 'RAYS'], ['Hale, Rowan', 'WAVE'], null],
            [['Pemberton, Ivy', 'OTTR'], ['Nakagawa, Emi', 'WAVE'], ['Featherstonehaugh, Josephine', 'DOLF'], ['Abernathy, Cleo', 'RAYS'], ['Quill, Harper', 'OTTR'], ['Vasquez, Lucia', 'DOLF'], ['Thorne, Maeve', 'RAYS'], ['Underhill, Posy', 'WAVE']] ] },
        { event: 2, title: 'Boys 11-12 50 Back', gender: 'B', seconds: 33, heats: [
            [null, null, ['Whitlock, Ezra', 'RAYS'], ['Banerjee, Kiran', 'OTTR'], ['Sorensen, Leif', 'WAVE'], ['Dunmore, Felix', 'DOLF'], null, null],
            [['Ashworth, Theo', 'DOLF'], ['Kowalczyk, Jan', 'RAYS'], ['Montague, Silas', 'WAVE'], ['Iwu, Chidi', 'OTTR'], ['Fairbanks, Otis', 'RAYS'], ['Roswell, Jude', 'DOLF'], ['Elkins, Wade', 'OTTR'], null] ] },
        { event: 3, title: 'Mixed 10&U 100 Free Relay', gender: 'X', seconds: 64, heats: [
            [null, ['Relay-B', 'WAVE'], ['Relay-A', 'RAYS'], ['Relay-A', 'DOLF'], ['Relay-A', 'WAVE'], ['Relay-A', 'OTTR'], ['Relay-B', 'DOLF'], null] ] }
    ];
    const TICK = 100;            // ms; the console sends the clock every tenth
    const LINEUP = 80;           // ticks at 0:00.0 before the start
    const AFTER = 30;            // ticks the clock keeps running after the last touch
    const RESULTS = 80;          // ticks the stopped clock and results stay up
    const SPLIT_HOLD = 500;      // hundredths a split stays on a lane before the clock returns
    const LINE_BUDGET = 87;      // bytes per tick: 9600 baud, 11 bits per 8E1 character

    function rng(seed) {         // mulberry32, so the meet is the same every run
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    /** Lay the meet out on a timeline of ticks, with a split, final time and place per swimmer. */
    function plan(meet) {
        const heats = []; let start = 0;
        for (const e of meet) e.heats.forEach((entries, h) => {
            const random = rng(e.event * 100 + h);
            const lanes = Array.from({ length: 8 }, (_, i) => {
                if (!entries[i]) return null;
                const final = Math.round(e.seconds * 100 * (1 + random() * 0.18));
                return { final, split: Math.round(final * (0.46 + random() * 0.03)), place: 0 };
            });
            const order = lanes.filter(Boolean).sort((a, b) => a.final - b.final);
            order.forEach((l, i) => { if (i && l.final <= order[i - 1].final) l.final = order[i - 1].final + 1; l.place = i + 1; });
            const race = Math.ceil(order.at(-1).final / 10) + AFTER;
            heats.push({ event: e.event, heat: h + 1, lanes, start, race, ticks: LINEUP + race + RESULTS });
            start += LINEUP + race + RESULTS;
        });
        return heats;
    }

    // ---- timing console: legacy scoreboard blocks, as src/protocol/cts.js reads them ----------
    const control = (channel, format, universal) => 128 | ((channel ^ 31) << 1) | (format ? 1 : 0) | (universal ? 64 : 0);
    const glyph = ch => ch === ' ' ? 0 : 15 - Number(ch);
    const data = (chars, first = 0) => Array.from(chars, (ch, i) => ((i + first) << 4) | glyph(ch));
    const two = n => String(n).padStart(2, '0');
    // Positions 2-5 of a clock or lane time: MMSS with leading zeros blanked down to the seconds digit.
    const mmss = (m, s) => m ? String(m).padStart(2) + two(s) : '  ' + String(s).padStart(2);
    /** Running clock, channel 0. The console sends positions 7 down to 2. */
    function clockBlock(tenths) {
        const chars = mmss(Math.floor(tenths / 600), Math.floor(tenths % 600 / 10)) + tenths % 10 + ' ';
        return [control(0), ...data(chars, 2).reverse()];
    }
    const eventBlock = (event, heat) => [control(12), ...data(String(event).padStart(3) + '  ' + String(heat).padStart(3))];
    /** One lane module: lane digit, place, MMSSdd; or the lane digit alone in running-clock mode. */
    function laneBlock(lane, view) {
        if (view.universal) return [control(lane, false, true), ...data(lane + ' ')];
        const cs = view.time;
        const time = cs == null ? '      ' : mmss(Math.floor(cs / 6000), Math.floor(cs % 6000 / 100)) + two(cs % 100);
        return [control(lane), ...data(String(lane) + (view.place || ' ') + time)];
    }

    class TimerSource {
        constructor(meet = MEET) { this.heats = plan(meet); this.cycle = this.heats.at(-1).start + this.heats.at(-1).ticks; this.tick = 0; this.turn = 0; }
        /** What the console shows at a tick. The meet repeats when it ends. */
        state(tick) {
            const n = tick % this.cycle, heat = this.heats.find(h => n < h.start + h.ticks), k = n - heat.start;
            const phase = k < LINEUP ? 'lineup' : k < LINEUP + heat.race ? 'race' : 'results';
            const tenths = phase === 'lineup' ? 0 : Math.min(k - LINEUP, heat.race - 1);
            const lanes = heat.lanes.map(l => {
                const cs = tenths * 10;
                if (!l || phase === 'lineup') return {};
                if (cs >= l.final) return { time: l.final, place: l.place };
                // Splits are shown without a place. A real console may rank them.
                if (cs >= l.split && cs < l.split + SPLIT_HOLD) return { time: l.split };
                return { universal: true };
            });
            return { heat, phase, tenths, lanes };
        }
        /** Bytes for one tenth of a second: the clock, then as much of the rotating refresh as the line carries. */
        step() {
            const s = this.state(this.tick++), out = clockBlock(s.tenths);
            const refresh = [eventBlock(s.heat.event, s.heat.heat)];
            s.lanes.forEach((view, i) => {
                // Format position 0, nibble 13: the dot the decoder reads as a reset console.
                refresh.push(laneBlock(i + 1, view), [control(i + 1, true), s.phase === 'lineup' ? 13 : 0]);
            });
            for (let sent = 0; sent < refresh.length; sent++) {
                const block = refresh[this.turn % refresh.length];
                if (out.length + block.length > LINE_BUDGET) break;
                out.push(...block); this.turn++;
            }
            return out;
        }
        /** Everything sent up to `ms` since the last call. */
        read(ms) {
            const out = [];
            while (this.tick * TICK <= ms) out.push(...this.step());
            return Uint8Array.from(out);
        }
        /** Join the stream at `ms` without replaying what came before, like plugging in mid-meet. */
        seek(ms) { this.tick = Math.ceil(ms / TICK); }
    }

    // ---- Meet Manager: 502-byte start-list records, as src/protocol/genser.js reads them ----------
    class MeetManager {
        constructor(meet = MEET) {
            this.meet = meet; this.requests = 0; this.buffer = []; this.next = 0;
            // The scoreboard computer asks for heat 1, 2, 3... of an event until one goes unanswered.
            this.walk = meet.flatMap(e => Array.from({ length: e.heats.length + 1 }, (_, h) => [e.event, h + 1]));
        }
        /** The reply to one request, or null: Meet Manager answers a heat that does not exist with silence. */
        record(event, heat) {
            this.requests++;
            const e = this.meet.find(m => m.event === event), entries = e?.heats[heat - 1];
            if (!entries) return null;
            const s = Array(502).fill(' ');
            const put = (at, value) => { for (let i = 0; i < value.length; i++) s[at + i] = value[i]; };
            s[0] = '\r'; put(1, String(this.requests % 10)); put(2, '0120');
            put(8, e.title.slice(0, 28)); put(38, 'Timed Finals'); put(68, e.gender); put(70, e.title.slice(0, 28));
            entries.forEach((entry, i) => {
                if (!entry) return;
                const at = 116 + i * 38;
                put(at, String(i + 1)); put(at + 1, entry[0].slice(0, 20)); put(at + 21, entry[1].slice(0, 4));
            });
            put(496, String(event).padStart(3)); put(499, String(heat).padStart(3));
            return Uint8Array.from(s, c => c.charCodeAt(0) & 255);
        }
        /** The next request of the scoreboard computer's walk through the meet, answered. */
        walkNext() { const [event, heat] = this.walk[this.next++ % this.walk.length]; return this.record(event, heat); }
        /** Bytes written to the port. Returns a reply for each complete request: STX EEE HH T EOT. */
        write(bytes) {
            const out = [];
            this.buffer.push(...bytes);
            for (;;) {
                const at = this.buffer.indexOf(2);
                if (at < 0) { this.buffer = []; break; }
                if (this.buffer.length - at < 8) { this.buffer = this.buffer.slice(at); break; }
                const frame = this.buffer.slice(at, at + 8), body = String.fromCharCode(...frame.slice(1, 7));
                if (frame[7] !== 4 || !/^\d{6}$/.test(body)) { this.buffer = this.buffer.slice(at + 1); continue; }
                this.buffer = this.buffer.slice(at + 8);
                const reply = this.record(Number(body.slice(0, 3)), Number(body.slice(3, 5)));
                if (reply) out.push(reply);
            }
            return out;
        }
    }
    return { MEET, TICK, LINEUP, AFTER, RESULTS, LINE_BUDGET, TimerSource, MeetManager };
});
