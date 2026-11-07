/* Settings and meet data, kept as one JSON file in the app's data folder and written a
 * moment after each change.
 */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

class Store {
    constructor(file) { this.file = file; this.data = {}; this.timer = null; this.writing = Promise.resolve(); }
    async load() {
        try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); if (!this.data || typeof this.data !== 'object') this.data = {}; }
        catch (e) { this.data = {}; }
    }
    get(key, fallback = null) { return key in this.data ? this.data[key] : fallback; }
    set(key, value) {
        if (typeof key !== 'string') throw new Error('Store keys are strings');
        if (value === null || value === undefined) delete this.data[key]; else this.data[key] = value;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 300);
    }
    flush() {
        clearTimeout(this.timer); this.timer = null;
        const text = JSON.stringify(this.data, null, 1);
        this.writing = this.writing.then(async () => {
            await fs.mkdir(path.dirname(this.file), { recursive: true });
            await fs.writeFile(this.file + '.tmp', text);
            await fs.rename(this.file + '.tmp', this.file);
        }).catch(() => {});
        return this.writing;
    }
}

module.exports = { Store };
