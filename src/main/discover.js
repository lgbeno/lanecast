/* Finding cameras on the network, and saying why one that is found cannot be reached.
 *
 * Cameras at a pool arrive with whatever address they were last given, on a cable into a USB adapter
 * that nothing hands an address to. They still announce themselves, because announcements are
 * multicast and cross that gap; ordinary traffic does not. So this listens for the announcements
 * (mDNS: NDI sources and RTSP services; ONVIF's WS-Discovery), works out which adapter each camera
 * is behind and whether this computer has an address in the camera's network, and when it has not,
 * says exactly what to set on which adapter. Where the camera can be reached it also finds the RTSP
 * address that plays. It never changes a network setting itself.
 *
 * Plain Node, no dependencies: the DNS packets are small enough to read and write here.
 */
'use strict';
const dgram = require('node:dgram');
const net = require('node:net');
const os = require('node:os');
const { execFile } = require('node:child_process');

// ---- DNS packets, as much as service discovery needs ---------------------------------
const TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 };
const labelsOf = name => String(name).replace(/\.$/, '').split('.');
const keyOf = labels => labels.join('.').toLowerCase();

function encodeName(labels) {
    const parts = [];
    for (const label of labels) { const b = Buffer.from(label, 'utf8'); if (!b.length || b.length > 63) throw new Error('bad DNS label'); parts.push(Buffer.from([b.length]), b); }
    parts.push(Buffer.from([0]));
    return Buffer.concat(parts);
}
/** A query for [{ labels, type }]. `unicast` asks for the answer straight back (for when port 5353 cannot be shared). */
function encodeQuery(questions, { unicast = false } = {}) {
    const header = Buffer.alloc(12); header.writeUInt16BE(questions.length, 4);
    const body = questions.map(q => { const tail = Buffer.alloc(4); tail.writeUInt16BE(q.type, 0); tail.writeUInt16BE(unicast ? 0x8001 : 0x0001, 2); return Buffer.concat([encodeName(q.labels), tail]); });
    return Buffer.concat([header, ...body]);
}
function readName(buf, offset) {
    const labels = []; let p = offset, next = -1, hops = 0;
    for (;;) {
        if (p >= buf.length) throw new Error('truncated name');
        const len = buf[p];
        if (len === 0) { p++; break; }
        if ((len & 0xc0) === 0xc0) {                                      // a pointer to a name earlier in the packet
            if (p + 1 >= buf.length || ++hops > 30) throw new Error('bad name pointer');
            if (next < 0) next = p + 2;
            p = ((len & 0x3f) << 8) | buf[p + 1]; continue;
        }
        if (len > 63 || p + 1 + len > buf.length) throw new Error('bad label');
        labels.push(buf.toString('utf8', p + 1, p + 1 + len)); p += 1 + len;
    }
    return { labels, next: next < 0 ? p : next };
}
/** A DNS packet's records: { response, answers: [{ labels, type, data }] }. Throws on a malformed one. */
function decodePacket(buf) {
    if (buf.length < 12) throw new Error('short packet');
    const response = !!(buf.readUInt16BE(2) & 0x8000), questions = buf.readUInt16BE(4);
    const count = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let p = 12;
    for (let i = 0; i < questions; i++) p = readName(buf, p).next + 4;
    const answers = [];
    for (let i = 0; i < count; i++) {
        const name = readName(buf, p); p = name.next;
        if (p + 10 > buf.length) throw new Error('truncated record');
        const type = buf.readUInt16BE(p), length = buf.readUInt16BE(p + 8), start = p + 10, end = start + length;
        if (end > buf.length) throw new Error('truncated record data');
        let data = null;
        if (type === TYPE.A && length === 4) data = [...buf.subarray(start, end)].join('.');
        else if (type === TYPE.PTR) data = readName(buf, start).labels;
        else if (type === TYPE.SRV && length >= 7) data = { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6).labels };
        else if (type === TYPE.TXT) { data = []; for (let q = start; q < end;) { const n = buf[q]; data.push(buf.toString('utf8', q + 1, Math.min(end, q + 1 + n))); q += 1 + n; } }
        if (data !== null) answers.push({ labels: name.labels, type, data });
        p = end;
    }
    return { response, answers };
}

