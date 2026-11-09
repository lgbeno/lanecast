'use strict';
const assert = require('node:assert/strict');
const Sim = require('../src/protocol/simulator');
const CTS = require('../src/protocol/cts');
const GENSER = require('../src/protocol/genser');
const { test } = require('./helpers');

test('the simulated console counts in tenths, names its event and heat, and fits the line', () => {
    const source = new Sim.TimerSource(), d = new CTS.Decoder(), chunks = [];
    for (let ms = 0; ms <= 20000; ms += 25) { const bytes = source.read(ms); if (bytes.length) { chunks.push({ at: ms, bytes }); d.feed(bytes, ms); } }
    const s = d.snapshot(20000);                                      // 20 s in: the first heat is racing
    assert.equal(s.event, 1); assert.equal(s.heat, 1); assert.equal(s.state, 'running'); assert.equal(s.orphans, 0);
    assert.equal(s.clock, '0:12.0');                                  // 8 s of lineup at 0:00.0, then the start
    const steps = CTS.clockSteps(chunks);
    assert.equal(steps.steady, steps.changes); assert(steps.changes >= 118);
    assert(chunks.reduce((n, c) => n + c.bytes.length, 0) <= 201 * Sim.LINE_BUDGET, 'never more than the line carries');
    source.seek(60000); assert.equal(source.tick, 600);               // joining mid-meet does not replay the past
});
test('the simulated Meet Manager walks the meet and answers requests', () => {
    const mm = new Sim.MeetManager(), p = new GENSER.StreamParser(), got = [];
    for (let i = 0; i < mm.walk.length; i++) { const reply = mm.walkNext(); if (reply) got.push(...p.feed(reply)); }
    assert.deepEqual(got.map(r => [r.event, r.heat]), [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1]]);
    assert.equal(got[0].lanes[1].name, 'Marlowe, Tessa'); assert.equal(got[0].lanes[0].name, ''); assert.equal(got[4].title, 'Mixed 10&U 100 Free Relay');
    const replies = mm.write(GENSER.request(2, 1));
    assert.equal(replies.length, 1); assert.equal(GENSER.parseRecord(replies[0]).title, 'Boys 11-12 50 Back');
    assert.equal(mm.write(GENSER.request(2, 9)).length, 0);           // a heat that does not exist gets silence
    const store = new GENSER.RosterStore(); for (const r of got) store.add(r);
    assert.equal(store.heats, 5); assert.equal(store.events.size, 3);
});
test('the console can be driven by hand: pick a heat, start the race, stop it', () => {
    const source = new Sim.TimerSource(), d = new CTS.Decoder();
    const run = (from, to) => { for (let ms = from; ms <= to; ms += 25) { const b = source.read(ms); if (b.length) d.feed(b, ms); } return d.snapshot(to); };
    source.control(12, 3);
    let s = run(0, 3000);
    assert.equal(s.event, 12); assert.equal(s.heat, 3); assert.equal(s.clock, '0:00.0'); assert.equal(s.state, 'reset');
    source.race(true);
    s = run(3025, 8000);
    assert.equal(s.state, 'running'); assert.equal(s.clock, '0:04.9');     // five seconds in; the newest block commits with the next control byte
    assert(s.lanes.some(l => l.followsClock), 'lanes follow the clock during the race');
    s = run(8025, 40000);                                                  // a made-up event: ~15 s swims, then the clock holds
    assert(s.lanes.filter(l => l.time && l.place).length >= 6, 'six made-up swimmers finish with places');
    assert.equal(s.state, 'unknown', 'the clock has stopped');
    source.race(false);
    s = run(40025, 42000);
    assert.equal(s.clock, '0:00.0'); assert.equal(s.event, 12); assert(s.lanes.every(l => !l.time), 'stopping lines the heat up again');
    source.control(1, 2); s = run(42025, 43000); assert.equal(s.heat, 2);
    source.automatic(); s = run(43025, 44000); assert.equal(s.event, 1);  // back to the scripted meet, wherever it is
});
test('a made-up meet leans short, has names in its lanes, and times itself by the title', () => {
    const meet = Sim.generateMeet({ events: 60, seed: 7 });
    assert.equal(meet.length, 60); assert.equal(meet[0].event, 1); assert.equal(meet[59].event, 60);
    const distances = meet.map(e => Number(/\b(\d+)\b/.exec(e.title.replace(/\d+-\d+|\d+ & \w+/, ''))[1]));
    assert(distances.filter(d => d <= 100).length >= 45, 'most events are 100 or shorter');
    assert(!distances.some(d => d > 200), 'nothing longer than a 200');
    assert(meet.filter(e => /Relay/.test(e.title)).length >= 8, 'relays turn up');
    for (const e of meet) for (const heat of e.heats) {
        assert.equal(heat.length, 10);
        const swimmers = heat.filter(Boolean);
        assert(swimmers.length >= 5 && swimmers.length <= 8);
        for (const [name, team] of swimmers) { assert(/\S/.test(name)); assert(Sim.TEAMS ? true : /^[A-Z]{4}$/.test(team)); }
    }
    // Simulated races are short: 15 s for a 25 or 50, 20 s for a 100, 30 s from a 200 up; the age range never reads as a distance.
    assert.equal(Sim.secondsFor('Girls 9-10 50 Free'), 15); assert.equal(Sim.secondsFor('Boys 13-14 100 Breast'), 20);
    assert.equal(Sim.secondsFor('Mixed 11-12 200 Free Relay'), 30); assert.equal(Sim.secondsFor('Girls 8 & Under 25 Fly'), 15);
    assert.equal(Sim.secondsFor(''), 15);
    // Longer races get four seconds a 50, so ten of them can still be told apart; never more than a minute.
    assert.equal(Sim.secondsFor('Boys 15 & Over 500 Free'), 40); assert.equal(Sim.secondsFor('Girls 400 IM'), 32); assert.equal(Sim.secondsFor('Boys 1650 Free'), 60);
    assert.deepEqual(Sim.generateMeet({ events: 3, seed: 1 }), Sim.generateMeet({ events: 3, seed: 1 }), 'the same seed gives the same meet');
});
test('a race shows a split at every 50 but the last, which is the finish', () => {
    assert.deepEqual(['Girls 8 & Under 25 Fly', 'Girls 9-10 50 Free', 'Boys 13-14 100 Breast', 'Mixed 11-12 200 Free Relay', 'Boys 15 & Over 500 Free', ''].map(t => [Sim.distanceOf(t), Sim.fifties(Sim.distanceOf(t))]),
        [[25, 1], [50, 1], [100, 2], [200, 4], [500, 10], [50, 1]], 'the distance is read from the title, never from the age range');
    // Watch the console's own bytes through the decoder and the event tracker, as the app does, for one heat of each distance.
    const Events = require('../src/protocol/events');
    const entries = [null, null, ['Ana Ruiz', 'DOLF'], ['Bea Stone', 'RAYS'], ['Cy Vale', 'WAVE'], null, null, null, null, null];
    const watch = title => {
        const source = new Sim.TimerSource([{ event: 1, title, gender: 'F', heats: [entries] }]), decoder = new CTS.Decoder(), tracker = new Events.Tracker();
        const splits = new Map(), finishes = new Map(), shown = new Map(); let ms = 0;
        source.control(1, 1); for (; ms < 1500; ms += 25) { const b = source.read(ms); if (b.length) decoder.feed(b, ms); tracker.update(decoder.snapshot(ms), null, ms); }
        source.race(true);
        for (const until = ms + 75000; ms < until; ms += 25) {
            const bytes = source.read(ms); if (bytes.length) decoder.feed(bytes, ms);
            const snapshot = decoder.snapshot(ms);
            for (const event of tracker.update(snapshot, null, ms)) {
                if (event.name === 'lane.split') splits.set(event.lane, [...(splits.get(event.lane) || []), event.time]);
                if (event.name === 'lane.finish') finishes.set(event.lane, event.time);
            }
            for (const lane of snapshot.lanes) if (lane.time && !lane.place) shown.set(lane.lane, (shown.get(lane.lane) || 0) + 1);
        }
        return { splits, finishes, shown };
    };
    const seconds = text => { const [m, s] = text.split(':'); return Number(m) * 60 + Number(s); };
    for (const [title, expected] of [['Girls 8 & Under 25 Fly', 0], ['Girls 9-10 50 Free', 0], ['Boys 13-14 100 Breast', 1], ['Girls 11-12 200 Free', 3], ['Mixed 11-12 200 Free Relay', 3], ['Boys 15 & Over 500 Free', 9]]) {
        const { splits, finishes } = watch(title);
        assert.deepEqual([...finishes.keys()].sort(), [3, 4, 5], `${title}: all three swimmers finish`);
        for (const lane of [3, 4, 5]) {
            const times = (splits.get(lane) || []).map(seconds), final = seconds(finishes.get(lane));
            assert.equal(times.length, expected, `${title}: lane ${lane} shows ${expected} split(s) before its finish, got ${times.length}`);
            assert.deepEqual(times, [...times].sort((a, b) => a - b), `${title}: splits come in order`);
            if (times.length) assert(times.at(-1) < final && times[0] > 0, `${title}: every split is before the finish`);
            // Each 50 takes about as long as the others: no split is squeezed against its neighbour.
            const legs = [...times, final].map((t, i, all) => t - (i ? all[i - 1] : 0));
            assert(Math.max(...legs) < Math.min(...legs) * 1.35, `${title}: lane ${lane} swims its 50s at an even pace: ${legs.map(l => l.toFixed(1)).join(' ')}`);
        }
    }
});
test('the console runs whatever meet it is given, from the heat asked for, round and round', () => {
    const source = new Sim.TimerSource(Sim.generateMeet({ events: 4, seed: 3, from: 10 })), d = new CTS.Decoder();
    const run = (from, to) => { for (let ms = from; ms <= to; ms += 25) { const b = source.read(ms); if (b.length) d.feed(b, ms); } return d.snapshot(to); };
    assert.deepEqual(source.status(), { event: 10, heat: 1, running: true, racing: false });
    source.run(true, 12, 1);
    let s = run(0, 2000);
    assert.equal(s.event, 12); assert.equal(s.heat, 1); assert.equal(s.clock, '0:00.0');
    s = run(2025, 20000); assert.equal(s.event, 12); assert.equal(s.state, 'running');     // past the 8 s lineup, racing
    const seen = new Set(); for (let ms = 20025; ms <= 400000; ms += 25) { const b = source.read(ms); if (b.length) { d.feed(b, ms); seen.add(d.snapshot(ms).event); } }
    assert.deepEqual([...seen].sort((a, b) => a - b), [10, 11, 12, 13], 'the whole meet comes round, wrapping to the first event');
    source.run(false); const c = source.status(); assert.equal(c.running, false); assert.equal(c.racing, false);
    source.setMeet(Sim.generateMeet({ events: 2, seed: 9, from: 40 }));          // start lists arrive: the schedule changes under it
    source.run(true, 41, 2); assert.equal(source.status().event, 41);
    source.run(true, 99, 1); assert.equal(source.status().event, 40, 'an event that is not in the meet wraps to the start');
});
console.log(`${test.count()} simulator test groups passed`);
