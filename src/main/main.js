/* Lanecast main process: one window, two serial ports, the overlay feed, the camera engine, and the files.
 *
 *   timer port  -> window (CTS.Decoder)                -> Packet.scoreboard() -> Relay -> overlays
 *   meet port   -> window (GENSER.StreamParser, RosterStore) -'
 *   cameras     -> go2rtc -> window (WebRTC)
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SerialRoles } = require('./serial');
const { Relay } = require('./relay');
const { Store } = require('./store');
const { Themes } = require('./themes');

const { CameraEngine, IMAGES, VIDEOS } = require('./cameras');
const PARTS = ['timer', 'events'];
let win = null, serial = null, relay = null, store = null, cameras = null, themes = null;
// The timer and the meet data can be simulated on their own; cameras each carry their own switch.
const simulated = { timer: false, events: false };
// Nothing is simulated unless it was last time; LANECAST_SIMULATE=1 (the smoke test) turns everything on.
const allSimulated = process.env.LANECAST_SIMULATE === '1';
const send = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); };

// Themes are pages served from their own folders over theme://<id>/; see src/main/themes.js.
protocol.registerSchemesAsPrivileged([{ scheme: 'theme', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
app.setName('Lanecast');     // the app's own name in menus and dialogs, even when run from the Electron binary in development

function createWindow() {
    win = new BrowserWindow({
        width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#0b1119', title: 'Lanecast', icon: ICON,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
    });
    win.on('page-title-updated', e => e.preventDefault());
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.on('closed', () => { win = null; });
}

/** Simulate one part: the made-up console on a pretend port, or start lists from Load or Fetch. */
async function setSimulated(part, on) {
    if (!PARTS.includes(part)) throw new Error('Unknown part');
    simulated[part] = !!on;
    if (part === 'timer') await serial.setSimulated('timer', !!on);
    store.set('simulate', { ...simulated });
    send('sim:changed', simState());
}
const simState = () => ({ ...simulated, ...(serial ? serial.simState() : { event: null, heat: null, running: false, racing: false }) });
/** A photo or video for a simulated camera, chosen through the file dialog. */
async function chooseMedia(id) {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'A photo or video from the camera’s view', properties: ['openFile'],
        filters: [{ name: 'Photos and videos', extensions: [...IMAGES, ...VIDEOS] }, { name: 'Photos', extensions: IMAGES }, { name: 'Videos', extensions: VIDEOS }]
    });
    if (canceled || !filePaths.length) return cameras.describe(cameras.find(id));
    return cameras.setMedia(id, filePaths[0]);
}

app.whenReady().then(async () => {
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(ICON);
    store = new Store(path.join(app.getPath('userData'), 'lanecast.json'));
    await store.load();
    const saved = store.get('simulate', {});
    for (const p of PARTS) simulated[p] = allSimulated || !!(saved && saved[p]);
    // The window may open this computer's cameras (webcams, an iPhone as a camera); nothing else asks for permissions.
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'media'));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === 'media');
    themes = new Themes({ userDir: path.join(app.getPath('userData'), 'themes') });
    await themes.list();
    protocol.handle('theme', request => themes.serve(request));
    serial = new SerialRoles({ simulated: { timer: simulated.timer }, onData: (role, bytes) => send('serial:data', role, bytes), onState: (role, state) => send('serial:state', role, state) });
    relay = new Relay({ port: Number(store.get('relayPort', 8080)) || 8080, onStatus: status => send('relay:status', status) });
    relay.start();
    cameras = new CameraEngine({
        packaged: app.isPackaged, dataDir: app.getPath('userData'), cameras: store.get('cameras', []),
        onChange: list => store.set('cameras', list), onStatus: state => send('cameras:status', state)
    });
    cameras.start();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (serial) serial.closeAll(); if (relay) relay.stop(); if (cameras) cameras.stop(); if (store) store.flush(); });
// However the process ends, go2rtc must not outlive it.
process.on('exit', () => { if (cameras) cameras.stop(); });

