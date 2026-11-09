'use strict';
const assert = require('node:assert/strict');
const D = require('../src/main/discover');
const { test } = require('./helpers');

// A DNS response built by hand, the way a camera's mDNS responder sends it: the answer points at the instance,
// and the additional records (its SRV, TXT and A) use compression pointers back into the packet.
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
function response() {
    const service = D.encodeName(D.labelsOf('_ndi._tcp.local'));                  // at offset 12
    const instanceLabel = Buffer.from('SWIMCAM (default,192.168.1.88)');
    const header = Buffer.alloc(12); header.writeUInt16BE(0x8400, 2); header.writeUInt16BE(1, 6); header.writeUInt16BE(3, 10);
    const pointer = at => Buffer.from([0xc0 | (at >> 8), at & 0xff]);
    // PTR _ndi._tcp.local -> <instance>.<pointer to the service name>
    const ptrData = Buffer.concat([Buffer.from([instanceLabel.length]), instanceLabel, pointer(12)]);
    const ptr = Buffer.concat([service, u16(D.TYPE.PTR), u16(1), u32(120), u16(ptrData.length), ptrData]);
    const instanceAt = 12 + service.length + 10;                                  // where the instance name starts, inside the PTR data
    const host = Buffer.concat([Buffer.from([7]), Buffer.from('SWIMCAM'), Buffer.from([5]), Buffer.from('local'), Buffer.from([0])]);
    const srvData = Buffer.concat([u16(0), u16(0), u16(5961), host]);
    const srv = Buffer.concat([pointer(instanceAt), u16(D.TYPE.SRV), u16(0x8001), u32(120), u16(srvData.length), srvData]);
    const hostAt = 12 + ptr.length + 2 + 10 + 6;                                  // the host name inside the SRV data
    const txtData = Buffer.concat([Buffer.from([13]), Buffer.from('groups=Public'), Buffer.from([14]), Buffer.from('discovery=5960')]);
    const txt = Buffer.concat([pointer(instanceAt), u16(D.TYPE.TXT), u16(0x8001), u32(4500), u16(txtData.length), txtData]);
    const a = Buffer.concat([pointer(hostAt), u16(D.TYPE.A), u16(0x8001), u32(120), u16(4), Buffer.from([192, 168, 1, 88])]);
    return Buffer.concat([header, ptr, srv, txt, a]);
}

test('a DNS query is written and an mDNS response read, compression pointers and all', () => {
    const query = D.encodeQuery([{ labels: D.labelsOf('_ndi._tcp.local'), type: D.TYPE.PTR }]);
    assert.equal(query.readUInt16BE(4), 1, 'one question');
    assert.equal(query.toString('latin1', 12), '\x04_ndi\x04_tcp\x05local\x00\x00\x0c\x00\x01');
    assert.equal(D.encodeQuery([{ labels: ['a'], type: 1 }], { unicast: true }).readUInt16BE(17), 0x8001, 'the unicast-answer bit');
    const packet = D.decodePacket(response());
    assert.equal(packet.response, true);
    assert.deepEqual(packet.answers.map(r => r.type), [D.TYPE.PTR, D.TYPE.SRV, D.TYPE.TXT, D.TYPE.A]);
    assert.deepEqual(packet.answers[0].data, ['SWIMCAM (default,192.168.1.88)', '_ndi', '_tcp', 'local'], 'a label with dots in it stays one label');
    assert.deepEqual(packet.answers[1].data, { port: 5961, target: ['SWIMCAM', 'local'] });
    assert.deepEqual(packet.answers[1].labels, packet.answers[0].data, 'the SRV names the instance through a pointer');
    assert.deepEqual(packet.answers[2].data, ['groups=Public', 'discovery=5960']);
    assert.equal(packet.answers[3].data, '192.168.1.88');
    // Malformed packets are refused, not looped on.
    assert.throws(() => D.decodePacket(Buffer.alloc(5)), /short/);
    const loop = Buffer.concat([Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from([0xc0, 12])]);      // a name that points at itself
    assert.throws(() => D.decodePacket(loop), /pointer|truncated/);
    assert.throws(() => D.decodePacket(response().subarray(0, 60)), /truncated|bad/);
});

