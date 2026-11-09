/* Lanecast main process: one window, two serial ports, the overlay feed, the camera engine, and the files.
 *
 *   timer port  -> window (CTS.Decoder)                -> Packet.scoreboard() -> Relay -> overlays
 *   meet port   -> window (GENSER.StreamParser, RosterStore) -'
 *   cameras     -> go2rtc -> window (WebRTC)
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { SerialRoles } = require('./serial');
const { Relay } = require('./relay');
const { Store } = require('./store');
const { Themes } = require('./themes');
const { Projects, EXT: PROJECT_EXT } = require('./project');

const { CameraEngine, IMAGES, VIDEOS } = require('./cameras');
const PARTS = ['timer', 'events'];
let win = null, serial = null, relay = null, store = null, cameras = null, themes = null, projects = null;
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
    showProjectInTitle();
}
/** The title bar reads "Lanecast – <project>" once the project has a name. */
function showProjectInTitle() { if (!win || !projects) return; const info = projects.info(); win.setTitle(info.named ? `Lanecast – ${info.name}` : 'Lanecast'); }

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
    if (process.platform === 'darwin' && app.dock) app.dock.setIcon(path.join(path.dirname(ICON), 'icon-mac.png'));     // on Apple's icon grid, with its margin
    store = new Store(path.join(app.getPath('userData'), 'lanecast.json'));
    await store.load();
    const saved = store.get('simulate', {});
    for (const p of PARTS) simulated[p] = allSimulated || !!(saved && saved[p]);
    // The window may open this computer's cameras (webcams, an iPhone as a camera); nothing else asks for permissions.
    const { session } = require('electron');
    // ...and it may put text on the clipboard (the Copy button beside a network setting to enter); it never reads it.
    const allowed = new Set(['media', 'clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => allowed.has(permission));
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
    projects = new Projects({ store, cameras, themes, workDir: path.join(app.getPath('userData'), 'projects'), version: app.getVersion() });
    // A project opened last time keeps its theme copy available.
    const lastProject = store.get('projectPath', null);
    if (lastProject && !require('node:fs').existsSync(lastProject)) store.set('projectPath', null);                  // moved or deleted since: untitled again
    else if (lastProject && store.get('theme') === 'p-project') { try { await projects.open(lastProject); } catch (e) { store.set('projectPath', null); } }
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(e => {
    // Never fail silently with no window: say what went wrong, then leave.
    console.error(e); dialog.showErrorBox('Lanecast could not start', e.stack || String(e)); app.quit();
});
app.on('window-all-closed', () => app.quit());

// ---- projects: save, open, new, from the window or the File menu ------------------------
const filters = [{ name: 'Lanecast project', extensions: [PROJECT_EXT.slice(1)] }];
async function projectSaveAs() {
    const current = projects.info();
    const suggested = (current.named ? current.name : 'Meet').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Meet';
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Save the project', defaultPath: current.path || path.join(app.getPath('documents'), suggested + PROJECT_EXT), filters });
    if (canceled || !filePath) return current;
    return projectSaveTo(filePath);
}
async function projectSaveTo(file) { const info = await projects.save(file); showProjectInTitle(); send('project:changed', info); return info; }
async function projectRename(name) { const info = await projects.rename(name); showProjectInTitle(); send('project:changed', info); return info; }
async function projectSave() { const current = projects.info(); return current.path ? projectSaveTo(current.path) : projectSaveAs(); }
async function projectOpenDialog() {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Open a project', properties: ['openFile'], filters });
    if (canceled || !filePaths.length) return projects.info();
    return projectOpenPath(filePaths[0]);
}
/** Open a project file and start the window again from it. */
async function projectOpenPath(file) {
    const info = await projects.open(file);
    for (const part of PARTS) await setSimulated(part, !!info.simulate[part]);
    showProjectInTitle();
    if (win) win.webContents.reload();
    return info;
}
async function projectNew() {
    if (win) {
        const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: ['New project', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Start a new project?', detail: 'Cameras, start lists and theme settings are cleared. Save the current project first if you want to keep it.' });
        if (response !== 0) return projects.info();
    }
    const info = await projects.fresh();
    for (const part of PARTS) await setSimulated(part, false);
    showProjectInTitle();
    if (win) win.webContents.reload();
    return info;
}
function buildMenu() {
    const isMac = process.platform === 'darwin';
    return Menu.buildFromTemplate([
        ...(isMac ? [{ role: 'appMenu' }] : []),
        { label: 'File', submenu: [
            { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => projectNew().catch(e => dialog.showErrorBox('New project', e.message)) },
            { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => projectOpenDialog().catch(e => dialog.showErrorBox('Open project', e.message)) },
            { type: 'separator' },
            { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => projectSave().catch(e => dialog.showErrorBox('Save project', e.message)) },
            { label: 'Save Project As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => projectSaveAs().catch(e => dialog.showErrorBox('Save project', e.message)) },
            { type: 'separator' },
            isMac ? { role: 'close' } : { role: 'quit' }
        ] },
        { role: 'editMenu' },
        { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
        { role: 'windowMenu' }
    ]);
}
ipcMain.handle('project:info', () => projects.info());
ipcMain.handle('project:new', () => projectNew());
ipcMain.handle('project:open', () => projectOpenDialog());
ipcMain.handle('project:openPath', (event, file) => projectOpenPath(String(file)));
ipcMain.handle('project:save', () => projectSave());
ipcMain.handle('project:saveAs', () => projectSaveAs());
ipcMain.handle('project:saveTo', (event, file) => projectSaveTo(String(file)));
ipcMain.handle('project:rename', (event, name) => projectRename(String(name ?? '')));
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
// Cameras that announce themselves on any adapter, each with whether it can be reached and, if not, what to set.
ipcMain.handle('cameras:discover', () => require('./discover').discover());
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