/** What the announcements heard so far add up to. */
class Records {
    constructor(services) { this.services = services.map(labelsOf); this.instances = new Map(); this.srv = new Map(); this.txt = new Map(); this.a = new Map(); }
    add(answers, via) {
        for (const r of answers) {
            const key = keyOf(r.labels);
            if (r.type === TYPE.PTR && this.services.some(s => keyOf(s) === key)) {
                const k = keyOf(r.data), entry = this.instances.get(k) || { labels: r.data, service: key, via: new Set() };
                if (via) entry.via.add(via); this.instances.set(k, entry);
            }
            else if (r.type === TYPE.SRV) this.srv.set(key, r.data);
            else if (r.type === TYPE.TXT) this.txt.set(key, r.data);
            else if (r.type === TYPE.A) { const set = this.a.get(key) || new Set(); set.add(r.data); this.a.set(key, set); }
            // An answer about an instance or its host also tells which adapter it came in on.
            if (via && r.type !== TYPE.PTR) for (const entry of this.instances.values()) { const srv = this.srv.get(keyOf(entry.labels)); if (keyOf(entry.labels) === key || (srv && keyOf(srv.target) === key)) entry.via.add(via); }
        }
    }
    /** What still has to be asked before every instance has a host, a port and an address. */
    missing() {
        const ask = [];
        for (const entry of this.instances.values()) {
            const srv = this.srv.get(keyOf(entry.labels));
            if (!srv) ask.push({ labels: entry.labels, type: TYPE.SRV }, { labels: entry.labels, type: TYPE.TXT });
            else if (!this.a.has(keyOf(srv.target))) ask.push({ labels: srv.target, type: TYPE.A });
        }
        return ask;
    }
    list() {
        return [...this.instances.values()].map(entry => {
            const srv = this.srv.get(keyOf(entry.labels)) || null, host = srv ? srv.target.join('.') : '';
            return { service: entry.service, name: entry.labels[0], host, port: srv ? srv.port : 0, addresses: srv ? [...(this.a.get(keyOf(srv.target)) || [])] : [], txt: this.txt.get(keyOf(entry.labels)) || [], via: [...entry.via] };
        });
    }
}

// ---- this computer's adapters ----------------------------------------------------------
const SKIP = /^(lo|utun|awdl|llw|bridge|tun|tap|docker|veth|vmnet|vboxnet|anpi|ap\d|gif|stf|p2p)/i;
const toInt = ip => String(ip).split('.').reduce((n, o) => ((n << 8) | (Number(o) & 255)) >>> 0, 0);
const sameNetwork = (a, b, mask) => ((toInt(a) & toInt(mask)) >>> 0) === ((toInt(b) & toInt(mask)) >>> 0);
const selfAssigned = ip => /^169\.254\./.test(ip);

/** macOS names its adapters for people ("USB 10/100/1000 LAN") apart from the device ("en5"). */
function friendlyNames() {
    if (process.platform !== 'darwin') return Promise.resolve(new Map());
    return new Promise(resolve => execFile('networksetup', ['-listallhardwareports'], { timeout: 2500 }, (error, out) => {
        const names = new Map(); if (error) return resolve(names);
        for (const block of String(out).split(/\n\s*\n/)) { const port = /Hardware Port: (.+)/.exec(block), device = /Device: (\S+)/.exec(block); if (port && device) names.set(device[1], port[1].trim()); }
        resolve(names);
    }));
}
/** The adapters cameras could be behind: [{ name, label, address, netmask, selfAssigned }]. */
async function adapters(all = os.networkInterfaces()) {
    const names = await friendlyNames(), out = [];
    for (const [name, list] of Object.entries(all)) {
        if (SKIP.test(name)) continue;
        for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, label: names.get(name) || name, address: a.address, netmask: a.netmask, selfAssigned: selfAssigned(a.address) });
    }
    return out;
}

