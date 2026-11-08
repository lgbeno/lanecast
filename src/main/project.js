/* Projects: everything a meet's stream needs in one file, so it can be saved, carried to the
 * pool laptop and opened again next season: the cameras (with their stand-in photos), a copy of
 * the theme as it was when saved (not whatever the theme folder holds later), the theme's
 * settings, the start lists, and the switches. A .lanecast file is a zip:
 *
 *   project.json      the manifest, below
 *   theme/…           the theme's folder, copied
 *   media/<id>.<ext>  each simulated camera's stand-in
 *
 * Opening unpacks the theme and media into the app's data folder and puts the rest into the
 * settings; the window then reloads and starts from them. The project's theme shows on the
 * Theme tab as its own entry, so the built-in and user themes stay untouched.
 */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zip = require('./zip');

const FORMAT = 1;
const EXT = '.lanecast';
const SKIP = new Set(['node_modules', '.git', '.DS_Store']);
const FILE_LIMIT = 50 * 1024 * 1024;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

/** Every file under a folder, as [relative, absolute], skipping what never belongs in a theme. */
async function walk(dir, base = dir) {
    const out = [];
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...await walk(file, base));
        else if (entry.isFile()) out.push([path.relative(base, file).split(path.sep).join('/'), file]);
    }
    return out;
}

class Projects {
    constructor({ store, cameras, themes, workDir, version = '' }) {
        this.store = store; this.cameras = cameras; this.themes = themes; this.workDir = workDir; this.version = version;
    }
    /** The project's name and where it lives, if saved: { path, name, named }. A name given in the window wins; else the file's. */
    info() {
        const file = this.store.get('projectPath', null), given = String(this.store.get('projectName', '') || '').trim();
        const name = given || (file ? path.basename(file, EXT) : '');
        return { path: file, name: name || 'Untitled project', named: !!name, ext: EXT };
    }
    /** Name (or unname, with '') the project. Shows in the title bar and names the file on first save. */
    async rename(name) { this.store.set('projectName', String(name || '').trim().slice(0, 80)); await this.store.flush(); return this.info(); }
    /** Everything that goes into the file, from the settings and the camera list. */
    manifest(name) {
        const themeId = this.store.get('theme', 'b-classic'), theme = this.themes.get(themeId) || this.themes.get('b-classic');
        return {
            format: FORMAT, app: 'Lanecast', version: this.version, name, savedAt: new Date().toISOString(),
            cameras: this.cameras.cameras.map(c => ({ id: c.id, name: c.name, url: c.url, simulate: c.simulate, deviceLabel: c.deviceLabel || '', media: c.media ? `media/${c.id}${path.extname(c.media.path).toLowerCase()}` : null })),
            theme: theme ? { id: themeId, name: theme.name.replace(/ \(project\)$/, ''), version: theme.version } : null,
            themeSettings: this.store.get('theme-settings:' + themeId, {}) || {},
            simulate: this.store.get('simulate', {}) || {},
            relayPort: this.store.get('relayPort', 8080), programCamera: this.store.get('programCamera', null), drawer: this.store.get('drawer', null), tab: this.store.get('tab', 'stream'),
            rosters: this.store.get('rosters', null), rostersSim: this.store.get('rosters-sim', null)
        };
    }
    /** Write the project to `file`. */
    async save(file) {
        if (!file.endsWith(EXT)) file += EXT;
        const name = String(this.store.get('projectName', '') || '').trim() || path.basename(file, EXT), manifest = this.manifest(name);
        this.store.set('projectName', name);
        const entries = [{ name: 'project.json', data: JSON.stringify(manifest, null, 2) }];
        const theme = this.themes.get(manifest.theme?.id);
        if (theme) for (const [rel, abs] of await walk(theme.folder)) {
            const stat = await fsp.stat(abs); if (stat.size > FILE_LIMIT) continue;
            entries.push({ name: 'theme/' + rel, data: await fsp.readFile(abs) });
        }
        for (const c of this.cameras.cameras) if (c.media && fs.existsSync(c.media.path)) entries.push({ name: `media/${c.id}${path.extname(c.media.path).toLowerCase()}`, data: await fsp.readFile(c.media.path) });
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file + '.tmp', zip.write(entries));
        await fsp.rename(file + '.tmp', file);
        this.store.set('projectPath', file);
        await this.store.flush();
        return this.info();
    }
    /** Open `file`: unpack and put its contents in place. The caller reloads the window and applies the switches. */
    async open(file) {
        const entries = zip.read(await fsp.readFile(file));
        const manifestEntry = entries.find(e => e.name === 'project.json');
        if (!manifestEntry) throw new Error('Not a Lanecast project: no project.json inside');
        const m = JSON.parse(manifestEntry.data.toString('utf8'));
        if (m.app !== 'Lanecast' || !(m.format <= FORMAT)) throw new Error('This project was saved by a newer Lanecast; update to open it');
        const dir = path.join(this.workDir, slug(m.name) + '-' + crypto.createHash('sha1').update(file).digest('hex').slice(0, 8));
        await fsp.rm(dir, { recursive: true, force: true });
        for (const e of entries) {
            if (!/^(theme|media)\//.test(e.name) || e.name.includes('..')) continue;
            const target = path.join(dir, ...e.name.split('/'));
            if (!target.startsWith(dir + path.sep)) continue;
            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.writeFile(target, e.data);
        }
        const cameras = (m.cameras || []).map(c => ({ ...c, media: c.media ? { path: path.join(dir, ...String(c.media).split('/')) } : null }));
        await this.cameras.replaceAll(cameras);
        const hasTheme = fs.existsSync(path.join(dir, 'theme', 'theme.json'));
        if (hasTheme) { this.themes.setProject(path.join(dir, 'theme')); this.store.set('theme', 'p-project'); this.store.set('theme-settings:p-project', m.themeSettings || {}); }
        else { this.themes.clearProject(); this.store.set('theme', m.theme?.id && this.themes.get(m.theme.id) ? m.theme.id : 'b-classic'); }
        for (const [key, value] of [['simulate', m.simulate || {}], ['relayPort', m.relayPort || 8080], ['programCamera', m.programCamera || null], ['drawer', m.drawer || null], ['tab', m.tab || 'stream'], ['rosters', m.rosters || null], ['rosters-sim', m.rostersSim || null], ['projectPath', file], ['projectName', String(m.name || path.basename(file, EXT)).slice(0, 80)]]) this.store.set(key, value);
        await this.store.flush();
        return { ...this.info(), simulate: m.simulate || {} };
    }
    /** Back to an empty slate: no cameras, no start lists, the Classic theme, nothing simulated. */
    async fresh() {
        await this.cameras.replaceAll([]);
        this.themes.clearProject();
        for (const [key, value] of [['theme', 'b-classic'], ['theme-settings:p-project', null], ['simulate', {}], ['programCamera', null], ['rosters', null], ['rosters-sim', null], ['projectPath', null], ['projectName', '']]) this.store.set(key, value);
        await this.store.flush();
        return this.info();
    }
}

module.exports = { Projects, EXT };
