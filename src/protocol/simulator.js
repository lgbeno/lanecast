/* Simulated devices for running the app without hardware.
 *
 * A timing console whose scoreboard output can be driven by hand (line up a heat, start the
 * race) or left to run a whole meet (lineup, race with splits, results, next heat, round and
 * round); a Meet Manager that answers start-list requests; and a maker of random meets with
 * made-up swimmers. The bytes are built from this project's own reading of the protocols, so
 * they exercise the app end to end. They are not evidence about the real links. Every name is
 * invented.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Sim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    // A meet: [{ event, title, gender, seconds, heats: [[[name, team] | null, ...ten lanes], ...] }]
    const MEET = [
        { event: 1, title: 'Girls 11-12 50 Free', gender: 'G', seconds: 16, heats: [
            [null, ['Marlowe, Tessa', 'DOLF'], ['Okafor, Nia', 'RAYS'], ['Lindqvist, Freya', 'DOLF'], ['Castellano, Mia', 'WAVE'], ['Brightwater, June', 'RAYS'], ['Hale, Rowan', 'WAVE'], null],
            [['Pemberton, Ivy', 'OTTR'], ['Nakagawa, Emi', 'WAVE'], ['Featherstonehaugh, Josephine', 'DOLF'], ['Abernathy, Cleo', 'RAYS'], ['Quill, Harper', 'OTTR'], ['Vasquez, Lucia', 'DOLF'], ['Thorne, Maeve', 'RAYS'], ['Underhill, Posy', 'WAVE']] ] },
        { event: 2, title: 'Boys 11-12 50 Back', gender: 'B', seconds: 18, heats: [
            [null, null, ['Whitlock, Ezra', 'RAYS'], ['Banerjee, Kiran', 'OTTR'], ['Sorensen, Leif', 'WAVE'], ['Dunmore, Felix', 'DOLF'], null, null],
            [['Ashworth, Theo', 'DOLF'], ['Kowalczyk, Jan', 'RAYS'], ['Montague, Silas', 'WAVE'], ['Iwu, Chidi', 'OTTR'], ['Fairbanks, Otis', 'RAYS'], ['Roswell, Jude', 'DOLF'], ['Elkins, Wade', 'OTTR'], null] ] },
        { event: 3, title: 'Mixed 10&U 100 Free Relay', gender: 'X', seconds: 24, heats: [
            [null, ['Relay-B', 'WAVE'], ['Relay-A', 'RAYS'], ['Relay-A', 'DOLF'], ['Relay-A', 'WAVE'], ['Relay-A', 'OTTR'], ['Relay-B', 'DOLF'], null] ] }
    ];
    const LANES = 10;
    const TICK = 100;            // ms; the console sends the clock every tenth
    const LINEUP = 80;           // ticks at 0:00.0 before the start
    const AFTER = 30;            // ticks the clock keeps running after the last touch
    const RESULTS = 80;          // ticks the stopped clock and results stay up
    const SPLIT_HOLD = 500;      // hundredths a split stays on a lane before the clock returns
    const LINE_BUDGET = 87;      // bytes per tick: 9600 baud, 11 bits per 8E1 character

    function rng(seed) {         // mulberry32, so a meet is the same every run
        return () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    /** A winning time for a simulated race, from the distance in the event title: 15 s for a 25 or 50, 20 s for a
     *  100, 30 s for anything 200 and up. Nobody watching a simulation wants to sit through real race times. */
    function secondsFor(title) {
        // The distance is a number that is not part of an age range such as 13-14 or 9-10.
        const numbers = Array.from(String(title || '').matchAll(/(?<![\d-])(\d{2,4})(?![\d-])/g), m => Number(m[1]));
        const distance = numbers.find(n => n >= 25 && n <= 1650) || 50;
        return Math.min(30, Math.max(15, Math.round(10 + distance / 10)));
    }
    /** Each swimmer's split, final time and place for one heat: the meet's entries, or six made-up swimmers. */
    function planLanes(meet, event, heat) {
        const e = meet.find(m => m.event === event), entries = e?.heats[heat - 1] || [null, 1, 1, 1, 1, 1, 1, null];
        const seconds = e?.seconds || secondsFor(e?.title), random = rng(event * 100 + heat);
        const lanes = Array.from({ length: LANES }, (_, i) => {
            if (!entries[i]) return null;
            const final = Math.round(seconds * 100 * (1 + random() * 0.18));
            return { final, split: Math.round(final * (0.46 + random() * 0.03)), place: 0 };
        });
        const order = lanes.filter(Boolean).sort((a, b) => a.final - b.final);
        order.forEach((l, i) => { if (i && l.final <= order[i - 1].final) l.final = order[i - 1].final + 1; l.place = i + 1; });
        return { lanes, race: Math.ceil((order.at(-1)?.final || seconds * 100) / 10) + AFTER };
    }
    /** The meet on a timeline of ticks: every heat of every event in order, each lined up, raced and shown. */
    function plan(meet) {
        const heats = []; let start = 0;
        for (const e of [...meet].sort((a, b) => a.event - b.event)) e.heats.forEach((entries, h) => {
            const { lanes, race } = planLanes(meet, e.event, h + 1);
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
    /** One lane module: lane digit, place, MMSSdd; or the lane digit alone in running-clock mode. Lane 10 shows 0. */
    function laneBlock(lane, view) {
        const digit = String(lane % 10);
        if (view.universal) return [control(lane, false, true), ...data(digit + ' ')];
        const cs = view.time;
        const time = cs == null ? '      ' : mmss(Math.floor(cs / 6000), Math.floor(cs % 6000 / 100)) + two(cs % 100);
        return [control(lane), ...data(digit + (view.place || ' ') + time)];
    }

    class TimerSource {
        constructor(meet = MEET) { this.tick = 0; this.turn = 0; this.mode = { kind: 'run', from: 0, start: 0 }; this.setMeet(meet); }
        /** The meet the console works from: whatever start lists are loaded, or the built-in one. Keeps its place. */
        setMeet(meet) {
            const before = this.heats ? this.current() : null;
            this.meet = meet && meet.length ? meet : MEET;
            this.heats = plan(this.meet); this.cycle = this.heats.at(-1).start + this.heats.at(-1).ticks;
            if (this.mode.kind === 'run' && before) { const i = this.indexOf(before.event, before.heat); this.mode = { kind: 'run', from: i < 0 ? 0 : i, start: this.tick }; }
            if (this.mode.kind === 'manual') Object.assign(this.mode, planLanes(this.meet, this.mode.event, this.mode.heat));
        }
        indexOf(event, heat) { return this.heats.findIndex(h => h.event === event && h.heat === heat); }
        /** Line up a heat by hand at 0:00.0, until race() starts it. */
        control(event, heat) {
            event = Math.max(1, Math.min(999, Math.floor(event) || 1)); heat = Math.max(1, Math.min(99, Math.floor(heat) || 1));
            this.mode = { kind: 'manual', event, heat, racing: false, startTick: 0, ...planLanes(this.meet, event, heat) };
        }
        /** Start or stop the race on the heat lined up. Stopping returns the clock to 0:00.0. */
        race(on) { if (this.mode.kind !== 'manual') { const c = this.current(); this.control(c.event, c.heat); } this.mode.racing = !!on; this.mode.startTick = this.tick; }
        /** Run the meet from a heat (the one lined up, or the given one) and keep going, round and round; or stop where it is. */
        run(on, event, heat) {
            if (!on) { if (this.mode.kind === 'run') { const c = this.current(); this.control(c.event, c.heat); } return; }
            if (event === undefined) ({ event, heat } = this.current());
            let from = this.indexOf(event, heat);
            if (from < 0) from = Math.max(0, this.heats.findIndex(h => h.event > event || (h.event === event && h.heat > heat)));
            this.mode = { kind: 'run', from, start: this.tick };
        }
        /** Hand the console back to the scripted meet from its first heat. */
        automatic() { this.mode = { kind: 'run', from: 0, start: this.tick }; }
        current() { const s = this.state(this.tick); return { event: s.heat.event, heat: s.heat.heat }; }
        status() { const c = this.current(); return { event: c.event, heat: c.heat, running: this.mode.kind === 'run', racing: this.mode.kind === 'manual' && this.mode.racing }; }
        /** What the console shows at a tick. */
        state(tick) {
            let heat, phase, tenths;
            const m = this.mode;
            if (m.kind === 'manual') {
                heat = m;
                tenths = m.racing ? Math.min(tick - m.startTick, m.race - 1) : 0;
                phase = !m.racing ? 'lineup' : tick - m.startTick < m.race ? 'race' : 'results';
            } else {
                const n = (((tick - m.start + this.heats[Math.min(m.from, this.heats.length - 1)].start) % this.cycle) + this.cycle) % this.cycle;
                heat = this.heats.find(h => n < h.start + h.ticks); const k = n - heat.start;
                phase = k < LINEUP ? 'lineup' : k < LINEUP + heat.race ? 'race' : 'results';
                tenths = phase === 'lineup' ? 0 : Math.min(k - LINEUP, heat.race - 1);
            }
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
                if (!entry || i >= LANES) return;
                const at = 116 + i * 38;
                put(at, String((i + 1) % 10)); put(at + 1, entry[0].slice(0, 20)); put(at + 21, entry[1].slice(0, 4));
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

    // ---- a made-up meet -----------------------------------------------------------------------
    const FIRST = ['Ada', 'Bea', 'Cleo', 'Dara', 'Elin', 'Fern', 'Greta', 'Hazel', 'Iris', 'June', 'Kit', 'Lena', 'Mira', 'Nell', 'Opal', 'Pia', 'Quinn', 'Rosa', 'Sade', 'Tess', 'Uma', 'Vera', 'Wren', 'Yara', 'Zoe',
        'Ari', 'Ben', 'Cal', 'Dev', 'Eli', 'Finn', 'Gus', 'Hugo', 'Ivo', 'Jude', 'Kai', 'Leo', 'Max', 'Ned', 'Otis', 'Pax', 'Rafe', 'Sol', 'Theo', 'Uri', 'Vic', 'Wes', 'Xan', 'Zed'];
    const LAST = ['Abernathy', 'Brightwater', 'Castellano', 'Dunmore', 'Ellery', 'Fairbanks', 'Greenwood', 'Hollis', 'Ingram', 'Jaworski', 'Kowalczyk', 'Lindqvist', 'Marlowe', 'Nakagawa', 'Okafor',
        'Pemberton', 'Quill', 'Roswell', 'Sorensen', 'Thorne', 'Underhill', 'Vasquez', 'Whitlock', 'Yamada', 'Zielinski', 'Ashworth', 'Banerjee', 'Cho', 'Delgado', 'Eriksen', 'Farrow', 'Iwu', 'Montague', 'Oyelaran', 'Petrov'];
    const TEAMS = ['DOLF', 'RAYS', 'WAVE', 'OTTR', 'TIDE', 'FINS'];
    const AGES = ['8 & Under', '9-10', '11-12', '13-14', '15 & Over'];
    const STROKES = ['Free', 'Back', 'Breast', 'Fly'];
    /** A random meet of `events` events from `from`, mostly short races: nobody wants to sit through a simulated 500. */
    function generateMeet({ events = 12, from = 1, seed = Date.now() % 1e9 } = {}) {
        const random = rng(seed), pick = list => list[Math.floor(random() * list.length)];
        const distance = () => { const r = random(); return r < 0.2 ? 25 : r < 0.6 ? 50 : r < 0.9 ? 100 : 200; };
        const meet = [];
        for (let i = 0; i < events; i++) {
            const relay = i % 6 === 5, age = pick(AGES);
            let d = distance(), gender = relay ? 'Mixed' : pick(['Girls', 'Boys']), stroke;
            if (relay) { d = d <= 50 ? 100 : 200; stroke = pick(['Free', 'Medley']); }
            else stroke = d >= 100 && random() < 0.2 ? 'IM' : pick(STROKES);
            const title = `${gender} ${age} ${d} ${stroke}${relay ? ' Relay' : ''}`;
            const heats = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
                const lanes = Array(LANES).fill(null), count = 5 + Math.floor(random() * 4);
                const open = [1, 2, 3, 4, 5, 6, 7, 8].sort(() => random() - 0.5).slice(0, count);
                for (const lane of open) { const team = pick(TEAMS); lanes[lane - 1] = relay ? [`${team}-${pick(['A', 'B'])}`, team] : [`${pick(LAST)}, ${pick(FIRST)}`, team]; }
                return lanes;
            });
            meet.push({ event: from + i, title, gender: gender[0] === 'M' ? 'X' : gender[0], seconds: secondsFor(title), heats });
        }
        return meet;
    }

    return { MEET, LANES, TICK, LINEUP, AFTER, RESULTS, LINE_BUDGET, TimerSource, MeetManager, generateMeet, secondsFor };
});
