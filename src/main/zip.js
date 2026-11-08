/* A small ZIP writer and reader, enough for project files: deflated entries, UTF-8 names,
 * no encryption, no ZIP64 (projects are far under 4 GB). Nothing to install.
 */
'use strict';
const zlib = require('node:zlib');

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
// DOS date and time of now, for readers that show them.
function dosStamp(d = new Date()) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

/** Build a zip from [{ name, data: Buffer | string }]. Names use forward slashes. */
function write(entries) {
    const parts = [], central = [], { time, date } = dosStamp();
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8'), data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
        const deflated = zlib.deflateRawSync(data, { level: 6 });
        const stored = deflated.length >= data.length, body = stored ? data : deflated, method = stored ? 0 : 8, crc = crc32(data);
        const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(data.length), u16(name.length), u16(0), name]);
        central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
        parts.push(local, body); offset += local.length + body.length;
    }
    const dir = Buffer.concat(central);
    const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(dir.length), u32(offset), u16(0)]);
    return Buffer.concat([...parts, dir, end]);
}

/** Read a zip into [{ name, data: Buffer }]. Throws on anything it does not understand. */
function read(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip file');
    const count = buf.readUInt16LE(eocd + 10), dirOffset = buf.readUInt32LE(eocd + 16);
    const entries = [];
    let p = dirOffset;
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
        const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), rawSize = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        p += 46 + nameLen + extraLen + commentLen;
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Bad zip entry');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const body = buf.subarray(start, start + size);
        const data = method === 0 ? Buffer.from(body) : method === 8 ? zlib.inflateRawSync(body) : null;
        if (!data) throw new Error('Unsupported zip compression');
        if (data.length !== rawSize || crc32(data) !== crc) throw new Error(`Corrupt zip entry: ${name}`);
        if (name.endsWith('/')) continue;
        entries.push({ name, data });
    }
    return entries;
}

module.exports = { write, read, crc32 };
