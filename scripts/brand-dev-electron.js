/* In development the app runs inside the Electron binary, so macOS shows "Electron" in the menu
 * bar and Electron's icon in the Dock, whatever the app says about itself. This gives that
 * binary Lanecast's name and icon. The packaged app needs none of this. Run at install; harmless
 * elsewhere.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'darwin') process.exit(0);
const root = path.join(__dirname, '..');
const bundle = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents');
const plist = path.join(bundle, 'Info.plist'), icns = path.join(root, 'build', 'icon.icns');
if (!fs.existsSync(plist)) process.exit(0);
let text = fs.readFileSync(plist, 'utf8');
const set = (key, value) => { text = text.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${value}$2`); };
set('CFBundleName', 'Lanecast'); set('CFBundleDisplayName', 'Lanecast');
fs.writeFileSync(plist, text);
if (fs.existsSync(icns)) fs.copyFileSync(icns, path.join(bundle, 'Resources', 'electron.icns'));
// Nudge Launch Services and the Dock into noticing the bundle changed.
const now = new Date(); fs.utimesSync(path.join(bundle, '..'), now, now);
console.log('development Electron branded as Lanecast');
