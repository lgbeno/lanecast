'use strict';
// The built-in themes, checked as files: each is complete, keeps the rules of the frame it will run in, and the themes that
// share the scoreboard engine really do share it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('./helpers');

const ROOT = path.join(__dirname, '..', 'themes');
const themes = fs.readdirSync(ROOT).filter(name => fs.existsSync(path.join(ROOT, name, 'theme.json')));
const read = (theme, file) => fs.readFileSync(path.join(ROOT, theme, file), 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const SHARED = ['scoreboard.js', 'scoreboard.css', 'control.html', 'settings.html'];
const boards = themes.filter(t => fs.existsSync(path.join(ROOT, t, 'scoreboard.js')));

test('every built-in theme has a manifest, the pages it names, and the runtime on every page', () => {
    assert(themes.length >= 3, 'found the themes');
    for (const theme of themes) {
        const m = JSON.parse(read(theme, 'theme.json'));
        assert(m.name && m.description, `${theme}: a name and a description`);
        const pages = [m.overlay || 'overlay.html', ...(m.control ? [typeof m.control === 'string' ? m.control : m.control.page || 'control.html'] : [])];
        for (const page of pages) assert(fs.existsSync(path.join(ROOT, theme, page)), `${theme}: ${page} is there`);
        for (const file of fs.readdirSync(path.join(ROOT, theme)).filter(f => f.endsWith('.html')))
            assert(read(theme, file).includes('<script src="../lanecast-theme.js"></script>'), `${theme}/${file} loads the runtime, by that exact tag`);
    }
});

test('no built-in theme breaks a rule of the frame: nothing from the internet, no boxes, no storage', () => {
    for (const theme of themes) {
        for (const file of walk(path.join(ROOT, theme)).filter(f => /\.(html|css|js|svg)$/.test(f))) {
            const where = path.relative(ROOT, file);
            // Comments may talk about the rules; only code can break them
            const code = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
            const remote = (code.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"')]*/gi) || []).filter(u => !/^http:\/\/www\.w3\.org\//.test(u));
            assert.deepEqual(remote, [], `${where} loads nothing from the internet`);
            assert(!/\b(alert|confirm|prompt)\s*\(/.test(code), `${where} opens no browser box`);
            assert(!/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(code), `${where} keeps nothing in browser storage`);
            assert(!/color-scheme\s*:\s*dark/.test(code), `${where} does not set a dark colour scheme (the frame would stop being transparent)`);
        }
    }
});

test('the themes built on the scoreboard engine share it byte for byte, and say what they were asked to be', () => {
    assert(boards.includes('clean'), 'Clean is one of them');
    for (const file of SHARED) for (const theme of boards) assert.equal(read(theme, file), read('clean', file), `${theme}/${file} is the same as clean/${file}`);
    for (const theme of [...boards, 'template']) assert(fs.existsSync(path.join(ROOT, theme, 'REQUIREMENTS.md')), `${theme} has its REQUIREMENTS.md`);
    for (const theme of boards) {
        const overlay = read(theme, 'overlay.html');
        for (const need of ['scoreboard.css', 'theme.css', 'scoreboard.js', 'Scoreboard.start(']) assert(overlay.includes(need), `${theme}/overlay.html uses ${need}`);
        assert(fs.existsSync(path.join(ROOT, theme, 'theme.css')), `${theme} has its own look`);
    }
});

test('the blank requirements form asks about everything Lanecast tells a theme', () => {
    const form = read('template', 'REQUIREMENTS.md');
    for (const name of ['event.change', 'heat.lineup', 'race.start', 'lane.split', 'lane.finish', 'heat.finish', 'event.finish', 'race.reset']) assert(form.includes('`' + name), `the form has a row for ${name}`);
});

test('the Jaguars theme matches a school by an assigned code or an exact name, and never by resemblance', () => {
    const sandbox = { window: {} };
    new Function('window', read('jaguars', 'teams.js'))(sandbox.window);
    const { match, teams } = sandbox.window.JaguarTeams;
    assert.equal(teams.length, 13);
    for (const t of teams) assert(/^#[0-9a-f]{6}$/.test(t.primary) && /^#[0-9a-f]{6}$/.test(t.secondary) && t.name && t.id, `${t.id} has a name and two colours`);
    assert.equal(match('Ashwaubenon').id, 'ashwaubenon');
    assert.equal(match('  ashwaubenon ').id, 'ashwaubenon', 'case and spaces are ignored');
    assert.equal(match('Witt-Birn').id, 'wittenberg', 'a listed spelling matches');
    assert.equal(match('Notre Dame/N.E.W').id, 'notre-dame');
    assert.equal(match('ASHW'), null, 'a code nobody assigned matches nothing');
    assert.equal(match('ASHW', { ASHW: 'ashwaubenon' }).id, 'ashwaubenon', 'an assigned code matches');
    assert.equal(match('ashw', { ASHW: 'ashwaubenon' }).id, 'ashwaubenon');
    assert.equal(match('PUL', { PUL: 'pulaski', ASHW: 'ashwaubenon' }).id, 'pulaski');
    assert.equal(match('Ashwaubenon East'), null, 'a name that only resembles a school matches nothing');
    assert.equal(match('Two'), null);
    assert.equal(match(''), null);
    assert.equal(match('XXXX', { XXXX: 'no-such-school' }), null, 'a code assigned to a school that is not in the table matches nothing');
});
