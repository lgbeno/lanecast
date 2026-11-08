/* Cameras: a go2rtc process the app runs beside itself. It takes each camera's stream (RTSP
 * today) and hands it to the window over WebRTC, so the window can show it and, later,
 * composite it. The list of cameras is ours; go2rtc is told about it at start and on change.
 */
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OS = { darwin: 'mac', win32: 'win', linux: 'linux' };
const RETRY_MS = 3000, START_TIMEOUT_MS = 6000;

/** Where this build keeps go2rtc: beside the app's resources when packaged, in vendor/ in development. */
function findBinary(packaged) {
    const name = process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc';
    const file = packaged ? path.join(process.resourcesPath, 'go2rtc', name)
        : path.join(__dirname, '..', '..', 'vendor', 'go2rtc', `${OS[process.platform]}-${process.arch}`, name);
    return fs.existsSync(file) ? file : null;
}
/** ffmpeg on the PATH, if any: go2rtc uses it for test patterns and for cameras that need transcoding. */
function findFfmpeg() {
    try { return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim() || null; }
    catch (e) { return null; }
}
const yamlString = s => JSON.stringify(String(s));
/** A camera attached to this computer (a webcam, an iPhone as a camera): the window opens it itself, by device id. */
const isDevice = c => /^device:/.test(c.url);

class CameraEngine {
    /** `cameras` is [{ id, name, url }]; `onChange(cameras)` is called to persist it, `onStatus(state)` on engine changes. */
    constructor({ packaged = false, dataDir, port = 1984, webrtcPort = 8555, rtspPort = 8554, cameras = [], onChange = () => {}, onStatus = () => {} }) {
        this.binary = findBinary(packaged); this.ffmpeg = findFfmpeg();
        this.config = path.join(dataDir, 'go2rtc.yaml');
        this.port = port; this.webrtcPort = webrtcPort; this.rtspPort = rtspPort; this.api = `http://127.0.0.1:${port}`;
        this.cameras = cameras.filter(c => c && typeof c.id === 'string' && typeof c.url === 'string').map(c => ({ id: c.id, name: String(c.name || ''), url: c.url }));
        this.onChange = onChange; this.onStatus = onStatus;
        this.process = null; this.running = false; this.stopping = false; this.error = this.binary ? '' : 'go2rtc is not in this build'; this.version = ''; this.log = []; this.retry = null;
    }
    state() { return { running: this.running, error: this.error, api: this.api, version: this.version, installed: !!this.binary, ffmpeg: !!this.ffmpeg, log: this.log.slice(-5) }; }
    _changed() { this.onStatus(this.state()); }
    writeConfig() {
        const lines = ['# Written by Lanecast at each start; edits here are overwritten.',
            'api:', `  listen: ${yamlString('127.0.0.1:' + this.port)}`,
            // go2rtc hands ffmpeg's output to itself over its RTSP server, so that stays on, on loopback only.
            'rtsp:', `  listen: ${yamlString('127.0.0.1:' + this.rtspPort)}`,
            'webrtc:', `  listen: ${yamlString(':' + this.webrtcPort)}`, '  ice_servers: []',
            'log:', '  level: "warn"', 'streams:'];
        for (const c of this.cameras) if (!isDevice(c)) lines.push(`  ${yamlString(c.id)}: ${yamlString(c.url)}`);   // local cameras never go through go2rtc
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
    /** Cameras with what go2rtc knows about each: whether a source is connected and how many viewers it has. */
    async list() {
        let streams = {};
        if (this.running) { try { streams = await (await fetch(this.api + '/api/streams')).json(); } catch (e) { /* engine busy or gone */ } }
        return this.cameras.map(c => { const s = streams[c.id] || {}; return { ...c, local: isDevice(c), producers: (s.producers || []).length, consumers: (s.consumers || []).length }; });
    }
    async add({ name, url }) {
        name = String(name || '').trim(); url = String(url || '').trim();
        if (!url) throw new Error('Enter the camera’s address');
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) throw new Error('The address should start with rtsp:// (or another scheme go2rtc understands)');
        if (this.cameras.some(c => c.url === url)) throw new Error('That camera is already in the list');
        const id = 'cam-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        const camera = { id, name: name || `Camera ${this.cameras.length + 1}`, url };
        this.cameras.push(camera); this.onChange(this.cameras); this.writeConfig();
        if (this.running && !isDevice(camera)) {
            // go2rtc answers this with 400 when it cannot rewrite its own config, yet still adds the stream; the list is what counts.
            try { await fetch(`${this.api}/api/streams?name=${encodeURIComponent(id)}&src=${encodeURIComponent(url)}`, { method: 'PUT' }); } catch (e) { /* checked below */ }
            const streams = await (await fetch(this.api + '/api/streams')).json().catch(() => ({}));
            if (!streams[id]) throw new Error('go2rtc did not accept that address');
        }
        return camera;
    }
    /** Add or replace a camera with a known id (the test pattern). */
    async put(camera) {
        const index = this.cameras.findIndex(c => c.id === camera.id);
        if (index >= 0) { if (this.cameras[index].url === camera.url) return; this.cameras.splice(index, 1); }
        this.cameras.push({ id: camera.id, name: String(camera.name || camera.id), url: camera.url }); this.onChange(this.cameras); this.writeConfig();
        if (this.running) { try { await fetch(`${this.api}/api/streams?name=${encodeURIComponent(camera.id)}&src=${encodeURIComponent(camera.url)}`, { method: 'PUT' }); } catch (e) { /* listed at next start */ } }
    }
    async remove(id) {
        const index = this.cameras.findIndex(c => c.id === id);
        if (index < 0) return;
        const [gone] = this.cameras.splice(index, 1); this.onChange(this.cameras); this.writeConfig();
        if (this.running && !isDevice(gone)) { try { await fetch(`${this.api}/api/streams?src=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch (e) { /* gone anyway */ } }
    }
}

module.exports = { CameraEngine, findBinary, findFfmpeg };
