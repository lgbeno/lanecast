'use strict';
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const P = require('../src/main/ptz');
const { test } = require('./helpers');
const hex = bytes => Buffer.from(bytes).toString('hex');

test('VISCA messages: drive, zoom, home and presets, with speeds and directions in range', () => {
    assert.equal(hex(P.visca.versionInquiry()), '81090002ff');
    assert.equal(hex(P.visca.move(1, 0)), '8101060118010203ff', 'full speed right, tilt still');
    assert.equal(hex(P.visca.move(-0.5, 0.5)), '810106010c0a0101ff', 'half speed left and up');
    assert.equal(hex(P.visca.move(0, -1)), '8101060101140302ff', 'down; the idle axis still carries a legal speed');
    assert.equal(hex(P.visca.move(0, 0)), '8101060101010303ff', 'stop');
    assert.equal(hex(P.visca.move(9, -9)), hex(P.visca.move(1, -1)), 'out of range is held to full speed');
    assert.equal(hex(P.visca.move('x', undefined)), hex(P.visca.move(0, 0)), 'nonsense stops rather than moves');
    assert.equal(hex(P.visca.zoom(1)), '8101040727ff'); assert.equal(hex(P.visca.zoom(-0.4)), '8101040733ff'); assert.equal(hex(P.visca.zoom(0)), '8101040700ff');
    assert.equal(hex(P.visca.home()), '81010604ff');
    assert.equal(hex(P.visca.preset(3)), '8101043f0203ff', 'go to preset 3'); assert.equal(hex(P.visca.preset(3, true)), '8101043f0103ff', 'store preset 3');
    assert.equal(hex(P.visca.preset(999)), '8101043f027fff');
});

test('VISCA replies are read raw or in Sony framing; the version answer says the camera can be steered', () => {
    const raw = Buffer.from('905002010607101501ff', 'hex'), framed = Buffer.from('0111000a00000001905002010607101501ff', 'hex');       // as a real camera sent them
    assert.deepEqual(P.unframe(raw), [...raw]); assert.deepEqual(P.unframe(framed), [...raw]);
    assert.equal(P.isVersion(P.unframe(raw)), true); assert.equal(P.isVersion(P.unframe(framed)), true);
    assert.equal(P.isVersion(P.unframe(Buffer.from('9041ff', 'hex'))), false, 'an acknowledgement is not a version');
    assert.equal(P.unframe(Buffer.from('hello')), null); assert.equal(P.unframe(Buffer.from('9050', 'hex')), null);
    assert.equal(hex(P.frame(P.visca.home(), 7)), '010000050000000781010604ff'); assert.equal(hex(P.frame(P.visca.versionInquiry(), 1, true)), '011000050000000181090002ff');
    assert.deepEqual(P.position(P.unframe(Buffer.from('90500001020300000405ff', 'hex'))), { pan: 0x0123, tilt: 0x0045 });
    assert.deepEqual(P.position(P.unframe(Buffer.from('90500f0f0f0e0f0f0f0fff', 'hex'))), { pan: -2, tilt: -1 }, 'left of centre and below it are negative');
    assert.equal(P.position(P.unframe(raw)), null, 'another answer is not a position');
});

