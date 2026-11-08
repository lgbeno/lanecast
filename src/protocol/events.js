/* The event stream a theme animates to. The console only ever sends what its display shows;
 * this watches successive snapshots and says what happened: a heat lined up, the race started,
 * a lane split, a lane finished, the heat finished, the event finished. Each fires once.
 *
 *   const tracker = new Events.Tracker();
 *   for (const e of tracker.update(snapshot, rosters.view())) ...   // [{ name, ...details }]
 *   tracker.phase                                                   // 'idle' | 'lineup' | 'racing' | 'finished'
 *
 * Documented for theme authors in docs/themes.md.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Events = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const SETTLE_MS = 1500;      // a stopped clock this long after the first finish ends a heat with no start list

    class Tracker {
        constructor() { this.reset(); }
        reset() {
            this.key = null; this.event = null; this.heat = null; this.title = ''; this.heats = 0;
            this.phase = 'idle'; this.started = false; this.finished = new Map(); this.splits = new Map();
            this.lastFinishAt = null; this.stoppedSince = null; this.lastClock = '';
        }
        /** Feed the newest snapshot (CTS.Decoder#snapshot) and the start lists (GENSER.RosterStore#view()).
         *  Returns the events that happened since the last call, in order. `at` is ms, any origin. */
        update(snapshot, rosters, at = Date.now()) {
            const out = [];
            if (!snapshot || !snapshot.event) return out;
            const roster = rosters && rosters.get ? rosters.get(snapshot.event) : null;
            const names = roster?.heats[snapshot.heat - 1] || null;
            const title = roster?.title || '';
            const key = `${snapshot.event}/${snapshot.heat}`;
            const athlete = lane => names?.[lane - 1] || null;
            const describe = l => ({ lane: l.lane, swimmer: athlete(l.lane)?.name || '', team: athlete(l.lane)?.team || '' });

            if (key !== this.key) {
                const eventChanged = snapshot.event !== this.event;
                this.key = key; this.event = snapshot.event; this.heat = snapshot.heat; this.title = title; this.heats = roster?.heats.length || 0;
                this.started = false; this.finished = new Map(); this.splits = new Map(); this.lastFinishAt = null; this.stoppedSince = null;
                this.phase = 'lineup';
                if (eventChanged) out.push({ name: 'event.change', event: snapshot.event, title, heats: this.heats });
                out.push({ name: 'heat.lineup', event: snapshot.event, heat: snapshot.heat, title, lanes: snapshot.lanes.filter(l => athlete(l.lane)?.name).map(describe) });
            }
            // A reset clock after a start is a false start or a recall: the heat lines up again.
            if (this.started && snapshot.state === 'reset') {
                this.started = false; this.finished = new Map(); this.splits = new Map(); this.lastFinishAt = null; this.stoppedSince = null; this.phase = 'lineup';
                out.push({ name: 'race.reset', event: snapshot.event, heat: snapshot.heat });
            }
            if (!this.started && snapshot.state === 'running') {
                this.started = true; this.phase = 'racing';
                out.push({ name: 'race.start', event: snapshot.event, heat: snapshot.heat, title });
            }
            if (this.started && this.phase !== 'finished') {
                for (const l of snapshot.lanes) {
                    if (!l.time) continue;
                    if (l.place) {
                        if (!this.finished.has(l.lane)) {
                            this.finished.set(l.lane, { ...describe(l), place: Number(l.place) || l.place, time: l.time });
                            this.lastFinishAt = at;
                            out.push({ name: 'lane.finish', event: snapshot.event, heat: snapshot.heat, ...this.finished.get(l.lane) });
                        }
                    } else if (this.splits.get(l.lane) !== l.time) {
                        this.splits.set(l.lane, l.time);
                        out.push({ name: 'lane.split', event: snapshot.event, heat: snapshot.heat, ...describe(l), time: l.time });
                    }
                }
                // Everyone with a name has a place; or, with no start list, the clock has stopped a while after the first finish.
                const occupied = names ? snapshot.lanes.filter(l => athlete(l.lane)?.name).map(l => l.lane) : null;
                let done = false;
                if (occupied && occupied.length) done = occupied.every(lane => this.finished.has(lane));
                else if (this.finished.size) {
                    if (snapshot.state !== 'running') { if (this.stoppedSince === null) this.stoppedSince = at; done = at - this.stoppedSince >= SETTLE_MS; }
                    else this.stoppedSince = null;
                }
                if (done) {
                    this.phase = 'finished';
                    const results = [...this.finished.values()].sort((a, b) => Number(a.place) - Number(b.place));
                    out.push({ name: 'heat.finish', event: snapshot.event, heat: snapshot.heat, title, results });
                    if (this.heats && snapshot.heat >= this.heats) out.push({ name: 'event.finish', event: snapshot.event, title, heats: this.heats });
                }
            }
            this.lastClock = snapshot.clock;
            return out;
        }
    }
    const NAMES = ['event.change', 'heat.lineup', 'race.start', 'race.reset', 'lane.split', 'lane.finish', 'heat.finish', 'event.finish'];
    return { Tracker, NAMES, SETTLE_MS };
});
