/* Draws the app icon: build/icon.png (1024 px, transparent corners) and, on macOS, build/icon.icns.
 * The mark is simple geometry (see assets/logo.svg), so it is rasterised here in plain Node with
 * supersampled coverage, no browser or image library involved.
 *
 *   node scripts/make-icons.js
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const SIZE = 1024, S = SIZE / 512, SS = 4;                    // the SVG is drawn on a 512 grid; 4x4 samples a pixel
const BG = [0x0b, 0x11, 0x19], MINT = [0x74, 0xe5, 0xc1], GREEN = [0x4a, 0xde, 0x80];
// Shapes in SVG units, in drawing order: [coverage function, colour, alpha]
const roundedRect = (x, y, w, h, r) => (px, py) => {
    const cx = Math.max(x + r, Math.min(px, x + w - r)), cy = Math.max(y + r, Math.min(py, y + h - r));
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r && px >= x && px <= x + w && py >= y && py <= y + h;
};
const disc = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
const capsule = (x1, x2, y, r) => (px, py) => { const cx = Math.max(x1, Math.min(px, x2)); return (px - cx) ** 2 + (py - y) ** 2 <= r * r; };
const rope = y => { const dots = []; for (let x = 118; x <= 394.1; x += 55.2) dots.push(disc(x, y, 15)); return (px, py) => dots.some(d => d(px, py)); };
const shapes = [
    [roundedRect(0, 0, 512, 512, 116), BG, 1],
    [rope(170), MINT, 0.55], [rope(342), MINT, 0.55],
    [capsule(118, 310, 256, 15), MINT, 1],
    [disc(382, 256, 30), GREEN, 1]
];

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;                          // premultiplied accumulation over the subsamples
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = (x + (sx + 0.5) / SS) / S, py = (y + (sy + 0.5) / SS) / S;
        let cr = 0, cg = 0, cb = 0, ca = 0;
        for (const [inside, colour, alpha] of shapes) if (inside(px, py)) { cr = cr * (1 - alpha) + colour[0] * alpha; cg = cg * (1 - alpha) + colour[1] * alpha; cb = cb * (1 - alpha) + colour[2] * alpha; ca = ca + alpha * (1 - ca); }
        r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
    }
    const i = (y * SIZE + x) * 4, n = SS * SS;
    if (a > 0) { pixels[i] = Math.round(r / a); pixels[i + 1] = Math.round(g / a); pixels[i + 2] = Math.round(b / a); }
    pixels[i + 3] = Math.round(255 * a / n);
}
// PNG: one filter byte (0) per row, deflated, with CRCs.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) { raw[y * (SIZE * 4 + 1)] = 0; pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, 'icon.png');
fs.writeFileSync(file, png);
console.log('build/icon.png', SIZE + 'x' + SIZE, png.length + ' bytes');
if (process.platform === 'darwin') {
    // An .icns from the standard icon set, with sips and iconutil, which every Mac has.
    const set = fs.mkdtempSync(path.join(os.tmpdir(), 'lanecast-icon-')) + '/icon.iconset';
    fs.mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) {
        execFileSync('sips', ['-z', String(size), String(size), file, '--out', path.join(set, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
        execFileSync('sips', ['-z', String(size * 2), String(size * 2), file, '--out', path.join(set, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(out, 'icon.icns')]);
    console.log('build/icon.icns');
}