// ---- listening ---------------------------------------------------------------------------
const MDNS = '224.0.0.251', MDNS_PORT = 5353;
const SERVICES = ['_ndi._tcp.local', '_rtsp._tcp.local'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Ask every adapter who is out there, and gather the answers for `ms`. One socket an adapter, so an answer says where it came in. */
async function browse(list, { ms = 2600, services = SERVICES } = {}) {
    const records = new Records(services), sockets = [], notes = [];
    const question = () => services.map(s => ({ labels: labelsOf(s), type: TYPE.PTR }));
    await Promise.all(list.map(adapter => new Promise(resolve => {
        const open = shared => {
            const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            const entry = { socket, adapter, shared, heard: 0, errors: [] };
            socket.on('message', buf => { entry.heard++; try { const packet = decodePacket(buf); if (packet.response) records.add(packet.answers, adapter.name); } catch (e) { /* not ours to read */ } });
            socket.once('error', () => { try { socket.close(); } catch (e) { /* closed */ } if (shared) open(false); else { notes.push(`could not listen on ${adapter.label}`); resolve(); } });
            socket.bind(shared ? MDNS_PORT : 0, shared ? undefined : adapter.address, () => {
                try {
                    if (shared) socket.addMembership(MDNS, adapter.address);
                    socket.setMulticastInterface(adapter.address); socket.setMulticastTTL(255);
                    sockets.push(entry); resolve();
                } catch (e) { try { socket.close(); } catch (x) { /* closed */ } if (shared) open(false); else { notes.push(`could not listen on ${adapter.label}`); resolve(); } }
            });
        };
        open(true);                                                // the mDNS port, shared with the system's own responder; else a private port
    })));
    const send = questions => { if (questions.length) for (const entry of sockets) entry.socket.send(encodeQuery(questions, { unicast: !entry.shared }), MDNS_PORT, MDNS, error => { if (error) entry.errors.push(error.code || error.message); }); };
    send(question());
    const rounds = [0.25, 0.55, 0.8];
    let spent = 0;
    for (const share of rounds) { const until = ms * share; await wait(until - spent); spent = until; send(share < 0.3 ? question() : records.missing()); }
    await wait(ms - spent);
    for (const { socket } of sockets) try { socket.close(); } catch (e) { /* closed */ }
    // How the listening went, for telling "no camera out there" from "the system let nothing through".
    const heard = { sockets: sockets.length, shared: sockets.filter(s => s.shared).length, packets: sockets.reduce((n, s) => n + s.heard, 0), errors: [...new Set(sockets.flatMap(s => s.errors))] };
    return { found: records.list(), notes, heard };
}
/** Was the search shut out by the system rather than met with silence? On a shared mDNS socket this computer hears at least
 *  its own question come back, and its own responder; hearing nothing at all, or being refused when sending, means a privacy
 *  switch or a firewall is in the way. Returns what to tell the person, or null. */
function blockedBy(heard, platform = process.platform) {
    if (!heard || !heard.sockets) return null;
    const refused = heard.errors.some(e => /EHOSTUNREACH|EPERM|EACCES/.test(e));
    if (!refused && !(heard.shared > 0 && heard.packets === 0)) return null;
    return platform === 'darwin' ? { what: 'macOS is not letting Lanecast use the local network, so it cannot hear cameras announce themselves.', where: 'System Settings → Privacy & Security → Local Network, and turn on Lanecast (it may be listed as Electron)', settings: true }
        : platform === 'win32' ? { what: 'Windows Firewall may be keeping Lanecast from hearing cameras announce themselves.', where: 'Windows Security → Firewall & network protection → Allow an app through firewall → Lanecast, on Private networks', settings: false }
        : { what: 'A firewall may be keeping Lanecast from hearing cameras announce themselves.', where: 'allow incoming UDP port 5353 (mDNS) for Lanecast', settings: false };
}

// ONVIF cameras answer a WS-Discovery probe, NDI or not.
const WSD = '239.255.255.250', WSD_PORT = 3702;
const probeXml = id => `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${id}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;
/** The address and name in a WS-Discovery answer, or null. */
function parseProbeMatch(xml) {
    const text = String(xml), addrs = /<[^>]*XAddrs[^>]*>([^<]+)</.exec(text);
    if (!addrs) return null;
    const url = addrs[1].trim().split(/\s+/).find(u => /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(u));
    if (!url) return null;
    const address = /^https?:\/\/(\d+\.\d+\.\d+\.\d+)/.exec(url)[1], scopes = (/<[^>]*Scopes[^>]*>([^<]+)</.exec(text) || [, ''])[1];
    const scope = what => { const m = new RegExp(`onvif://www\\.onvif\\.org/${what}/([^\\s]+)`).exec(scopes); try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; } };
    return { address, name: scope('name') || scope('hardware') || 'ONVIF camera', model: scope('hardware') };
}
async function probeOnvif(list, { ms = 2600 } = {}) {
    const found = new Map(), sockets = [];
    await Promise.all(list.map(adapter => new Promise(resolve => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('message', buf => { const match = parseProbeMatch(buf.toString('utf8')); if (!match) return; const entry = found.get(match.address) || { ...match, via: new Set() }; entry.via.add(adapter.name); found.set(match.address, entry); });
        socket.once('error', () => { try { socket.close(); } catch (e) { /* closed */ } resolve(); });
        socket.bind(0, adapter.address, () => {
            try { socket.setMulticastInterface(adapter.address); socket.setMulticastTTL(4); sockets.push(socket); const id = require('node:crypto').randomUUID(); socket.send(probeXml(id), WSD_PORT, WSD, () => {}); setTimeout(() => { try { socket.send(probeXml(id), WSD_PORT, WSD, () => {}); } catch (e) { /* closed */ } }, 400); }
            catch (e) { try { socket.close(); } catch (x) { /* closed */ } }
            resolve();
        });
    })));
    await wait(ms);
    for (const socket of sockets) try { socket.close(); } catch (e) { /* closed */ }
    return [...found.values()].map(f => ({ ...f, via: [...f.via] }));
}

