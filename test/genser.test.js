'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { RECORD_LENGTH, parseRecord, StreamParser, parseLog, readCapture, request, displayName, RosterStore } = require('../src/protocol/genser');
const { parseSCB } = require('../src/protocol/cts');
const { test, record } = require('./helpers');
const join = (...parts) => Uint8Array.from(parts.flatMap(p => Array.from(p)));
const relay = record({ event: 2, heat: 1, title: 'Boys 9-10 200 Medley Relay', gender: 'B', lanes: { 3: ['Relay-B', 'TEAM'], 4: ['Relay-A', 'TEAM'], 5: ['Relay-A', 'OTH'] } });
const individual = record({ event: 88, heat: 6, counter: 7, title: 'Mixed 50 Fly', gender: 'X',
    lanes: { 1: ['Sample, Alex', 'AAA'], 2: ['Longlastname-Hyphenated, Jordan', 'BBBB'], 8: ['Example, Sam', 'CC'] } });

test('record fields, blank lanes, truncated names and right-aligned event/heat', () => {
    const r = parseRecord(relay);
    assert.equal(r.event, 2); assert.equal(r.heat, 1); assert.equal(r.title, 'Boys 9-10 200 Medley Relay');
    assert.equal(r.round, 'Timed Finals'); assert.equal(r.gender, 'B'); assert.equal(r.code, '0120'); assert.equal(r.lanes.length, 10);
    assert.deepEqual(r.lanes[2], { lane: 3, name: 'Relay-B', team: 'TEAM', extra: '' });
    assert.equal(r.lanes[0].name, ''); assert.equal(r.lanes[9].name, '');
    const i = parseRecord(individual);
    assert.equal(i.event, 88); assert.equal(i.heat, 6); assert.equal(i.counter, '7');
    assert.equal(i.lanes[1].name, 'Longlastname-Hyphena'); assert.equal(i.lanes[1].team, 'BBBB'); assert.equal(i.lanes[7].team, 'CC');
    assert.equal(RECORD_LENGTH, 502);
});
test('records that do not fit the layout are rejected', () => {
    const bad = (mutate) => { const b = Uint8Array.from(relay); mutate(b); return parseRecord(b); };
    assert.equal(bad(b => { b[0] = 0x20; }), null);                       // no leading CR
    assert.equal(bad(b => { b[498] = 0x41; }), null);                     // event is not a number
    assert.equal(bad(b => { b[501] = 0x20; }), null);                     // heat missing
    assert.equal(bad(b => { b[116 + 2 * 38] = 0x37; }), null);            // lane 3 slot marked 7
    assert.equal(bad(b => { b[200] = 0x0d; }), null);                     // another record starts inside
    assert.equal(parseRecord(relay.subarray(0, 501)), null);
});
test('stream parser finds records at every chunk boundary and byte at a time', () => {
    const stream = join([0x41, 0x42], relay, individual, [0x0d, 0x31]);
    const whole = new StreamParser(), expected = whole.feed(stream);
    assert.equal(expected.length, 2); assert.equal(whole.discarded, 2); assert.equal(whole.buffer.length, 2);
    for (let split = 0; split <= stream.length; split += 7) {
        const p = new StreamParser();
        assert.deepEqual([...p.feed(stream.subarray(0, split)), ...p.feed(stream.subarray(split))], expected);
    }
    const p = new StreamParser(), got = [];
    for (const b of stream) got.push(...p.feed(Uint8Array.of(b)));
    assert.deepEqual(got, expected); assert.equal(p.records, 2); assert.equal(p.bytes, stream.length);
});
test('resynchronises after a stray CR, a cut-off record, and requests on the line', () => {
    const p = new StreamParser({ staleMs: 3000 });
    assert.equal(p.feed(join([0x0d, 0x58, 0x59], relay), 0).length, 1);           // stray CR, then a real record
    assert.equal(p.discarded, 3);
    assert.equal(p.feed(individual.subarray(0, 300), 1000).length, 0);            // record cut off mid-way
    assert.deepEqual(p.feed(relay, 9000).map(r => r.event), [2]);                 // long pause: partial dropped
    assert.equal(p.discarded, 303);
    const q = new StreamParser();
    assert.deepEqual(q.feed(join(request(2, 1), individual, request(2, 2))).map(r => r.event), [88]);
    assert.equal(q.requests, 2); assert.equal(q.discarded, 0);
    const split = new StreamParser(); split.feed(request(12, 3).subarray(0, 5)); split.feed(request(12, 3).subarray(5));
    assert.equal(split.requests, 1);
});
test('request framing matches the scoreboard computer: STX EEE HH T EOT', () => {
    assert.deepEqual(Array.from(request(1, 1)), [0x02, 0x30, 0x30, 0x31, 0x30, 0x31, 0x31, 0x04]);
    assert.deepEqual(Array.from(request(88, 6)), [0x02, 0x30, 0x38, 0x38, 0x30, 0x36, 0x31, 0x04]);
    assert.throws(() => request(0, 1), /Event/); assert.throws(() => request(1000, 1), /Event/); assert.throws(() => request(1, 100), /Heat/);
});
test('names: Last, First becomes First Last; relay names are untouched', () => {
    assert.equal(displayName('Sample, Alex'), 'Alex Sample'); assert.equal(displayName('Van Example, Mary Jo'), 'Mary Jo Van Example');
    assert.equal(displayName('Relay-B'), 'Relay-B'); assert.equal(displayName('Sample, Alex', false), 'Sample, Alex');
    assert.equal(displayName('Truncated,'), 'Truncated,');
});
test('a newer start list replaces the old one; storage round trip keeps heats in place', () => {
    const store = new RosterStore();
    store.add(parseRecord(individual));
    store.add(parseRecord(record({ event: 88, heat: 6, title: 'Mixed 50 Fly', lanes: { 1: ['Replacement, Pat', 'ZZ'] } })));
    assert.equal(store.heats, 1); assert.equal(store.view().get(88).heats[5][0].name, 'Pat Replacement'); assert.equal(store.view().get(88).heats[5][7].name, '');
    const copy = RosterStore.fromJSON(JSON.parse(JSON.stringify(store)));
    assert.equal(copy.heats, 1); assert.equal(copy.has(88, 6), true); assert.equal(copy.has(88, 1), false);
    assert.equal(copy.view().get(88).title, 'Mixed 50 Fly');
    assert.equal(RosterStore.fromJSON('nonsense').heats, 0); assert.equal(RosterStore.fromJSON([{ event: 'x' }, null]).heats, 0);
    store.clear(); assert.equal(store.heats, 0); assert.equal(store.view().size, 0);
});
test('storing a start list says what it did: added, unchanged, or replaced lane by lane', () => {
    const store = new RosterStore(), heat = lanes => parseRecord(record({ event: 9, heat: 2, title: 'Girls 9-10 50 Back', lanes }));
    const first = store.add(heat({ 3: ['Sample, Alex', 'AAA'], 4: ['Example, Sam', 'BBB'] }), 'E009.scb', 1000);
    assert.equal(first.status, 'added'); assert.deepEqual(first.changes, []); assert.equal(first.event, 9); assert.equal(first.heat, 2);
    assert.equal(store.add(heat({ 3: ['Sample, Alex', 'AAA'], 4: ['Example, Sam', 'BBB'] }), 'serial', 2000).status, 'unchanged');
    assert.deepEqual(store.events.get(9).info[1], { source: 'serial', at: 2000 });                 // a repeat still counts as the newest
    // A scratch in lane 3, a swap in lane 4, a late entry in lane 5.
    const next = store.add(heat({ 4: ['Example, Sam', 'CCC'], 5: ['Newcomer, Lee', 'AAA'] }), 'serial', 3000);
    assert.equal(next.status, 'replaced'); assert.equal(next.title, null);
    assert.deepEqual(next.changes, [{ lane: 3, from: { name: 'Sample, Alex', team: 'AAA' }, to: { name: '', team: '' } },
        { lane: 4, from: { name: 'Example, Sam', team: 'BBB' }, to: { name: 'Example, Sam', team: 'CCC' } },
        { lane: 5, from: { name: '', team: '' }, to: { name: 'Newcomer, Lee', team: 'AAA' } }]);
    assert.equal(store.view().get(9).heats[1][2].name, ''); assert.equal(store.view().get(9).heats[1][4].name, 'Lee Newcomer'); assert.equal(store.heats, 1);
    const renamed = store.add(parseRecord(record({ event: 9, heat: 2, title: 'Girls 9-10 50 Backstroke', lanes: { 4: ['Example, Sam', 'CCC'], 5: ['Newcomer, Lee', 'AAA'] } })), 'serial', 4000);
    assert.equal(renamed.status, 'replaced'); assert.deepEqual(renamed.changes, []); assert.deepEqual(renamed.title, { from: 'Girls 9-10 50 Back', to: 'Girls 9-10 50 Backstroke' });
    // A file replaces the whole event: heat 1 is new, heat 2 changes, and a heat it no longer lists goes.
    store.add(parseRecord(record({ event: 9, heat: 3, title: 'Girls 9-10 50 Backstroke', lanes: { 1: ['Gone, Robin', 'DDD'] } })), 'serial', 5000);
    const slot = (name, team) => ({ name, team }), blank = () => Array.from({ length: 10 }, () => slot('', ''));
    const h1 = blank(), h2 = blank(); h1[0] = slot('First, Kit', 'AAA'); h2[3] = slot('Example, Sam', 'CCC');
    const results = store.addEvent({ event: 9, title: 'Girls 9-10 50 Backstroke', heats: [h1, h2] }, 'E009.scb', 6000);
    assert.deepEqual(results.map(r => [r.heat, r.status, r.changes.map(c => c.lane)]), [[1, 'added', []], [2, 'replaced', [5]], [3, 'removed', []]]);
    assert.equal(store.heats, 2); assert.equal(store.has(9, 3), false); assert.deepEqual(store.view().get(9).info[0], { source: 'E009.scb', at: 6000 });
    assert.deepEqual(store.addEvent({ event: 9, title: 'Girls 9-10 50 Backstroke', heats: [h1, h2] }, 'E009.scb', 7000).map(r => r.status), ['unchanged', 'unchanged']);
    // Where and when each heat came from survives saving; data saved before this was recorded still loads.
    const copy = RosterStore.fromJSON(JSON.parse(JSON.stringify(store)));
    assert.deepEqual(copy.events.get(9).info, [{ source: 'E009.scb', at: 7000 }, { source: 'E009.scb', at: 7000 }]);
    const old = RosterStore.fromJSON([{ event: 4, title: 'Old', heats: [null, h2] }]);
    assert.equal(old.heats, 1); assert.deepEqual(old.events.get(4).info[1], { source: '', at: null }); assert.equal(old.add(heat({}), 'serial', 1).status, 'added');
});
// A capture as com-monitor writes it: 16 bytes a line, a route column 24 wide, the text between bars.
function logText(frames) {
    const lines = ['# com-monitor log started 2026-01-01 10:00:00.000', '2026-01-01 10:00:00.010 # PORTB: open 9600 8N1 none'];
    for (const [ms, from, to, bytes] of frames) {
        const stamp = `2026-01-01 10:00:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
        for (let i = 0; i < bytes.length; i += 16) {
            const row = Array.from(bytes.slice(i, i + 16));
            const hex = row.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ').padEnd(47);
            const shown = row.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·').join('');
            lines.push(`${i ? ' '.repeat(48) : stamp + ' ' + (from + ' ▶' + (to ? ' ' + to : '')).padEnd(24)}  ${hex}  |${shown}|`);
        }
    }
    return lines.join('\r\n') + '\r\n# com-monitor log closed 2026-01-01 10:05:00.000\r\n';
}
test('a com-monitor log gives back each frame\'s bytes, sender and time', () => {
    const awkward = record({ event: 5, heat: 2, lanes: { 1: ['AB CD | EF 01, 0D', 'A|B'] } });     // text that looks like hex, and bars
    const chunks = parseLog(logText([[1000, 'PORTA', 'PORTB', request(5, 2)], [1040, 'PORTB', 'PORTA', awkward], [2500, 'PORTC', '', [0x32]]]));
    assert.deepEqual(chunks.map(c => [c.source, c.bytes.length]), [['PORTA', 8], ['PORTB', 502], ['PORTC', 1]]);
    assert.deepEqual(Array.from(chunks[0].bytes), Array.from(request(5, 2))); assert.deepEqual(Array.from(chunks[1].bytes), Array.from(awkward));
    assert.equal(chunks[1].at - chunks[0].at, 40); assert.equal(chunks[2].at - chunks[0].at, 1500);
    assert.equal(parseLog('Smith, Alex --TEAM\n# just notes\n   0D 30 30\n').length, 0);      // no frame line, so nothing to continue
});
test('start lists are read from a capture log, or from the bytes themselves', () => {
    // The scoreboard computer's next request is logged while Meet Manager is still sending its reply.
    const log = logText([[0, 'PORTA', 'PORTB', request(2, 1)], [30, 'PORTB', 'PORTA', relay.subarray(0, 200)], [110, 'PORTA', 'PORTB', request(2, 2)],
        [150, 'PORTB', 'PORTA', relay.subarray(200)], [900, 'PORTA', 'PORTB', request(88, 6)], [930, 'PORTB', 'PORTA', individual]]);
    assert.deepEqual(readCapture(log).map(r => [r.event, r.heat]), [[2, 1], [88, 6]]);
    assert.deepEqual(readCapture(log, { source: 'PORTB' }).map(r => r.event), [2, 88]); assert.equal(readCapture(log, { source: 'PORTA' }).length, 0);
    assert.deepEqual(readCapture(join(request(2, 1), relay, [0x55], individual)).map(r => r.event), [2, 88]);
    assert.equal(readCapture('not a capture').length, 0); assert.equal(readCapture(Uint8Array.of(1, 2, 3)).length, 0);
});
test('an .scb file replaces its whole event; a later start list replaces one heat of it', () => {
    const slots = entries => Array.from({ length: 10 }, (_, i) => entries[i + 1] || ' -- ');
    const scb = (event, title, ...heats) => [`#${event} ${title}`, ...heats.flatMap(slots)].join('\r\n') + '\r\n';
    const store = new RosterStore();
    store.add(parseRecord(individual));                                                          // event 88 heat 6, from serial
    store.addEvent(parseSCB(scb(88, 'MIXED 50 FLY', { 4: 'Sample, Alex     --AAA' }, { 5: 'Example, Sam     --CC' })));
    assert.equal(store.heats, 2); assert.equal(store.has(88, 6), false); assert.equal(store.has(88, 2), true);
    store.addEvent(parseSCB(scb(3, 'BOYS 200 MEDLEY RELAY', { 3: 'TEAM B --TEAM' })));
    assert.equal(store.heats, 3); assert.equal(store.events.size, 2);
    assert.deepEqual(store.view().get(88).heats[0][3], { name: 'Alex Sample', team: 'AAA' });
    assert.equal(store.view({ firstLast: false }).get(88).heats[1][4].name, 'Example, Sam'); assert.equal(store.view().get(3).heats[0][2].name, 'TEAM B');
    store.add(parseRecord(record({ event: 88, heat: 2, title: 'Mixed 50 Fly', lanes: { 5: ['Replacement, Pat', 'ZZ'] } })));
    assert.equal(store.heats, 3); assert.equal(store.view().get(88).heats[1][4].name, 'Pat Replacement'); assert.equal(store.view().get(88).title, 'Mixed 50 Fly');
});
// Optional: decode a com-monitor log of the real link. Keep captures with athlete names outside the repository.
//   node test/genser.test.js /path/to/capture.log [PORT_NAME]
if (require.main === module && process.argv[2]) test('capture regression: every start list in a com-monitor log decodes', () => {
    const records = readCapture(fs.readFileSync(process.argv[2], 'utf8'), { source: process.argv[3] || '' }), store = new RosterStore();
    assert(records.length > 0, 'no start lists found; check the port name');
    for (const r of records) store.add(r);
    const entries = records.reduce((n, r) => n + r.lanes.filter(l => l.name).length, 0);
    console.log(`  ${records.length} start lists, ${store.heats} distinct heats in ${store.events.size} events, ${entries} lane entries`);
});
console.log(`${test.count()} GENSER test groups passed`);
