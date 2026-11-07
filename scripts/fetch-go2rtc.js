#!/usr/bin/env node
/* Fetches the go2rtc binary for this machine (or the platform named in argv) into
 * vendor/go2rtc/<os>-<arch>/, where the app and electron-builder look for it.
 * go2rtc is MIT licensed; see THIRD_PARTY_NOTICES.md.
 *
 *   node scripts/fetch-go2rtc.js            # this machine
 *   node scripts/fetch-go2rtc.js mac arm64  # a named target (os: mac | win | linux)
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const VERSION = 'v1.9.15';
const OS = { darwin: 'mac', win32: 'win', linux: 'linux' };
// Release asset per electron-builder os/arch name.
const ASSETS = {
    'mac-arm64': 'go2rtc_mac_arm64.zip', 'mac-x64': 'go2rtc_mac_amd64.zip',
    'win-x64': 'go2rtc_win64.zip', 'win-arm64': 'go2rtc_win_arm64.zip', 'win-ia32': 'go2rtc_win32.zip',
    'linux-x64': 'go2rtc_linux_amd64', 'linux-arm64': 'go2rtc_linux_arm64', 'linux-armv7l': 'go2rtc_linux_arm'
};

const os = process.argv[2] || OS[process.platform], arch = process.argv[3] || process.arch;
const key = `${os}-${arch}`, asset = ASSETS[key];
if (!asset) { console.error(`No go2rtc build for ${key}`); process.exit(1); }
const dir = path.join(__dirname, '..', 'vendor', 'go2rtc', key);
const binary = path.join(dir, os === 'win' ? 'go2rtc.exe' : 'go2rtc');
const stamp = path.join(dir, 'VERSION');
if (fs.existsSync(binary) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === VERSION) { console.log(`go2rtc ${VERSION} already in ${path.relative(process.cwd(), dir)}`); process.exit(0); }

function download(url, file) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'lanecast-build' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); download(res.headers.location, file).then(resolve, reject); return; }
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`${url}: HTTP ${res.statusCode}`)); return; }
            const out = fs.createWriteStream(file);
            res.pipe(out); out.on('finish', () => out.close(resolve)); out.on('error', reject);
        }).on('error', reject);
    });
}
function unzip(zip, into) {
    // Both platforms that ship zips have an unzipper to hand.
    if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${into}'`], { stdio: 'inherit' });
    else execFileSync('unzip', ['-o', '-q', zip, '-d', into], { stdio: 'inherit' });
}

(async () => {
    fs.mkdirSync(dir, { recursive: true });
    const url = `https://github.com/AlexxIT/go2rtc/releases/download/${VERSION}/${asset}`;
    console.log(`fetching ${url}`);
    const file = path.join(dir, asset);
    await download(url, file);
    if (asset.endsWith('.zip')) {
        unzip(file, dir); fs.unlinkSync(file);
        // The archives hold one file named after the asset; give it the plain name.
        for (const name of fs.readdirSync(dir)) if (/^go2rtc_/.test(name)) fs.renameSync(path.join(dir, name), binary);
    } else fs.renameSync(file, binary);
    if (os !== 'win') fs.chmodSync(binary, 0o755);
    fs.writeFileSync(stamp, VERSION + '\n');
    console.log(`go2rtc ${VERSION} → ${path.relative(process.cwd(), binary)}`);
})().catch(e => { console.error(e.message); process.exit(1); });
