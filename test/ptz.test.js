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