test('positions have names; under each is where the camera pointed, or a preset number if it would not say', () => {
    assert.equal(hex(P.visca.zoomInquiry()), '81090447ff');
    assert.equal(hex(P.visca.absolute(1148, 316)), '81010602181400040' + '70c0001030cff', 'as a real camera reported it: pan 0x047c, tilt 0x013c');
    assert.equal(hex(P.visca.absolute(-2, -1)), '8101060218140f0f0f0e0f0f0f0fff', 'left of centre and below it, in two’s complement');
    assert.equal(hex(P.visca.zoomTo(3382)), '81010447000d0306ff');
    assert.equal(P.zoomOf(P.unframe(Buffer.from('9050000d0306ff', 'hex'))), 3382); assert.equal(P.zoomOf(P.unframe(Buffer.from('90500004070c0001030cff', 'hex'))), null, 'a position answer is not a zoom');
    // Focus: read with the position, put back on arrival.
    assert.equal(hex(P.visca.focusInquiry()), '81090448ff'); assert.equal(hex(P.visca.focusModeInquiry()), '81090438ff');
    assert.equal(hex(P.visca.focusMode(true)), '8101043802ff'); assert.equal(hex(P.visca.focusMode(false)), '8101043803ff');
    assert.equal(hex(P.visca.focusTo(17975)), '810104480406030' + '7ff', 'as a real camera reported it: focus 0x4637');
    assert.equal(P.zoomOf(P.unframe(Buffer.from('905004060307ff', 'hex'))), 17975, 'the focus answer reads like the zoom one');
    assert.equal(P.focusAutoOf(P.unframe(Buffer.from('905002ff', 'hex'))), true); assert.equal(P.focusAutoOf(P.unframe(Buffer.from('905003ff', 'hex'))), false); assert.equal(P.focusAutoOf(P.unframe(Buffer.from('9041ff', 'hex'))), null);
    assert.equal(P.allocatePreset([]), 10, 'the first preset given out is 10: 0 to 9 are left to the camera’s own remote');
    assert.equal(P.allocatePreset([{ name: 'a', preset: 10 }, { name: 'here', pan: 1, tilt: 2, zoom: 3 }, { name: 'b', preset: 12 }]), 11, 'a freed number is used again; positions kept as coordinates take none');
    assert.equal(P.allocatePreset(Array.from({ length: 80 }, (_, i) => ({ name: 'p' + i, preset: 10 + i }))), null, 'never 90 and up, which some cameras give special jobs');
    assert.deepEqual(P.cleanPositions([{ name: ' Blocks ', pan: 1148, tilt: 316, zoom: 3382, focus: 17975, focusAuto: false }, { name: 'blocks', preset: 11 }, { name: 'Far', pan: -40, tilt: 0 }, { name: 'Old', preset: 10 }, { name: 'Dup', preset: 10 }, { name: '', preset: 12 },
        { name: 'Bad', preset: 'x' }, { name: 'Deep', preset: 300 }, { name: 'Wild', pan: 1e9, tilt: 0 }, null]),
        [{ name: 'Blocks', pan: 1148, tilt: 316, zoom: 3382, focus: 17975, focusAuto: false }, { name: 'Far', pan: -40, tilt: 0, zoom: null, focus: null, focusAuto: true }, { name: 'Old', preset: 10 }], 'a file’s positions are taken only when sane, each name once; one saved before focus was kept has none');
    assert.deepEqual(P.cleanPositions(undefined), []);
    // The camera list keeps them, by name, and saves them with the camera.
    const { CameraEngine } = require('../src/main/cameras');
    let saved = null;
    const engine = new CameraEngine({ dataDir: require('node:os').tmpdir(), cameras: [{ id: 'cam-a', name: 'Wide', url: 'rtsp://10.0.0.9/1', positions: [{ name: 'Whole pool', pan: 0, tilt: 28, zoom: 0 }] }, { id: 'cam-b', name: 'Mute', url: 'rtsp://10.0.0.8/1' }], onChange: list => { saved = list; } });
    assert.deepEqual(engine.describe(engine.find('cam-a')).positions, ['Whole pool'], 'the window sees names only');
    assert.deepEqual(engine.savePosition('cam-a', 'Finish line', { pan: 1148, tilt: 316, zoom: 3382, focus: 17975, focusAuto: true }), { name: 'Finish line', pan: 1148, tilt: 316, zoom: 3382, focus: 17975, focusAuto: true }, 'pan, tilt, zoom and the focus with them');
    assert.deepEqual(engine.savePosition('cam-a', 'finish LINE', { pan: 900, tilt: 300, zoom: null, focus: 16000, focusAuto: false }), { name: 'Finish line', pan: 900, tilt: 300, zoom: null, focus: 16000, focusAuto: false }, 're-taught: the same name, however typed, now points somewhere else');
    assert.deepEqual(engine.describe(engine.find('cam-a')).positions, ['Whole pool', 'Finish line']);
    assert.deepEqual(saved.find(c => c.id === 'cam-a').positions, [{ name: 'Whole pool', pan: 0, tilt: 28, zoom: 0, focus: null, focusAuto: true }, { name: 'Finish line', pan: 900, tilt: 300, zoom: null, focus: 16000, focusAuto: false }], 'saved with the camera, so the project carries where each position points');
    assert.deepEqual(engine.position('cam-a', 'WHOLE POOL'), { name: 'Whole pool', pan: 0, tilt: 28, zoom: 0, focus: null, focusAuto: true }); assert.equal(engine.position('cam-a', 'Nowhere'), null);
    // A camera that will not say where it points: a preset number of its own for each position, kept and reused.
    assert.deepEqual(engine.savePosition('cam-b', 'Blocks', null), { name: 'Blocks', preset: 10 });
    assert.deepEqual(engine.savePosition('cam-b', 'Turn', null), { name: 'Turn', preset: 11 });
    assert.deepEqual(engine.savePosition('cam-b', 'blocks', null), { name: 'Blocks', preset: 10 }, 're-taught into the same preset');
    assert.equal(engine.removePosition('cam-b', 'Blocks'), true); assert.equal(engine.removePosition('cam-b', 'Blocks'), false);
    assert.deepEqual(engine.savePosition('cam-b', 'Finish', null), { name: 'Finish', preset: 10 }, 'the freed number is taken by the next position');
    assert.deepEqual(engine.savePosition('cam-b', 'Finish', { pan: 5, tilt: 6, zoom: 7 }), { name: 'Finish', pan: 5, tilt: 6, zoom: 7, focus: null, focusAuto: true }, 'and once the camera does say, the coordinates replace the preset');
    assert.throws(() => engine.savePosition('cam-a', '   ', { pan: 0, tilt: 0, zoom: 0 }), /name/);
    assert.throws(() => engine.savePosition('cam-zzz', 'x', null), /No such camera/);
});

