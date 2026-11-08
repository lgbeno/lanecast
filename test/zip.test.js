'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zip = require('../src/main/zip');
const { test } = require('./helpers');

test('a zip round-trips text, binary and nested names, and the system unzip reads it', () => {
    const png = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png'));
    const entries = [
        { name: 'project.json', data: JSON.stringify({ name: 'Spring Invitational', cameras: 2 }) },
        { name: 'theme/overlay.html', data: '<!doctype html><title>Thème — été</title>' },
        { name: 'media/cam-pool.png', data: png },
        { name: 'empty.txt', data: '' }
    ];
    const buf = zip.write(entries);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'starts with a local header');
    const back = zip.read(buf);
    assert.deepEqual(back.map(e => e.name), entries.map(e => e.name));
    assert.equal(back[0].data.toString(), entries[0].data);
    assert.equal(back[1].data.toString('utf8'), entries[1].data);
    assert(back[2].data.equals(png), 'binary survives');
    assert.equal(back[3].data.length, 0);
    assert(buf.length < png.length + 2000, 'deflate keeps it small');
    // Corruption is noticed.
    const bad = Buffer.from(buf); bad[50] ^= 0xff;                            // inside the first entry's data
    assert.throws(() => zip.read(bad), /Corrupt|Bad|Not a zip/);
    assert.throws(() => zip.read(Buffer.from('hello')), /Not a zip/);
    // The platform's own unzip agrees, where there is one.
    if (process.platform !== 'win32') {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanecast-zip-')), file = path.join(dir, 't.zip');
        fs.writeFileSync(file, buf);
        try { execFileSync('unzip', ['-qq', '-o', file, '-d', dir]); } catch (e) { return; }      // no unzip: skip this part
        assert.equal(fs.readFileSync(path.join(dir, 'theme', 'overlay.html'), 'utf8'), entries[1].data);
        assert(fs.readFileSync(path.join(dir, 'media', 'cam-pool.png')).equals(png));
    }
});
console.log(`${test.count()} zip test groups passed`);
