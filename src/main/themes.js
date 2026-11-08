/* Themes: folders with a theme.json, an overlay page drawn over the program, and perhaps a
 * control page shown in the Stream tab. Built-in ones ship in themes/; the user's live in the
 * app's data folder. The window loads them over theme://<id>/, which this module serves,
 * never leaving the theme's own folder; /lanecast-theme.js is the shared runtime in every theme.
 */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const BUILTIN = path.join(__dirname, '..', '..', 'themes');
const RUNTIME = path.join(BUILTIN, 'lanecast-theme.js');
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };
const slug = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

class Themes {
    constructor({ userDir }) { this.userDir = userDir; this.themes = new Map(); }
    /** Every theme found, built-in first: [{ id, name, version, author, description, source, folder, overlay, control, url }]. */
    async list() {
        this.themes = new Map();
        for (const [source, dir] of [['built-in', BUILTIN], ['mine', this.userDir]]) {
            let entries = [];
            try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const folder = path.join(dir, entry.name), manifest = path.join(folder, 'theme.json');
                let m;
                try { m = JSON.parse(await fsp.readFile(manifest, 'utf8')); } catch (e) { continue; }
                const id = (source === 'built-in' ? 'b-' : 'u-') + slug(entry.name);
                if (!id.slice(2) || this.themes.has(id)) continue;
                // control: the page, the drawer width it opens at, and a height only if the page should not fill the drawer.
                const control = !m.control ? null : typeof m.control === 'string' ? { page: m.control, width: 340, height: 0 } : { page: String(m.control.page || 'control.html'), width: Number(m.control.width) || 340, height: Number(m.control.height) || 0 };
                this.themes.set(id, { id, name: String(m.name || entry.name), version: String(m.version || ''), author: String(m.author || ''), description: String(m.description || ''),
                    source, folder, overlay: String(m.overlay || 'overlay.html'), control, url: `theme://${id}/` });
            }
        }
        return [...this.themes.values()];
    }
    get(id) { return this.themes.get(id) || null; }
    /** The file behind theme://<id>/<relative>, or null if it is not inside that theme's folder. */
    resolve(id, relative) {
        const theme = this.themes.get(id); if (!theme) return null;
        const file = path.normalize(path.join(theme.folder, decodeURIComponent(relative)));
        return file.startsWith(theme.folder + path.sep) ? file : null;
    }
    /** Answer a theme:// request. */
    async serve(request) {
        const url = new URL(request.url);
        const id = url.hostname, relative = url.pathname.replace(/^\/+/, '') || 'index.html';
        if (!this.themes.has(id) && !(await this.list()).some(t => t.id === id)) return new Response('No such theme', { status: 404 });
        const file = relative === 'lanecast-theme.js' ? RUNTIME : this.resolve(id, relative);
        if (!file) return new Response('Not in this theme', { status: 403 });
        try {
            const body = await fsp.readFile(file);
            const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
            return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
        } catch (e) { return new Response('Not found', { status: 404 }); }
    }
    /** Copy the template into the user's themes folder under a new name; returns the new theme's id. */
    async createFromTemplate(name) {
        const folder = slug(name); if (!folder) throw new Error('Give the theme a name');
        const to = path.join(this.userDir, folder);
        if (fs.existsSync(to)) throw new Error(`A theme folder called ${folder} already exists`);
        await fsp.mkdir(this.userDir, { recursive: true });
        await fsp.cp(path.join(BUILTIN, 'template'), to, { recursive: true });
        const manifest = path.join(to, 'theme.json'), m = JSON.parse(await fsp.readFile(manifest, 'utf8'));
        m.name = String(name).trim(); m.author = ''; m.description = 'My theme, started from the Lanecast template.';
        await fsp.writeFile(manifest, JSON.stringify(m, null, 2) + '\n');
        await this.list();
        return 'u-' + folder;
    }
}

module.exports = { Themes, BUILTIN };
