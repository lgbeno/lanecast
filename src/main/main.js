/* Lanecast main process: one window, two serial ports, the overlay feed, the camera engine, and the files.
 *
 *   timer port  -> window (CTS.Decoder)                -> Packet.scoreboard() -> Relay -> overlays
 *   meet port   -> window (GENSER.StreamParser, RosterStore) -'
 *   cameras     -> go2rtc -> window (WebRTC)
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SerialRoles } = require('./serial');
const { Relay } = require('./relay');
const { Store } = require('./store');
const { CameraEngine } = require('./cameras');

const PATTERN = { id: 'cam-pattern', name: 'Test pattern', url: 'ffmpeg:virtual?video=testsrc&size=1280x720#video=h264' };
let win = null, serial = null, relay = null, store = null, cameras = null;
let simulated = process.argv.includes('--simulate') || process.env.LANECAST_SIMULATE === '1';
const send = (channel, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); };

function createWindow() {
    win = new BrowserWindow({
        width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#0b1119', title: 'Lanecast',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.on('closed', () => { win = null; });
}

/** Simulation is a switch: the made-up meet's ports instead of real ones, and a test-pattern camera when ffmpeg can draw one. */
async function setSimulated(on) {
    on = !!on;
    if (on !== simulated) { simulated = on; store.set('simulate', on); await serial.setSimulated(on); }
    if (on && cameras.ffmpeg) await cameras.put(PATTERN); else await cameras.remove(PATTERN.id);
    send('sim:changed', simState());
}
const simState = () => ({ on: simulated, ffmpeg: !!cameras?.ffmpeg, ...(serial?.simState() || { event: null, heat: null, racing: false }) });

app.whenReady().then(async () => {
    store = new Store(path.join(app.getPath('userData'), 'lanecast.json'));
    await store.load();
    if (!process.argv.includes('--simulate') && !process.env.LANECAST_SIMULATE) simulated = !!store.get('simulate', false);
    serial = new SerialRoles({ simulated, onData: (role, bytes) => send('serial:data', role, bytes), onState: (role, state) => send('serial:state', role, state) });
    relay = new Relay({ port: Number(store.get('relayPort', 8080)) || 8080, onStatus: status => send('relay:status', status) });
    relay.start();
    cameras = new CameraEngine({
        packaged: app.isPackaged, dataDir: app.getPath('userData'), cameras: store.get('cameras', []),
        onChange: list => store.set('cameras', list), onStatus: state => send('cameras:status', state)
    });
    await setSimulated(simulated);
    cameras.start();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (serial) serial.closeAll(); if (relay) relay.stop(); if (cameras) cameras.stop(); if (store) store.flush(); });
// However the process ends, go2rtc must not outlive it.
process.on('exit', () => { if (cameras) cameras.stop(); });

// ---- what the window may ask for ---------------------------------------------------------
ipcMain.handle('app:info', () => ({ version: app.getVersion(), simulated, platform: process.platform }));
ipcMain.handle('serial:list', () => serial.list());
ipcMain.handle('serial:open', (event, role, portPath) => serial.open(role, portPath));
ipcMain.handle('serial:close', (event, role) => serial.close(role));
ipcMain.handle('serial:state', (event, role) => serial.state(role));
ipcMain.handle('sim:state', () => simState());
ipcMain.handle('sim:set', (event, on) => setSimulated(on));
ipcMain.handle('sim:control', (event, e, h) => { serial.simControl(Number(e), Number(h)); return simState(); });
ipcMain.handle('sim:race', (event, on) => { serial.simRace(!!on); return simState(); });
ipcMain.handle('relay:status', () => relay.status());
ipcMain.on('relay:send', (event, text) => relay.broadcast(text));
ipcMain.handle('cameras:status', () => cameras.state());
ipcMain.handle('cameras:list', () => cameras.list());
ipcMain.handle('cameras:add', (event, camera) => cameras.add(camera || {}));
ipcMain.handle('cameras:remove', (event, id) => cameras.remove(String(id)));
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