// ---- what the window may ask for ---------------------------------------------------------
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
ipcMain.handle('serial:list', (event, role) => serial.list(role));
ipcMain.handle('serial:open', (event, role, portPath) => serial.open(role, portPath));
ipcMain.handle('serial:close', (event, role) => serial.close(role));
ipcMain.handle('serial:state', (event, role) => serial.state(role));
ipcMain.handle('sim:state', () => simState());
ipcMain.handle('sim:set', (event, part, on) => setSimulated(String(part), on));
ipcMain.handle('sim:control', (event, e, h) => { serial.simControl(Number(e), Number(h)); return simState(); });
ipcMain.handle('sim:race', (event, on) => { serial.simRace(!!on); return simState(); });
ipcMain.handle('sim:run', (event, on, e, h) => { serial.simRun(!!on, e === undefined || e === null ? undefined : Number(e), Number(h) || 1); return simState(); });
ipcMain.handle('sim:schedule', (event, meet) => { serial.simSchedule(meet); return simState(); });

ipcMain.handle('relay:status', () => relay.status());
ipcMain.on('relay:send', (event, text) => relay.broadcast(text));
ipcMain.handle('cameras:status', () => cameras.state());
// macOS asks the person once before a camera on this computer delivers pictures; elsewhere there is nothing to ask.
ipcMain.handle('cameras:access', async () => {
    if (process.platform !== 'darwin') return 'granted';
    const { systemPreferences } = require('electron');
    const status = systemPreferences.getMediaAccessStatus('camera');
    if (status === 'granted') return status;
    return (await systemPreferences.askForMediaAccess('camera')) ? 'granted' : systemPreferences.getMediaAccessStatus('camera');
});
ipcMain.handle('cameras:list', () => cameras.list());
ipcMain.handle('cameras:add', (event, camera) => cameras.add(camera || {}));
ipcMain.handle('cameras:update', (event, id, patch) => cameras.update(String(id), patch || {}));
ipcMain.handle('cameras:remove', (event, id) => cameras.remove(String(id)));
ipcMain.handle('cameras:chooseMedia', (event, id) => chooseMedia(String(id)));
ipcMain.handle('cameras:clearMedia', (event, id) => cameras.setMedia(String(id), null));
/** A simulated camera's stand-in, for the window to draw: { bytes, mime }. Only ever a file chosen through the dialog. */
ipcMain.handle('cameras:mediaBytes', (event, id) => cameras.mediaBytes(String(id)));
ipcMain.handle('themes:list', () => themes.list());
ipcMain.handle('themes:active', () => store.get('theme', 'b-classic'));
ipcMain.handle('themes:select', (event, id) => { if (!themes.get(String(id))) throw new Error('No such theme'); store.set('theme', String(id)); return String(id); });
ipcMain.handle('themes:create', (event, name) => themes.createFromTemplate(String(name || '')));
ipcMain.handle('themes:openFolder', async () => { await fs.mkdir(themes.userDir, { recursive: true }); return shell.openPath(themes.userDir); });
ipcMain.handle('themes:folder', () => themes.userDir);
ipcMain.handle('store:get', (event, key) => store.get(key));
ipcMain.handle('store:set', (event, key, value) => { store.set(key, value); });

const windows1252 = new TextDecoder('windows-1252');
const toWindows1252 = text => Buffer.from(Array.from(text, ch => { const code = ch.charCodeAt(0); return code < 256 ? code : 0x3f; }));

/** Meet Manager start-list files, chosen by the user: [{ name, text }]. Text is decoded as Meet Manager writes it. */
ipcMain.handle('files:loadStartLists', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Load start lists', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Meet Manager start lists', extensions: ['scb'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (canceled) return [];
    const files = [];
    for (const file of filePaths) {
        const name = path.basename(file);
        try {
            const stat = await fs.stat(file);
            if (stat.size > 5 * 1024 * 1024) throw new Error('larger than 5 MB');
            files.push({ name, text: windows1252.decode(await fs.readFile(file)) });
        } catch (e) { files.push({ name, error: e.message || String(e) }); }
    }
    return files;
});
/** Write start-list files into a folder the user picks: { folder, count }, or null if they cancel. */
ipcMain.handle('files:saveStartLists', async (event, files) => {
    if (!Array.isArray(files)) throw new Error('Nothing to save');
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Save start lists into…', properties: ['openDirectory', 'createDirectory'] });
    if (canceled || !filePaths.length) return null;
    let count = 0;
    for (const file of files) {
        if (!/^E\d{3}\.scb$/.test(file?.name) || typeof file.text !== 'string') continue;
        await fs.writeFile(path.join(filePaths[0], file.name), toWindows1252(file.text)); count++;
    }
    return { folder: path.basename(filePaths[0]), count };
});
