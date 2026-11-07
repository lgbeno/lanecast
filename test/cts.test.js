'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Decoder, Replay, Pacer, parseSCB, formatSCB, parseCapture, clockSteps } = require('../src/protocol/cts');
const { test, control, block } = require('./helpers');
const sample = [0x4d, 0x5d, ...block(12, ' 73    1'), ...block(0, '    130 '), ...block(4, '41  2872'), ...block(5, '5       ', false, true), control(20)];
function decode(bytes) { const d = new Decoder(); d.feed(bytes); d.finish(); return d; }
test('legacy channels, complemented digits, clock, lane time and place', () => {
    const s = decode(sample).snapshot();
    assert.equal(s.event, 73); assert.equal(s.heat, 1); assert.equal(s.clock, '0:13.0');
    assert.equal(s.lanes[3].place, '1'); assert.equal(s.lanes[3].time, '0:28.72');
    assert.equal(s.lanes[4].followsClock, true); assert.equal(s.lanes[4].time, ''); assert.equal(s.orphans, 2);
});
test('all chunk boundaries preserve parser state; no partial block commits', () => {
    for (let split = 0; split <= sample.length; split++) {
        const d = new Decoder(); d.feed(sample.slice(0, split)); d.feed(sample.slice(split)); d.finish();
        assert.deepEqual(d.snapshot(), decode(sample).snapshot());
    }
    const d = new Decoder(); for (const b of sample) d.feed([b]); d.finish(); assert.deepEqual(d.snapshot(), decode(sample).snapshot());
    const partial = new Decoder(); partial.feed(block(12, ' 73    1'));
    assert.equal(partial.snapshot().event, null); partial.feed([control(0)]); assert.equal(partial.snapshot().event, 73);
});
test('format data never overwrites digits; universal lane clears old fixed time', () => {
    const d = decode(sample); d.feed(block(4, '22222222', true)); d.finish();
    assert.equal(d.snapshot().lanes[3].time, '0:28.72');
    d.feed([control(4, false, true), 0x0b, 0x10]); d.finish(); assert.equal(d.snapshot().lanes[3].time, '');
});
test('new event/heat hides old lane results until fresh readout', () => {
    const d = decode(sample); d.feed(block(12, ' 75    1')); d.finish();
    assert.equal(d.snapshot().lanes[3].time, ''); assert.equal(d.snapshot().lanes[3].place, '');
});
test('clock advancement, exact seconds and stale/zero fail closed', () => {
    const d = new Decoder();
    d.feed(block(0, '    000 '), 0); d.finish(0); assert.equal(d.snapshot().state, 'unknown');
    d.feed(block(0, '    001 '), 100); d.finish(100); assert.equal(d.snapshot(100).state, 'running');
    d.feed(block(0, '    100 '), 1000); d.finish(1000); assert.equal(d.snapshot(1000).clock, '0:10.0');
    assert.equal(d.snapshot(3000).state, 'unknown');
    d.feed(block(0, '     00 '), 3100); d.finish(3100); assert.equal(d.snapshot(3100).state, 'unknown');
    d.feed([control(1, true), 0x0d], 3150); d.finish(3150); assert.equal(d.snapshot(3150).state, 'reset');
    d.feed(block(0, '     01 '), 3200); d.finish(3200); assert.equal(d.snapshot(3200).state, 'running');
});
const scb = '#73 MIXED 100 FREE RELAY\r\n' + Array.from({ length: 20 }, (_, i) => (i === 3 ? 'TEST RELAY A --TEST' : i === 10 ? 'SECOND HEAT --TEAM' : ' -- ')).join('\r\n') + '\r\n';
test('SCB blank lanes and multiple heats preserved, malformed slots rejected', () => {
    const r = parseSCB(scb); assert.equal(r.event, 73); assert.equal(r.heats.length, 2);
    assert.equal(r.heats[0][0].name, ''); assert.equal(r.heats[0][3].name, 'TEST RELAY A'); assert.equal(r.heats[1][0].team, 'TEAM');
    assert.throws(() => parseSCB('#1 test\nA -- B\n'), /groups of 10/);
});
test('formatSCB writes what parseSCB reads, in Meet Manager\'s layout', () => {
    const lane = (name, team) => ({ name, team }), empty = lane('', '');
    const heat1 = [empty, lane('Doe, Ada', 'ASC'), lane('Featherstonehaugh, Jo', 'WAVE'), ...Array(7).fill(empty)];
    const text = formatSCB({ event: 7, title: ' Girls 9-10 50 Fly ', heats: [heat1, null, [lane('Lee, Di', 'HSSB'), ...Array(9).fill(empty)]] });
    const lines = text.split('\r\n');
    assert.equal(lines[0], '#7 Girls 9-10 50 Fly'); assert.equal(lines.length, 32); assert.equal(lines.at(-1), '');
    lines.slice(1, 31).forEach(l => { assert.equal(l.length, 38); assert.equal(l.indexOf('--'), 20); });
    const back = parseSCB(text);
    assert.equal(back.event, 7); assert.equal(back.title, 'Girls 9-10 50 Fly'); assert.equal(back.heats.length, 3);
    assert.deepEqual(back.heats[0][1], lane('Doe, Ada', 'ASC'));
    assert.equal(back.heats[0][2].name, 'Featherstonehaugh, J');                  // names are cut to 20 characters, as on the wire
    assert(back.heats[1].every(a => !a.name && !a.team), 'a missing heat is written empty');
    assert.deepEqual(back.heats[2][0], lane('Lee, Di', 'HSSB'));
    assert.equal(parseSCB(formatSCB({ event: 3, title: '', heats: [null] })).title, 'Event 3');
});
const header = '﻿#,Time,Dir,Hex Data,ASCII,Bytes,Delta (ms)\r\n';
const csv = header + '1,23:59:59.900,RX ←,"BE 70 6F 5F 40 30 20","comma, quote ""ok""",7,\r\n' +
    '2,23:59:59.950,TX →,00,,1,50\r\n3,00:00:00.100,RX ←,A6 00 18 2C 30 40 50 60 7E,,9,150\r\n';
