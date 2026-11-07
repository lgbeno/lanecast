'use strict';
const assert = require('node:assert/strict');
const { Decoder, parseSCB } = require('../src/protocol/cts');
const { parseRecord, RosterStore } = require('../src/protocol/genser');
const { scoreboard, VERSION } = require('../src/protocol/packet');
const { test, control, block, record } = require('./helpers');

const sample = [...block(12, ' 73    1'), ...block(0, '    130 '), ...block(4, '41  2872'), ...block(5, '5       ', false, true), control(20)];
const snap = bytes => { const d = new Decoder(); d.feed(bytes); d.finish(); return d.snapshot(); };
const scb = '#73 MIXED 100 FREE RELAY\r\n' + Array.from({ length: 20 }, (_, i) => (i === 3 ? 'TEST RELAY A --TEST' : i === 10 ? 'SECOND HEAT --TEAM' : ' -- ')).join('\r\n') + '\r\n';

test('a packet carries the console display and the start list for that event, heat and lane', () => {
    const store = new RosterStore(); store.addEvent(parseSCB(scb));
    const p = scoreboard(snap(sample), store.view());
    assert.equal(p.v, VERSION); assert.equal(p.type, 'scoreboard');
    assert.equal(p.event, 73); assert.equal(p.heat, 1); assert.equal(p.title, 'MIXED 100 FREE RELAY'); assert.equal(p.clock, '0:13.0');
    assert.equal(p.lanes.length, 10);
    assert.deepEqual(p.lanes[3], { lane: 4, name: 'TEST RELAY A', team: 'TEST', time: '0:28.72', place: '1', followsClock: false });
    assert.deepEqual(p.lanes[4], { lane: 5, name: '', team: '', time: '', place: '', followsClock: true });
    assert.equal(JSON.parse(JSON.stringify(p)).lanes[3].name, 'TEST RELAY A', 'plain JSON');
});
test('no start list, wrong heat or unknown event leaves names empty rather than guessing', () => {
    const store = new RosterStore(); store.addEvent(parseSCB(scb));
    const s = snap(sample);
    s.heat = 2; assert.equal(scoreboard(s, store.view()).lanes[0].name, 'SECOND HEAT');
    s.heat = 3; assert.equal(scoreboard(s, store.view()).lanes[0].name, '');
    s.event = 74; const p = scoreboard(s, store.view()); assert.equal(p.title, ''); assert(p.lanes.every(l => !l.name));
    const empty = scoreboard(snap([control(20)]), new Map());
    assert.equal(empty.event, null); assert.equal(empty.heat, null); assert.equal(empty.state, 'unknown'); assert.equal(empty.clock, '');
});
test('Meet Manager names are shown First Last; the state is the decoder\'s', () => {
    const store = new RosterStore();
    store.add(parseRecord(record({ event: 73, heat: 1, title: 'Mixed 100 Free Relay', lanes: { 4: ['Sample, Alex', 'AAA'] } })));
    const d = new Decoder();
    d.feed(block(12, ' 73    1'), 0); d.feed(block(0, '    000 '), 0); d.feed(block(0, '    001 '), 100); d.feed([control(20)], 100);
    const p = scoreboard(d.snapshot(100), store.view());
    assert.equal(p.state, 'running'); assert.equal(p.lanes[3].name, 'Alex Sample'); assert.equal(p.lanes[3].team, 'AAA');
    assert.equal(scoreboard(d.snapshot(100), store.view({ firstLast: false })).lanes[3].name, 'Sample, Alex');
});
console.log(`${test.count()} packet test groups passed`);
