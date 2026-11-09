/* Cameras: the list the user keeps, and a go2rtc process the app runs beside itself for the
 * network ones. Each camera has a name, a source (an RTSP address, a device on this computer as
 * device:<id>, or nothing), a simulate switch, and a stand-in photo or video shown while
 * simulated. go2rtc takes each network camera's stream and hands it to the window over WebRTC;
 * device cameras are opened by the window itself; simulated ones are drawn by the window from
 * the stand-in. go2rtc is told the list at start and on change.
 */
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { allocatePreset, cleanPositions } = require('./ptz');

const OS = { darwin: 'mac', win32: 'win', linux: 'linux' };
const RETRY_MS = 3000, START_TIMEOUT_MS = 6000;
const IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp'], VIDEOS = ['mp4', 'm4v', 'mov', 'webm'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const MEDIA_LIMIT = 500 * 1024 * 1024;

/** Where this build keeps go2rtc: beside the app's resources when packaged, in vendor/ in development. */
function findBinary(packaged) {
    const name = process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc';
    const file = packaged ? path.join(process.resourcesPath, 'go2rtc', name)
        : path.join(__dirname, '..', '..', 'vendor', 'go2rtc', `${OS[process.platform]}-${process.arch}`, name);
    return fs.existsSync(file) ? file : null;
}
/** ffmpeg on the PATH, if any: go2rtc uses it for cameras that need transcoding. */
function findFfmpeg() {
    try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim() || null; }
    catch (e) { return null; }
}
const yamlString = s => JSON.stringify(String(s));
/** A camera attached to this computer (a webcam, an iPhone as a camera): the window opens it itself, by device id. */
const isDevice = c => /^device:/.test(c.url);
/** A camera go2rtc should carry: a network source. */
const isNetwork = c => !!c.url && !isDevice(c);
const validUrl = url => /^[a-z][a-z0-9+.-]*:/i.test(url);