test('CSV BOM, quotes, RX filtering, byte validation and midnight rollover', () => {
    const c = parseCapture(csv); assert.equal(c.length, 2); assert.equal(c[1].at, 200); assert.equal(c[0].bytes.length, 7);
    assert.throws(() => parseCapture(csv.replace('7,\r\n', '8,\r\n')), /Byte count/);
    assert.throws(() => parseCapture(csv.replace('BE 70', 'BE GG')), /Invalid hex/);
    assert.throws(() => parseCapture(header + '1,08:00:00.000,RX,BE,,1,\n2,07:59:59.000,RX,BE,,1,'), /backwards/);
});
test('replay seek is deterministic including rewind and final block flush', () => {
    const chunks = [{ at: 0, bytes: Uint8Array.from(sample.slice(0, 10)) }, { at: 100, bytes: Uint8Array.from(sample.slice(10)) }];
    const r = new Replay(chunks), end = r.seek(100); r.seek(0); assert.deepEqual(r.seek(100), end);
    const uninterrupted = new Decoder(); for (const c of chunks) uninterrupted.feed(c.bytes, c.at); uninterrupted.finish(100);
    assert.deepEqual(end, uninterrupted.snapshot(100));
});
// A clock block as the console sends it: channel 0, positions 7 down to 2, tenths of a second.
const clockBlock = tenths => { const text = String(Math.floor(tenths / 600)).padStart(2) + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + tenths % 10;
    return [control(0), ...[7, 6, 5, 4, 3, 2].map(p => (p << 4) | (p === 7 || text[p - 2] === ' ' ? 0 : 15 - Number(text[p - 2])))]; };
