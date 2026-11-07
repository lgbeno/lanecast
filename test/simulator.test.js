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
console.log(`${test.count()} simulator test groups passed`);