test('announcements add up to a camera with its host, port, address and the adapter it came in on', () => {
    const records = new D.Records(['_ndi._tcp.local', '_rtsp._tcp.local']);
    const { answers } = D.decodePacket(response());
    records.add([answers[0]], 'en5');                                             // first only the pointer arrives
    assert.deepEqual(records.missing().map(q => q.type), [D.TYPE.SRV, D.TYPE.TXT], 'the rest is asked for');
    records.add([answers[1], answers[2]], 'en5');
    assert.deepEqual(records.missing(), [{ labels: ['SWIMCAM', 'local'], type: D.TYPE.A }], 'then the address of its host');
    records.add([answers[3]], 'en5');
    assert.deepEqual(records.missing(), []);
    assert.deepEqual(records.list(), [{ service: '_ndi._tcp.local', name: 'SWIMCAM (default,192.168.1.88)', host: 'SWIMCAM.local', port: 5961, addresses: ['192.168.1.88'], txt: ['groups=Public', 'discovery=5960'], via: ['en5'] }]);
    // Unrelated services heard on the wire are ignored.
    records.add([{ labels: D.labelsOf('_airplay._tcp.local'), type: D.TYPE.PTR, data: ['TV', '_airplay', '_tcp', 'local'] }], 'en0');
    assert.equal(records.list().length, 1);
    const merged = D.merge(records.list(), [{ address: '192.168.1.88', name: 'PTZ20', model: 'PTZ20', via: ['en5'] }, { address: '192.168.68.40', name: 'Deck cam', model: '', via: ['en0'] }]);
    assert.deepEqual(merged.map(c => [c.name, c.address, c.kinds.join('+'), c.via.join()]), [['SWIMCAM', '192.168.1.88', 'NDI+ONVIF', 'en5'], ['Deck cam', '192.168.68.40', 'ONVIF', 'en0']], 'NDI and ONVIF answers from one address are one camera');
});

