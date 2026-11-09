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
// What sits beside the themes: the runtime every theme page loads as ../lanecast-theme.js, and the page that previews a theme without the app.
const KIT = ['lanecast-theme.js', 'preview.html'];
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };
// Where a new theme's documents point once they are outside this repository
const REPOSITORY = 'https://github.com/lgbeno/lanecast';
const slug = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

class Themes {
    constructor({ userDir }) { this.userDir = userDir; this.themes = new Map(); this.projectFolder = null; }
    /** The open project's copy of its theme, shown as its own entry while a project is open. */
    setProject(folder) { this.projectFolder = folder; }
    clearProject() { this.projectFolder = null; }
    /** Every theme found, the project's first, then built-in, then the user's: [{ id, name, version, author, description, source, folder, overlay, control, url }]. */
    async list() {
        this.themes = new Map();
        if (this.projectFolder) {
            try {
                const m = JSON.parse(await fsp.readFile(path.join(this.projectFolder, 'theme.json'), 'utf8'));
                const control = !m.control ? null : typeof m.control === 'string' ? { page: m.control, width: 340, height: 0 } : { page: String(m.control.page || 'control.html'), width: Number(m.control.width) || 340, height: Number(m.control.height) || 0 };
                this.themes.set('p-project', { id: 'p-project', name: `${m.name || 'Theme'} (project)`, version: String(m.version || ''), author: String(m.author || ''), description: `This project's own copy of ${m.name || 'its theme'}, as it was when the project was saved. ${m.description || ''}`.trim(),
                    source: 'project', folder: this.projectFolder, overlay: String(m.overlay || 'overlay.html'), control, url: 'theme://p-project/' });
            } catch (e) { /* a project without a usable theme */ }
        }
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
    /** Keep the runtime and the preview page beside the user's themes, current with this version of the app. The app itself serves the
     *  runtime to a theme it shows; these copies are for everything else: the theme opened in a browser or as an OBS browser source, and
     *  preview.html, which plays a race into a theme with no app and no meet (how someone, or an AI assistant, sees their work). */
    async ensureKit() {
        try {
            await fsp.mkdir(this.userDir, { recursive: true });
            for (const name of KIT) {
                const from = await fsp.readFile(path.join(BUILTIN, name)), to = path.join(this.userDir, name);
                const have = await fsp.readFile(to).catch(() => null);
                if (!have || !have.equals(from)) await fsp.writeFile(to, from);
            }
        } catch (e) { /* a themes folder that cannot be written: the app still shows themes */ }
    }
    /** Tell when themes change on disk: onChange(ids) with the ids of the themes whose files were touched ('*' when the shared runtime was).
     *  The list is to be read again either way, since a theme may have come or gone. This is what lets the window follow a theme as
     *  it is edited, with nobody pressing Reload. Returns a function that stops the watch. */
    watch(onChange) {
        const watchers = [], touched = new Set(); let timer = null;
        const report = id => { if (id) touched.add(id); clearTimeout(timer); timer = setTimeout(() => { const ids = [...touched]; touched.clear(); onChange(ids); }, 400); };
        const first = file => String(file || '').split(/[\\/]/)[0];
        const on = (dir, idOf) => { try { watchers.push(fs.watch(dir, { recursive: true }, (event, file) => report(idOf(first(file))))); } catch (e) { /* not a folder that can be watched (inside the packaged app, say) */ } };
        try { fs.mkdirSync(this.userDir, { recursive: true }); } catch (e) { /* it will be made when a theme is */ }
        on(this.userDir, name => name && !KIT.includes(name) ? 'u-' + slug(name) : '');
        on(BUILTIN, name => name === 'lanecast-theme.js' ? '*' : name && !name.includes('.') ? 'b-' + slug(name) : '');      // in development the built-in ones are edited too
        return () => { for (const w of watchers) { try { w.close(); } catch (e) { /* closed */ } } clearTimeout(timer); };
    }
    /** Start a theme of the user's own as a copy of another (the template, unless one is named by its id); returns the new theme's id. */
    async create(name, fromId) {
        const folder = slug(name); if (!folder) throw new Error('Give the theme a name');
        const to = path.join(this.userDir, folder);
        if (fs.existsSync(to)) throw new Error(`A theme folder called ${folder} already exists`);
        if (!this.themes.size) await this.list();
        const from = fromId ? this.themes.get(fromId) : this.themes.get('b-template');
        if (!from) throw new Error('The theme to start from is no longer there');
        const title = String(name).trim(), template = from.id === 'b-template';
        await this.ensureKit();
        await fsp.cp(from.folder, to, { recursive: true });
        const manifest = path.join(to, 'theme.json'), m = JSON.parse(await fsp.readFile(manifest, 'utf8'));
        m.name = title; m.author = ''; m.version = '1.0.0'; m.description = template ? 'My theme, started from the Lanecast template.' : `My theme, started from ${from.name}.`;
        await fsp.writeFile(manifest, JSON.stringify(m, null, 2) + '\n');
        await this.requirements(to, from, title);
        await this.list();
        return 'u-' + folder;
    }
    /** The new theme's REQUIREMENTS.md: the blank form, under the new name. What the theme it was copied from was asked to be is kept beside it
     *  as STARTED-FROM.md, since that is what the copy does until it is changed. Links that pointed into this repository are made to point at it online. */
    async requirements(to, from, title) {
        const form = path.join(to, 'REQUIREMENTS.md'), blank = path.join(BUILTIN, 'template', 'REQUIREMENTS.md');
        const online = text => text.replace(/\]\(\.\.\/\.\.\/docs\//g, `](${REPOSITORY}/blob/main/docs/`).replace(/\]\(\.\.\/(?!\.)/g, `](${REPOSITORY}/blob/main/themes/`);
        const template = from.id === 'b-template';
        try {
            if (!template) {
                if (!fs.existsSync(form)) return;                        // copied from a theme that has no requirements: leave it so
                const theirs = await fsp.readFile(form, 'utf8');
                await fsp.writeFile(path.join(to, 'STARTED-FROM.md'), from.source === 'built-in' ? online(theirs) : theirs);
            }
            let text = online(await fsp.readFile(blank, 'utf8')).replace('# Requirements: <theme name>', `# Requirements: ${title}`);
            if (!template) text = text.replace(/\| \*\*Starts from\*\* \|[^\n]*\|/, `| **Starts from** | ${from.name}. What that theme was asked to be, and so what this one does until it is changed, is in [STARTED-FROM.md](STARTED-FROM.md) |`);
            await fsp.writeFile(form, text);
        } catch (e) { /* the theme works without its paperwork */ }
    }
}

module.exports = { Themes, BUILTIN };