// ---- can it be reached, and if not, what to set ----------------------------------------
/** Where a camera at `address` stands to this computer's adapters.
 *  { reach: 'same-network', adapter } or { reach: 'other-network', adapter, fix: { address, netmask, command, where } }.
 *  `via` are the adapters its announcement came in on, when known. */
function diagnose(address, list, via = [], platform = process.platform) {
    const on = list.find(a => sameNetwork(a.address, address, a.netmask));
    if (on) return { reach: 'same-network', adapter: on };
    const heard = list.filter(a => via.includes(a.name));
    // The adapter to set: the one that heard it, if only one did; else one that nothing gives an address to (a cable straight to the camera).
    const adapter = (heard.length === 1 && heard[0]) || heard.find(a => a.selfAssigned) || list.find(a => a.selfAssigned) || heard[0] || null;
    const parts = address.split('.'), suggested = [parts[0], parts[1], parts[2], parts[3] === '10' ? '11' : '10'].join('.'), netmask = '255.255.255.0';
    const name = adapter ? adapter.label : 'the adapter the camera is plugged into';
    const fix = {
        address: suggested, netmask,
        command: !adapter ? '' : platform === 'darwin' ? `networksetup -setmanual "${adapter.label}" ${suggested} ${netmask}`
            : platform === 'win32' ? `netsh interface ipv4 set address name="${adapter.name}" static ${suggested} ${netmask}`
            : `sudo ip addr add ${suggested}/24 dev ${adapter.name}`,
        where: platform === 'darwin' ? `System Settings → Network → ${name} → Details… → TCP/IP → Configure IPv4: Manually`
            : platform === 'win32' ? `Settings → Network & internet → ${name} → IP assignment → Edit → Manual → IPv4`
            : `your network settings for ${name}: IPv4, Manual`
    };
    return { reach: 'other-network', adapter, fix };
}
/** The diagnosis in a sentence or two, for the person at the pool. */
function explain(camera, list) {
    const d = camera.diagnosis;
    if (d.reach === 'same-network') return camera.rtsp ? (camera.rtsp.needsLogin ? `Reachable on ${d.adapter.label}; it asks for a user name and password.` : `Reachable on ${d.adapter.label}.`)
        : `On the same network as ${d.adapter.label}, but no video address answered. RTSP may be switched off in the camera, or on an unusual port.`;
    const nets = list.map(a => `${a.label} is ${a.address}${a.selfAssigned ? ' (self-assigned: plugged in, but nothing gives it an address)' : ''}`).join('; ');
    const net = camera.address.split('.').slice(0, 3).join('.');
    return `The camera is at ${camera.address}, and this computer has no address in ${net}.x: ${nets || 'no adapter is connected'}. `
        + `Set ${d.adapter ? d.adapter.label : 'the adapter it is plugged into'} to ${d.fix.address}, subnet mask ${d.fix.netmask}, router empty, then search again.`;
}

