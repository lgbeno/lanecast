/* In development the app runs inside the Electron binary, so macOS shows "Electron" in the menu
 * bar and Electron's icon in the Dock, whatever the app says about itself. This gives that
 * binary Lanecast's name and icon. The packaged app needs none of this. Run at install; harmless
 * elsewhere.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') process.exit(0);
const root = path.join(__dirname, '..');
const bundle = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents');
const plist = path.join(bundle, 'Info.plist'), icns = path.join(root, 'build', 'icon.icns');
if (!fs.existsSync(plist)) process.exit(0);
let text = fs.readFileSync(plist, 'utf8');
const set = (key, value) => { text = text.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${value}$2`); };
set('CFBundleName', 'Lanecast'); set('CFBundleDisplayName', 'Lanecast');
// Without this key macOS shows an iPhone only once it has auto-connected (locked, set down in landscape); with it,
// the phone is listed whenever it is nearby, as in Photo Booth, and picking it connects. The packaged app gets it
// from package.json's extendInfo.
if (!text.includes('NSCameraUseContinuityCameraDeviceType')) text = text.replace('<key>NSCameraUsageDescription</key>', '<key>NSCameraUseContinuityCameraDeviceType</key>\n\t<true/>\n\t<key>NSCameraUsageDescription</key>');
// Searching for cameras means multicast on the local network, which macOS allows an app only after asking the person;
// with this description it asks (and lists the app under Privacy → Local Network). Without it the search hears nothing.
if (!text.includes('NSLocalNetworkUsageDescription')) text = text.replace('<key>NSCameraUsageDescription</key>', '<key>NSLocalNetworkUsageDescription</key>\n\t<string>Lanecast looks for cameras on your network, and sends the overlay feed to other devices on it.</string>\n\t<key>NSBonjourServices</key>\n\t<array>\n\t\t<string>_ndi._tcp</string>\n\t\t<string>_rtsp._tcp</string>\n\t</array>\n\t<key>NSCameraUsageDescription</key>');
fs.writeFileSync(plist, text);
if (fs.existsSync(icns)) fs.copyFileSync(icns, path.join(bundle, 'Resources', 'electron.icns'));
// The Dock's tooltip and Finder take the *localized* name, and with none macOS falls back to the folder name, "Electron".
for (const lproj of ['en.lproj', 'Base.lproj']) {
    const dir = path.join(bundle, 'Resources', lproj);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'InfoPlist.strings'), 'CFBundleDisplayName = "Lanecast";\nCFBundleName = "Lanecast";\n');
}
// Changing the bundle breaks its code signature, and macOS grants no camera (or other) access to an app whose
// signature does not verify: it will not even show the permission prompt. Sign it again, ad hoc, like Electron ships.
try { execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.resolve(bundle, '..')], { stdio: ['ignore', 'ignore', 'pipe'] }); }
catch (e) { console.warn('could not re-sign the development Electron; camera access may be refused:', String(e.stderr || e.message).trim().split('\n')[0]); }
// Make Launch Services (which the Dock and Finder ask) read the bundle again.
const now = new Date(); fs.utimesSync(path.join(bundle, '..'), now, now);
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
try { if (fs.existsSync(lsregister)) execFileSync(lsregister, ['-f', path.resolve(bundle, '..')], { stdio: 'ignore' }); } catch (e) { /* the next launch registers it anyway */ }
console.log('development Electron branded as Lanecast and re-signed');
