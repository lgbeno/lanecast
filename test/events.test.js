'use strict';
const assert = require('node:assert/strict');
const { Tracker } = require('../src/protocol/events');
const { RosterStore } = require('../src/protocol/genser');
const { test, record } = require('./helpers');
const { parseRecord } = require('../src/protocol/genser');

// Snapshots as the decoder would give them, built by hand.
const lane = (n, extra = {}) => ({ lane: n, displayedLane: String(n), place: '', time: '', followsClock: false, ...extra });
const snap = (event, heat, clock, state, lanes = {}) => ({ event, heat, clock, state, stale: false, lanes: Array.from({ length: 10 }, (_, i) => lane(i + 1, lanes[i + 1] || {})) });
const names = () => { const s = new RosterStore(); s.add(parseRecord(record({ event: 5, heat: 1, title: 'Girls 9-10 50 Free', lanes: { 3: ['Sample, Alex', 'AAA'], 4: ['Example, Sam', 'BBB'] } }))); s.add(parseRecord(record({ event: 5, heat: 2, title: 'Girls 9-10 50 Free', lanes: { 4: ['Late, Kit', 'CCC'] } }))); return s.view(); };
const fire = (tracker, snapshots, rosters) => snapshots.flatMap(([s, at]) => tracker.update(s, rosters, at).map(e => e.name + (e.lane ? ':' + e.lane : '')));

test('a heat lines up, starts, splits, finishes lane by lane, then the heat and the event finish', () => {
    const t = new Tracker(), r = names();
    assert.deepEqual(fire(t, [[snap(5, 1, '0:00.0', 'reset'), 0]], r), ['event.change', 'heat.lineup']);
    assert.equal(t.phase, 'lineup');
    assert.deepEqual(fire(t, [[snap(5, 1, '0:00.0', 'reset'), 100], [snap(5, 1, '0:00.1', 'running'), 200]], r), ['race.start']);
    assert.equal(t.phase, 'racing');
    assert.deepEqual(fire(t, [[snap(5, 1, '0:14.0', 'running', { 3: { time: '0:13.90' } }), 14000]], r), ['lane.split:3']);
    assert.deepEqual(fire(t, [[snap(5, 1, '0:14.5', 'running', { 3: { time: '0:13.90' } }), 14500]], r), [], 'the same split once');
    assert.deepEqual(fire(t, [[snap(5, 1, '0:29.0', 'running', { 3: { time: '0:28.72', place: '1' } }), 29000]], r), ['lane.finish:3']);
    assert.equal(t.phase, 'racing', 'one of two still swimming');
    const last = t.update(snap(5, 1, '0:31.0', 'running', { 3: { time: '0:28.72', place: '1' }, 4: { time: '0:30.10', place: '2' } }), r, 31000);
    assert.deepEqual(last.map(e => e.name), ['lane.finish', 'heat.finish']);
    assert.deepEqual(last[1].results.map(x => [x.place, x.swimmer, x.time]), [[1, 'Alex Sample', '0:28.72'], [2, 'Sam Example', '0:30.10']]);
    assert.equal(t.phase, 'finished');
    assert.deepEqual(fire(t, [[snap(5, 1, '0:31.0', 'running', { 3: { time: '0:28.72', place: '1' }, 4: { time: '0:30.10', place: '2' } }), 32000]], r), [], 'nothing fires twice');
    // Heat 2 is the last heat of the event.
    assert.deepEqual(fire(t, [[snap(5, 2, '0:00.0', 'reset'), 40000], [snap(5, 2, '0:00.1', 'running'), 40100]], r), ['heat.lineup', 'race.start']);
    const end = t.update(snap(5, 2, '0:20.0', 'running', { 4: { time: '0:19.50', place: '1' } }), r, 60000);
    assert.deepEqual(end.map(e => e.name), ['lane.finish', 'heat.finish', 'event.finish']);
    assert.equal(end[2].heats, 2);
});
test('without a start list the heat finishes when the clock has stopped a while after the first finish', () => {
    const t = new Tracker(), none = new Map();
    fire(t, [[snap(9, 1, '0:00.0', 'reset'), 0], [snap(9, 1, '0:00.1', 'running'), 100]], none);
    assert.deepEqual(fire(t, [[snap(9, 1, '0:25.0', 'running', { 2: { time: '0:24.5', place: '1' } }), 25000]], none), ['lane.finish:2']);
    assert.deepEqual(fire(t, [[snap(9, 1, '0:27.0', 'running', { 2: { time: '0:24.5', place: '1' } }), 27000]], none), [], 'still running');
    assert.deepEqual(fire(t, [[snap(9, 1, '0:27.0', 'unknown', { 2: { time: '0:24.5', place: '1' } }), 28000]], none), [], 'stopped, not yet settled');
    assert.deepEqual(fire(t, [[snap(9, 1, '0:27.0', 'unknown', { 2: { time: '0:24.5', place: '1' } }), 29600]], none), ['heat.finish']);
    assert.equal(t.phase, 'finished');
});
test('a reset after the start lines the heat up again; a new event changes event', () => {
    const t = new Tracker(), r = names();
    fire(t, [[snap(5, 1, '0:00.0', 'reset'), 0], [snap(5, 1, '0:00.1', 'running'), 100], [snap(5, 1, '0:05.0', 'running', { 3: { time: '0:04.9' } }), 5000]], r);
    assert.deepEqual(fire(t, [[snap(5, 1, '0:00.0', 'reset'), 6000]], r), ['race.reset']);
    assert.equal(t.phase, 'lineup');
    assert.deepEqual(fire(t, [[snap(5, 1, '0:00.1', 'running'), 7000], [snap(5, 1, '0:05.0', 'running', { 3: { time: '0:04.9' } }), 12000]], r), ['race.start', 'lane.split:3'], 'splits fire again after a restart');
    assert.deepEqual(fire(t, [[snap(6, 1, '0:00.0', 'reset'), 20000]], r), ['event.change', 'heat.lineup']);
    assert.deepEqual(fire(t, [[snap(6, 1, '0:00.0', 'reset'), 20100]], r), []);
    assert.deepEqual(fire(t, [[{ event: null, heat: null, clock: '', state: 'unknown', lanes: [] }, 20200]], r), [], 'no event, nothing to say');
});
console.log(`${test.count()} event test groups passed`);