// A stand-in camera on this computer's loopback: answers the version inquiry, records what it is told.
const camera = () => new Promise(resolve => {
    const socket = dgram.createSocket('udp4'), got = [];
    const ANSWERS = { '81090002ff': '905002010607101501ff', '81090612ff': '90500001020300000405ff', '81090447ff': '905001020304ff', '81090448ff': '90500a0b0c0dff', '81090438ff': '905002ff' };     // version; pan 0x0123 tilt 0x0045; zoom 0x1234; focus 0xabcd; autofocus
    socket.on('message', (buf, from) => { const hex = buf.toString('hex'); if (ANSWERS[hex]) socket.send(Buffer.from(ANSWERS[hex], 'hex'), from.port, from.address); else got.push(hex); });       // questions are answered; everything else is noted
    socket.bind(1259, '127.0.0.1', () => resolve({ got, close: () => new Promise(done => socket.close(done)) }));
    socket.on('error', () => resolve(null));                                  // the port is taken: skip
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
test.later = (async () => {
    const cam = await camera();
    if (!cam) { console.log('SKIP the stand-in camera: UDP 1259 is in use here'); return; }
    const ptz = new P.Ptz();
    try {
        const info = await ptz.probe('127.0.0.1');
        assert.deepEqual([info.protocol, info.port, info.framed, info.version], ['VISCA', 1259, false, '02010607101501'], 'found by its version answer');
        assert.equal(ptz.move('127.0.0.2', 1, 0), false, 'a camera never probed is not sent anything');
        ptz.move('127.0.0.1', 1, 0); await wait(60);
        assert.equal(cam.got.at(-1), '8101060118010203ff', 'the drive arrives');
        await wait(P.HOLD_MS + 250);
        assert.deepEqual(cam.got.slice(-2), ['8101060101010303ff', '8101040700ff'], 'not renewed, so stopped from here: pan and tilt, then zoom');
        ptz.zoom('127.0.0.1', 1); await wait(40); ptz.stop('127.0.0.1'); await wait(40);
        assert.deepEqual(cam.got.slice(-3), ['8101040727ff', '8101060101010303ff', '8101040700ff'], 'a release stops at once');
        const before = cam.got.length; await wait(P.HOLD_MS + 200);
        assert.equal(cam.got.length, before, 'and nothing more is sent after a stop');
        ptz.preset('127.0.0.1', 2); ptz.home('127.0.0.1'); await wait(40);
        assert.deepEqual(cam.got.slice(-2), ['8101043f0202ff', '81010604ff']);
        console.log('PASS a camera is found by its version answer; a drive not renewed is stopped; release, presets and home are sent');
        // Where it points is read with its lens, and going back puts the focus there once the camera has arrived, then autofocus again.
        const spot = await ptz.where('127.0.0.1', true);
        assert.deepEqual(spot, { pan: 0x0123, tilt: 0x0045, zoom: 0x1234, focus: 0xabcd, focusAuto: true });
        assert.deepEqual(await ptz.where('127.0.0.1'), { pan: 0x0123, tilt: 0x0045, zoom: 0x1234 }, 'the lens is only asked for when wanted');
        let mark = cam.got.length; ptz.goTo('127.0.0.1', spot); await wait(120);
        assert.deepEqual(cam.got.slice(mark), ['8101060218140001020300000405ff', '8101044701020304ff'], 'first the move and the zoom: the lens takes no focus while it travels');
        await wait(700);
        assert.deepEqual(cam.got.slice(mark + 2), ['8101043803ff', '810104480a0b0c0dff'], 'arrived (two readings the same): manual focus, and the focus it was saved at');
        await wait(900);
        assert.deepEqual(cam.got.slice(mark + 4), ['8101043802ff'], 'then autofocus again, starting from sharp');
        // Saved while focused by hand: it stays in manual.
        mark = cam.got.length; ptz.goTo('127.0.0.1', { ...spot, focusAuto: false }); await wait(2300);
        assert.deepEqual(cam.got.slice(mark), ['8101060218140001020300000405ff', '8101044701020304ff', '8101043803ff', '810104480a0b0c0dff'], 'a position saved in manual focus leaves the camera in manual');
        // Steered away before it arrived: the focus is dropped. Steered away while the lens was being set: autofocus is put back.
        mark = cam.got.length; ptz.goTo('127.0.0.1', spot); await wait(100); ptz.move('127.0.0.1', 1, 0); await wait(60); ptz.stop('127.0.0.1'); await wait(1900);
        assert.deepEqual(cam.got.slice(mark + 2), ['8101060118010203ff', '8101060101010303ff', '8101040700ff'], 'driven off before arriving: no focus is set afterwards');
        mark = cam.got.length; ptz.goTo('127.0.0.1', spot); await wait(900); ptz.home('127.0.0.1'); await wait(1200);
        assert.deepEqual(cam.got.slice(mark + 2), ['8101043803ff', '810104480a0b0c0dff', '8101043802ff', '81010604ff'], 'sent elsewhere while the lens was being set: autofocus is put back first, never left in manual');
        // A position saved before focus was kept just moves.
        mark = cam.got.length; ptz.goTo('127.0.0.1', { pan: 0x0123, tilt: 0x0045, zoom: 0x1234, focus: null }); await wait(1600);
        assert.deepEqual(cam.got.slice(mark), ['8101060218140001020300000405ff', '8101044701020304ff']);
        console.log('PASS a position is read with its focus; going back sets the focus on arrival and hands back to autofocus, unless steered away');
    } finally { ptz.close(); await cam.close(); }
})();
test.later.then(() => console.log(`${test.count()} ptz test groups passed (and the stand-in camera)`), e => { console.error('FAIL the stand-in camera'); console.error(e); process.exitCode = 1; });