test('a capture is paced at line rate: no byte early, none lost, any step size', () => {
    const ticks = Array.from({ length: 12 }, (_, i) => clockBlock(595 + i)), bytes = (from, to) => Uint8Array.from(ticks.slice(from, to).flat());
    const chunks = [{ at: 0, bytes: bytes(0, 2) }, { at: 400, bytes: bytes(2, 6) }, { at: 5000, bytes: bytes(6, 12) }];
    const all = chunks.flatMap(c => Array.from(c.bytes)), perByte = 11000 / 9600;
    for (const step of [1, 7, 25, 100, 333, 6000]) {
        const pacer = new Pacer(chunks), got = [], d = new Decoder(), shown = [];
        assert.equal(pacer.duration, 5000);
        for (let t = 0; t <= 5000 + step; t += step) for (const part of pacer.take(t)) {
            assert(part.at <= t); got.push(...part.bytes);
            assert(got.length <= 14 || t >= 400 - 28 * perByte - 1e-9, 'second chunk starts no earlier than line rate allows');
            assert(got.length <= 42 || t >= 5000 - 42 * perByte - 1e-9, 'a long silence is not filled in');
            d.feed(part.bytes, part.at); if (d.clock && shown.at(-1) !== d.clock) shown.push(d.clock);
        }
        assert.deepEqual(got, all); assert.equal(pacer.take(9e9).length, 0);
        if (step <= 7) assert.equal(shown.length, 11);                 // every tick but the last, which commits at the next control byte
        pacer.rewind(); assert.deepEqual(pacer.take(9e9).flatMap(p => Array.from(p.bytes)), all);
    }
    assert.deepEqual(new Pacer([]).take(100), []);
});
test('clock steadiness tells a clean capture from a scrambled one', () => {
    const clean = Array.from({ length: 80 }, (_, i) => ({ at: i * 100, bytes: Uint8Array.from([...clockBlock(i), ...(i % 10 ? [] : block(12, '  5    2'))]) }));
    assert.deepEqual(clockSteps(clean), { clocks: 79, changes: 78, steady: 78 });               // the last block never commits
    const restarted = clean.concat(clean.map(c => ({ at: c.at + 8000, bytes: c.bytes })));       // a new race: one step back to zero
    assert.deepEqual(clockSteps(restarted), { clocks: 159, changes: 158, steady: 157 });
    const scrambled = clean.map(c => ({ at: c.at, bytes: c.bytes.map(b => b & 0x80 ? b : (b * 7 + 3) & 0x7f) }));
    const s = clockSteps(scrambled); assert(s.steady < s.changes * 0.5 || s.changes < 20);
    assert.deepEqual(clockSteps([]), { clocks: 0, changes: 0, steady: 0 });
});
// Optional: decode a real capture. Keep meet captures and athlete data outside the repository.
//   node test/cts.test.js /path/to/folder   (a serial-monitor CSV export named CTS6_Capture.csv, plus any .scb files)
if (require.main === module && process.argv[2]) test('real capture decodes end to end', () => {
    const dir = process.argv[2], chunks = parseCapture(fs.readFileSync(path.join(dir, 'CTS6_Capture.csv'), 'utf8'));
    const d = new Decoder(), events = [], states = new Set();
    for (const c of chunks) { d.feed(c.bytes, c.at); const s = d.snapshot(c.at); states.add(s.state); if (s.event && events.at(-1) !== s.event) events.push(s.event); }
    d.finish(chunks.at(-1).at);
    const files = fs.readdirSync(dir).filter(n => /\.scb$/i.test(n));
    for (const f of files) parseSCB(new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(dir, f))));
    console.log(`  ${chunks.length} chunks, events ${events.join(', ')}, states ${[...states].join('/')}, ${files.length} start-list files parsed`);
});
console.log(`${test.count()} CTS test groups passed`);