// ---- which RTSP address plays -----------------------------------------------------------
const RTSP_PATHS = ['/1', '/2', '/live', '/stream1', '/h264', '/main', '/11', '/live/ch0', '/Streaming/Channels/101', '/cam/realmonitor?channel=1&subtype=0'];
/** The status line of an RTSP reply (`RTSP/1.0 200 OK` gives 200), or 0. */
const rtspStatus = text => { const m = /^RTSP\/1\.\d (\d{3})/.exec(String(text)); return m ? Number(m[1]) : 0; };
function rtspRequest(host, port, method, url, ms = 1200) {
    return new Promise(resolve => {
        let text = '', done = false;
        const finish = value => { if (done) return; done = true; socket.destroy(); resolve(value); };
        const socket = net.connect({ host, port, timeout: ms });
        socket.on('connect', () => socket.write(`${method} ${url} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: Lanecast\r\nAccept: application/sdp\r\n\r\n`));
        socket.on('data', chunk => { text += chunk.toString('latin1'); if (text.includes('\r\n\r\n') || text.length > 4096) finish(rtspStatus(text)); });
        socket.on('timeout', () => finish(0)); socket.on('error', () => finish(0)); socket.on('close', () => finish(rtspStatus(text)));
    });
}
/** The RTSP address a camera plays at: { url, needsLogin } or null when it does not answer RTSP. */
async function findRtsp(address, port = 554) {
    if (!await rtspRequest(address, port, 'OPTIONS', `rtsp://${address}:${port}/`)) return null;
    let login = null;
    for (const path of RTSP_PATHS) {
        const url = `rtsp://${address}${port === 554 ? '' : ':' + port}${path}`, status = await rtspRequest(address, port, 'DESCRIBE', url);
        if (status === 200) return { url, needsLogin: false };
        if (status === 401 && !login) login = { url, needsLogin: true };
    }
    return login;
}

// ---- the whole search ----------------------------------------------------------------------
/** Merge what mDNS and ONVIF heard into one entry a camera, by address (or by name while it has none). */
function merge(mdns, onvif) {
    const cameras = new Map();
    const entry = (key, name) => { if (!cameras.has(key)) cameras.set(key, { name, address: '', host: '', kinds: [], via: [], ndi: '', rtspPort: 0 }); return cameras.get(key); };
    for (const s of mdns) {
        const address = s.addresses[0] || '', c = entry(address || s.host || s.name, s.name);
        c.address ||= address; c.host ||= s.host;
        if (s.service.startsWith('_ndi.')) { if (!c.kinds.includes('NDI')) c.kinds.push('NDI'); c.ndi ||= s.name; c.name = s.name.replace(/\s*\(.*\)\s*$/, '') || s.name; }
        else { if (!c.kinds.includes('RTSP')) c.kinds.push('RTSP'); c.rtspPort ||= s.port; }
        for (const v of s.via) if (!c.via.includes(v)) c.via.push(v);
    }
    for (const o of onvif) {
        const c = entry(o.address, o.name); c.address ||= o.address;
        if (!c.kinds.includes('ONVIF')) c.kinds.push('ONVIF');
        for (const v of o.via) if (!c.via.includes(v)) c.via.push(v);
    }
    return [...cameras.values()];
}
/** Search the network. { cameras: [{ name, address, host, kinds, ndi, diagnosis, rtsp, explanation }], adapters, notes }. */
async function discover({ ms = 2600 } = {}) {
    const list = await adapters();
    if (!list.length) return { cameras: [], adapters: [], notes: ['This computer has no network adapter connected.'] };
    const [mdns, onvif] = await Promise.all([browse(list, { ms }), probeOnvif(list, { ms })]);
    const cameras = merge(mdns.found, onvif);
    await Promise.all(cameras.map(async camera => {
        if (!camera.address) { camera.diagnosis = { reach: 'no-address', adapter: null }; camera.rtsp = null; camera.explanation = 'It announced itself but gave no address. Search again in a moment.'; return; }
        camera.diagnosis = diagnose(camera.address, list, camera.via);
        camera.rtsp = camera.diagnosis.reach === 'same-network' ? await findRtsp(camera.address, camera.rtspPort || 554) : null;
        camera.explanation = explain(camera, list);
    }));
    cameras.sort((a, b) => a.name.localeCompare(b.name));
    return { cameras, adapters: list, notes: mdns.notes, blocked: cameras.length ? null : blockedBy(mdns.heard), heard: mdns.heard };
}

module.exports = { discover, diagnose, explain, merge, adapters, blockedBy, decodePacket, encodeQuery, encodeName, Records, parseProbeMatch, rtspStatus, sameNetwork, TYPE, labelsOf };
