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
    assert.equal(P.allocatePreset([]), 10, 'the first preset given out is 10: 0 to 9 are left to the camera’s own remote');
    assert.equal(P.allocatePreset([{ name: 'a', preset: 10 }, { name: 'here', pan: 1, tilt: 2, zoom: 3 }, { name: 'b', preset: 12 }]), 11, 'a freed number is used again; positions kept as coordinates take none');
    assert.equal(P.allocatePreset(Array.from({ length: 80 }, (_, i) => ({ name: 'p' + i, preset: 10 + i }))), null, 'never 90 and up, which some cameras give special jobs');
    assert.deepEqual(P.cleanPositions([{ name: ' Blocks ', pan: 1148, tilt: 316, zoom: 3382 }, { name: 'blocks', preset: 11 }, { name: 'Far', pan: -40, tilt: 0 }, { name: 'Old', preset: 10 }, { name: 'Dup', preset: 10 }, { name: '', preset: 12 },
        { name: 'Bad', preset: 'x' }, { name: 'Deep', preset: 300 }, { name: 'Wild', pan: 1e9, tilt: 0 }, null]),
        [{ name: 'Blocks', pan: 1148, tilt: 316, zoom: 3382 }, { name: 'Far', pan: -40, tilt: 0, zoom: null }, { name: 'Old', preset: 10 }], 'a file’s positions are taken only when sane, each name once');
    assert.deepEqual(P.cleanPositions(undefined), []);
    // The camera list keeps them, by name, and saves them with the camera.
    const { CameraEngine } = require('../src/main/cameras');
    let saved = null;
    const engine = new CameraEngine({ dataDir: require('node:os').tmpdir(), cameras: [{ id: 'cam-a', name: 'Wide', url: 'rtsp://10.0.0.9/1', positions: [{ name: 'Whole pool', pan: 0, tilt: 28, zoom: 0 }] }, { id: 'cam-b', name: 'Mute', url: 'rtsp://10.0.0.8/1' }], onChange: list => { saved = list; } });
    assert.deepEqual(engine.describe(engine.find('cam-a')).positions, ['Whole pool'], 'the window sees names only');
    assert.deepEqual(engine.savePosition('cam-a', 'Finish line', { pan: 1148, tilt: 316, zoom: 3382 }), { name: 'Finish line', pan: 1148, tilt: 316, zoom: 3382 });
    assert.deepEqual(engine.savePosition('cam-a', 'finish LINE', { pan: 900, tilt: 300, zoom: null }), { name: 'Finish line', pan: 900, tilt: 300, zoom: null }, 're-taught: the same name, however typed, now points somewhere else');
    assert.deepEqual(engine.describe(engine.find('cam-a')).positions, ['Whole pool', 'Finish line']);
    assert.deepEqual(saved.find(c => c.id === 'cam-a').positions, [{ name: 'Whole pool', pan: 0, tilt: 28, zoom: 0 }, { name: 'Finish line', pan: 900, tilt: 300, zoom: null }], 'saved with the camera, so the project carries where each position points');
    assert.deepEqual(engine.position('cam-a', 'WHOLE POOL'), { name: 'Whole pool', pan: 0, tilt: 28, zoom: 0 }); assert.equal(engine.position('cam-a', 'Nowhere'), null);
    // A camera that will not say where it points: a preset number of its own for each position, kept and reused.
    assert.deepEqual(engine.savePosition('cam-b', 'Blocks', null), { name: 'Blocks', preset: 10 });
    assert.deepEqual(engine.savePosition('cam-b', 'Turn', null), { name: 'Turn', preset: 11 });
    assert.deepEqual(engine.savePosition('cam-b', 'blocks', null), { name: 'Blocks', preset: 10 }, 're-taught into the same preset');
    assert.equal(engine.removePosition('cam-b', 'Blocks'), true); assert.equal(engine.removePosition('cam-b', 'Blocks'), false);
    assert.deepEqual(engine.savePosition('cam-b', 'Finish', null), { name: 'Finish', preset: 10 }, 'the freed number is taken by the next position');
    assert.deepEqual(engine.savePosition('cam-b', 'Finish', { pan: 5, tilt: 6, zoom: 7 }), { name: 'Finish', pan: 5, tilt: 6, zoom: 7 }, 'and once the camera does say, the coordinates replace the preset');
    assert.throws(() => engine.savePosition('cam-a', '   ', { pan: 0, tilt: 0, zoom: 0 }), /name/);
    assert.throws(() => engine.savePosition('cam-zzz', 'x', null), /No such camera/);
});

// A stand-in camera on this computer's loopback: answers the version inquiry, records what it is told.
const camera = () => new Promise(resolve => {
    const socket = dgram.createSocket('udp4'), got = [];
    socket.on('message', (buf, from) => { got.push(buf.toString('hex')); if (buf.toString('hex') === '81090002ff') socket.send(Buffer.from('905002010607101501ff', 'hex'), from.port, from.address); });
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
    } finally { ptz.close(); await cam.close(); }
})();
test.later.then(() => console.log(`${test.count()} ptz test groups passed (and the stand-in camera)`), e => { console.error('FAIL the stand-in camera'); console.error(e); process.exitCode = 1; });