class CameraEngine {
    /** `cameras` is the saved list; `onChange(cameras)` is called to persist it, `onStatus(state)` on engine changes. */
    constructor({ packaged = false, dataDir, port = 1984, webrtcPort = 8555, rtspPort = 8554, cameras = [], onChange = () => {}, onStatus = () => {} }) {
        this.binary = findBinary(packaged); this.ffmpeg = findFfmpeg();
        this.config = path.join(dataDir, 'go2rtc.yaml');
        this.port = port; this.webrtcPort = webrtcPort; this.rtspPort = rtspPort; this.api = `http://127.0.0.1:${port}`;
        this.cameras = cameras.filter(c => c && typeof c.id === 'string').map(c => ({
            id: c.id, name: String(c.name || ''), url: typeof c.url === 'string' ? c.url : '', simulate: !!c.simulate, deviceLabel: String(c.deviceLabel || ''), positions: cleanPositions(c.positions),
            media: c.media && typeof c.media.path === 'string' ? this._media(c.media.path) : null
        }));
        this.onChange = onChange; this.onStatus = onStatus;
        this.process = null; this.running = false; this.stopping = false; this.error = this.binary ? '' : 'go2rtc is not in this build'; this.version = ''; this.log = []; this.retry = null;
    }
    state() { return { running: this.running, error: this.error, api: this.api, version: this.version, installed: !!this.binary, ffmpeg: !!this.ffmpeg, log: this.log.slice(-5) }; }
    _changed() { this.onStatus(this.state()); }
    _save() { this.onChange(this.cameras.map(c => ({ id: c.id, name: c.name, url: c.url, simulate: c.simulate, deviceLabel: c.deviceLabel || '', positions: c.positions || [], media: c.media ? { path: c.media.path } : null }))); }
    _media(file) {
        const ext = path.extname(file).slice(1).toLowerCase();
        const kind = IMAGES.includes(ext) ? 'image' : VIDEOS.includes(ext) ? 'video' : null;
        return kind && fs.existsSync(file) ? { path: file, name: path.basename(file), kind, mime: MIME[ext], version: Date.now() } : null;
    }
    writeConfig() {
        const lines = ['# Written by Lanecast at each start; edits here are overwritten.',
            'api:', `  listen: ${yamlString('127.0.0.1:' + this.port)}`,
            // go2rtc hands ffmpeg's output to itself over its RTSP server, so that stays on, on loopback only.
            'rtsp:', `  listen: ${yamlString('127.0.0.1:' + this.rtspPort)}`,
            'webrtc:', `  listen: ${yamlString(':' + this.webrtcPort)}`, '  ice_servers: []',
            'log:', '  level: "warn"', 'streams:'];
        for (const c of this.cameras) if (isNetwork(c)) lines.push(`  ${yamlString(c.id)}: ${yamlString(c.url)}`);
        fs.mkdirSync(path.dirname(this.config), { recursive: true });
        fs.writeFileSync(this.config, lines.join('\n') + '\n');
    }
    async start() {
        if (!this.binary || this.process || this.stopping) { this._changed(); return; }
        this.writeConfig();
        const child = spawn(this.binary, ['-config', this.config], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        this.process = child; this.error = '';
        const note = chunk => { for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) { this.log.push(line.trim()); if (this.log.length > 40) this.log.shift(); } };
        child.stdout.on('data', note); child.stderr.on('data', note);
        child.on('error', e => { this.error = `Could not start go2rtc: ${e.message}`; this._changed(); });
        child.on('exit', (code, signal) => {
            if (this.process !== child) return;
            this.process = null; this.running = false;
            if (this.stopping) { this._changed(); return; }
            this.error = `go2rtc stopped (${signal || 'exit code ' + code})` + (this.log.length ? ` · ${this.log.at(-1)}` : '');
            this._changed();
            clearTimeout(this.retry); this.retry = setTimeout(() => this.start(), RETRY_MS);
        });
        // Ready when the API answers.
        const until = Date.now() + START_TIMEOUT_MS;
        while (Date.now() < until && this.process === child) {
            try {
                const res = await fetch(this.api + '/api');
                if (res.ok) { const info = await res.json(); this.version = info.version || ''; this.running = true; this._changed(); return; }
            } catch (e) { /* not up yet */ }
            await new Promise(r => setTimeout(r, 150));
        }
        if (this.process === child && !this.running) { this.error = 'go2rtc did not answer' + (this.log.length ? ` · ${this.log.at(-1)}` : ''); this._changed(); }
    }
    stop() {
        this.stopping = true; clearTimeout(this.retry);
        if (this.process) { this.process.kill(); this.process = null; }
        this.running = false;
    }
    async _tell(method, c) {
        if (!this.running || !isNetwork(c)) return;
        try {
            if (method === 'PUT') await fetch(`${this.api}/api/streams?name=${encodeURIComponent(c.id)}&src=${encodeURIComponent(c.url)}`, { method: 'PUT' });   // may answer 400 and still add it
            else await fetch(`${this.api}/api/streams?src=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
        } catch (e) { /* listed at next start */ }
    }
    describe(c) { return { id: c.id, name: c.name, url: c.url, simulate: c.simulate, local: isDevice(c), deviceLabel: c.deviceLabel || '', positions: (c.positions || []).map(p => p.name), media: c.media ? { name: c.media.name, kind: c.media.kind, version: c.media.version } : null }; }
    /** Cameras with what go2rtc knows about each: whether a source is connected and how many viewers it has. */
    async list() {
        let streams = {};
        if (this.running) { try { streams = await (await fetch(this.api + '/api/streams')).json(); } catch (e) { /* engine busy or gone */ } }
        return this.cameras.map(c => { const s = streams[c.id] || {}; return { ...this.describe(c), producers: (s.producers || []).length, consumers: (s.consumers || []).length }; });
    }
    find(id) { const c = this.cameras.find(x => x.id === id); if (!c) throw new Error('No such camera'); return c; }
    /** A new camera: a network address, a device on this computer, or nothing yet (simulated only). */
    async add({ name, url, simulate, deviceLabel }) {
        name = String(name || '').trim(); url = String(url || '').trim();
        if (url && !validUrl(url)) throw new Error('The address should start with rtsp:// (or another scheme go2rtc understands)');
        if (!url && !simulate) throw new Error('Enter the camera’s address, or add it as simulated');
        if (url && this.cameras.some(c => c.url === url)) throw new Error('That camera is already in the list');
        const id = 'cam-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const camera = { id, name: name || `Camera ${this.cameras.length + 1}`, url, simulate: !!simulate, deviceLabel: isDevice({ url }) ? String(deviceLabel || name || '') : '', positions: [], media: null };
        this.cameras.push(camera); this._save(); this.writeConfig();
        await this._tell('PUT', camera);
        if (this.running && isNetwork(camera)) {
            const streams = await (await fetch(this.api + '/api/streams')).json().catch(() => ({}));
            if (!streams[id]) throw new Error('go2rtc did not accept that address');
        }
        return this.describe(camera);
    }
    /** Change a camera's name, address or simulate switch. */
    async update(id, patch = {}) {
        const c = this.find(id), before = { ...c };
        if (patch.name !== undefined) c.name = String(patch.name).trim() || c.name;
        if (patch.url !== undefined) {
            const url = String(patch.url).trim();
            if (url && !validUrl(url)) throw new Error('The address should start with rtsp:// (or another scheme go2rtc understands)');
            if (url && this.cameras.some(x => x !== c && x.url === url)) throw new Error('Another camera already has that address');
            c.url = url;
        }
        if (patch.simulate !== undefined) c.simulate = !!patch.simulate;
        if (patch.deviceLabel !== undefined) c.deviceLabel = String(patch.deviceLabel);
        if (!c.url && !c.simulate) c.simulate = true;                      // nothing to show otherwise
        this._save(); this.writeConfig();
        if (before.url !== c.url) { await this._tell('DELETE', before); await this._tell('PUT', c); }
        return this.describe(c);
    }
    // Named positions of a camera that can be steered. The name is the person's; the camera's preset number behind it is
    // chosen here and travels with the camera's record (and so with the project).
    _position(c, name) { const key = String(name || '').trim().toLowerCase(); return (c.positions || []).find(p => p.name.toLowerCase() === key) || null; }
    /** Remember a position under `name`: a new one, or an existing name to be pointed somewhere else. Returns the preset number to store it in. */
    savePosition(id, name) {
        const c = this.find(id); name = String(name || '').trim().slice(0, 40);
        if (!name) throw new Error('Give the position a name');
        c.positions ||= [];
        let position = this._position(c, name);
        if (!position) {
            const preset = allocatePreset(c.positions);
            if (preset === null) throw new Error('This camera has as many positions as it can hold; remove one first');
            position = { name, preset }; c.positions.push(position);
        }
        this._save();
        return position.preset;
    }
    /** The preset number behind a position's name, or null when the camera has no position of that name. */
    positionPreset(id, name) { const p = this._position(this.find(id), name); return p ? p.preset : null; }
    removePosition(id, name) { const c = this.find(id), p = this._position(c, name); if (!p) return false; c.positions = c.positions.filter(x => x !== p); this._save(); return true; }
    /** The stand-in picture for a simulated camera: a photo or video file, or none. */
    async setMedia(id, file) {
        const c = this.find(id);
        if (!file) c.media = null;
        else {
            const ext = path.extname(file).slice(1).toLowerCase();
            if (!IMAGES.includes(ext) && !VIDEOS.includes(ext)) throw new Error('Choose a photo (png, jpg, gif, webp) or a video (mp4, mov, m4v, webm)');
            const stat = await fsp.stat(file);
            if (stat.size > MEDIA_LIMIT) throw new Error('That file is over 500 MB; a shorter clip, please');
            c.media = this._media(file);
        }
        this._save();
        return this.describe(c);
    }
    async mediaBytes(id) { const c = this.find(id); return c.media ? { bytes: new Uint8Array(await fsp.readFile(c.media.path)), mime: c.media.mime, version: c.media.version } : null; }
    /** The whole list at once, as a project brings it; go2rtc is told about the network ones that changed. */
    async replaceAll(list) {
        const before = this.cameras;
        this.cameras = (Array.isArray(list) ? list : []).filter(c => c && typeof c.id === 'string').map(c => ({
            id: c.id, name: String(c.name || ''), url: typeof c.url === 'string' ? c.url : '', simulate: !!c.simulate, deviceLabel: String(c.deviceLabel || ''), positions: cleanPositions(c.positions),
            media: c.media && typeof c.media.path === 'string' ? this._media(c.media.path) : null
        }));
        this._save(); this.writeConfig();
        for (const old of before) if (!this.cameras.some(n => n.id === old.id && n.url === old.url)) await this._tell('DELETE', old);
        for (const now of this.cameras) if (!before.some(o => o.id === now.id && o.url === now.url)) await this._tell('PUT', now);
    }
    async remove(id) {
        const index = this.cameras.findIndex(c => c.id === id);
        if (index < 0) return;
        const [gone] = this.cameras.splice(index, 1); this._save(); this.writeConfig();
        await this._tell('DELETE', gone);
    }
}

module.exports = { CameraEngine, findBinary, findFfmpeg, IMAGES, VIDEOS };