test('a camera in another network is diagnosed with the adapter to set and what to set it to', () => {
    const wifi = { name: 'en0', label: 'Wi-Fi', address: '192.168.68.82', netmask: '255.255.252.0', selfAssigned: false };
    const usb = { name: 'en5', label: 'AX88179B', address: '169.254.174.205', netmask: '255.255.0.0', selfAssigned: true };
    assert.equal(D.sameNetwork('192.168.68.82', '192.168.71.9', '255.255.252.0'), true);
    assert.equal(D.sameNetwork('192.168.68.82', '192.168.72.9', '255.255.252.0'), false);
    assert.equal(D.sameNetwork('200.1.2.3', '200.1.2.99', '255.255.255.0'), true, 'addresses above 127 compare as unsigned');
    const same = D.diagnose('192.168.70.15', [wifi, usb], ['en0'], 'darwin');
    assert.deepEqual([same.reach, same.adapter.label], ['same-network', 'Wi-Fi']);
    const other = D.diagnose('192.168.1.88', [wifi, usb], ['en5'], 'darwin');
    assert.equal(other.reach, 'other-network'); assert.equal(other.adapter.label, 'AX88179B');
    assert.deepEqual([other.fix.address, other.fix.netmask], ['192.168.1.10', '255.255.255.0']);
    assert.equal(other.fix.command, 'networksetup -setmanual "AX88179B" 192.168.1.10 255.255.255.0');
    assert.match(other.fix.where, /System Settings → Network → AX88179B/);
    // Heard on no adapter in particular (or on all of them): the one nothing gives an address to is the likely cable.
    assert.equal(D.diagnose('10.0.0.5', [wifi, usb], [], 'darwin').adapter.label, 'AX88179B');
    assert.equal(D.diagnose('10.0.0.5', [wifi, usb], ['en0', 'en5'], 'darwin').adapter.label, 'AX88179B');
    assert.equal(D.diagnose('10.0.0.5', [wifi], [], 'darwin').adapter, null, 'no guess when nothing points at an adapter');
    assert.equal(D.diagnose('192.168.1.10', [wifi, usb], ['en5'], 'darwin').fix.address, '192.168.1.11', 'never the camera’s own address');
    assert.equal(D.diagnose('192.168.1.88', [wifi, usb], ['en5'], 'win32').fix.command, 'netsh interface ipv4 set address name="en5" static 192.168.1.10 255.255.255.0');
    assert.equal(D.diagnose('192.168.1.88', [wifi, usb], ['en5'], 'linux').fix.command, 'sudo ip addr add 192.168.1.10/24 dev en5');
    const text = D.explain({ address: '192.168.1.88', diagnosis: other, rtsp: null }, [wifi, usb]);
    assert.equal(text, 'This camera was found, but requires additional configuration to communicate.', 'what to do, not a lesson in networking');
    assert.equal(other.fix.terminal, 'Open Terminal'); assert.equal(D.diagnose('192.168.1.88', [wifi, usb], ['en5'], 'win32').fix.terminal, 'Open Command Prompt as an administrator'); assert.equal(D.diagnose('192.168.1.88', [wifi, usb], ['en5'], 'linux').fix.terminal, 'Open a terminal');
    // The why is kept, for anyone who wants it (the window shows it when the message is pointed at).
    const why = D.detail({ address: '192.168.1.88', diagnosis: other }, [wifi, usb]);
    assert.match(why, /no address in 192\.168\.1\.x/); assert.match(why, /AX88179B is 169\.254\.174\.205 \(self-assigned/);
    assert.equal(D.detail({ address: '192.168.70.15', diagnosis: same }, [wifi, usb]), '', 'nothing to explain about a camera that can be reached');
    assert.match(D.explain({ address: '192.168.70.15', diagnosis: same, rtsp: { url: 'rtsp://192.168.70.15/1', needsLogin: false } }, [wifi, usb]), /^Reachable on Wi-Fi\.$/);
    assert.match(D.explain({ address: '192.168.70.15', diagnosis: same, rtsp: { url: 'x', needsLogin: true } }, [wifi, usb]), /user name and password/);
    assert.match(D.explain({ address: '192.168.70.15', diagnosis: same, rtsp: null }, [wifi, usb]), /no video address answered/);
});

test('ONVIF probe answers and RTSP status lines are read', () => {
    const xml = `<s:Envelope><s:Body><d:ProbeMatches><d:ProbeMatch><d:Types>dn:NetworkVideoTransmitter</d:Types>
        <d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/hardware/PTZ-20X onvif://www.onvif.org/name/Deck%20cam onvif://www.onvif.org/location/</d:Scopes>
        <d:XAddrs>http://[fe80::1]/onvif/device_service http://192.168.68.40:8080/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`;
    assert.deepEqual(D.parseProbeMatch(xml), { address: '192.168.68.40', name: 'Deck cam', model: 'PTZ-20X' });
    assert.equal(D.parseProbeMatch('<d:Probe/>'), null, 'someone else’s probe is not an answer');
    assert.equal(D.parseProbeMatch('<a:XAddrs>http://camera.local/onvif</a:XAddrs>'), null, 'no numeric address, nothing to add');
    assert.equal(D.rtspStatus('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n'), 200);
    assert.equal(D.rtspStatus('RTSP/1.0 401 Unauthorized\r\n'), 401);
    assert.equal(D.rtspStatus('HTTP/1.1 400 Bad Request\r\n'), 0);
});
test('silence is told from a shut door: hearing nothing at all, or being refused, is the system in the way', () => {
    const heard = (over = {}) => ({ sockets: 2, shared: 2, packets: 14, errors: [], ...over });
    assert.equal(D.blockedBy(heard(), 'darwin'), null, 'packets came in: nobody answered, that is all');
    assert.equal(D.blockedBy(heard({ packets: 1 }), 'darwin'), null, 'even only its own question echoed back means the network is open');
    const shut = D.blockedBy(heard({ packets: 0 }), 'darwin');
    assert.match(shut.what, /macOS is not letting Lanecast use the local network/); assert.match(shut.where, /Privacy & Security → Local Network/); assert.equal(shut.settings, true);
    assert.equal(D.blockedBy(heard({ errors: ['EHOSTUNREACH'] }), 'darwin').settings, true, 'refused when sending');
    assert.equal(D.blockedBy(heard({ shared: 0, packets: 0 }), 'darwin'), null, 'on private ports nothing echoes, so silence proves nothing');
    assert.equal(D.blockedBy(heard({ sockets: 0, shared: 0, packets: 0 }), 'darwin'), null, 'no adapter to listen on is another story');
    assert.match(D.blockedBy(heard({ packets: 0 }), 'win32').what, /Windows Firewall/);
    assert.match(D.blockedBy(heard({ packets: 0 }), 'linux').where, /5353/);
    assert.equal(D.blockedBy(null), null);
});
console.log(`${test.count()} discover test groups passed`);
