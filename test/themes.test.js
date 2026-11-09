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

test('a font shipped in a built-in theme has its licence beside it', () => {
    let fonts = 0;
    for (const theme of themes) for (const file of walk(path.join(ROOT, theme)).filter(f => /\.(ttf|otf|woff2?)$/i.test(f))) {
        fonts++;
        assert(fs.readdirSync(path.dirname(file)).some(n => /^(OFL|LICEN[CS]E)(\.txt|\.md)?$/i.test(n)), `${path.relative(ROOT, file)} has a licence file in its folder`);
    }
    assert(fonts >= 1, 'found the Arcade theme\'s font');
    assert(/SIL Open Font License/.test(read('arcade', 'fonts/OFL.txt')));
});

// A new theme of the user's own is a copy of another, with a blank requirements form under its own name
(async () => {
    const os = require('node:os'), fsp = require('node:fs/promises');
    const { Themes } = require('../src/main/themes');
    const userDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lanecast-themes-'));
    try {
        const made = new Themes({ userDir });
        const plain = await made.create('Dolphins 2026');
        assert.equal(plain, 'u-dolphins-2026');
        const at = (...parts) => path.join(userDir, ...parts), text = (...parts) => fs.readFileSync(at(...parts), 'utf8');
        assert.equal(JSON.parse(text('dolphins-2026', 'theme.json')).name, 'Dolphins 2026');
        assert(/started from the Lanecast template/.test(JSON.parse(text('dolphins-2026', 'theme.json')).description));
        assert(text('dolphins-2026', 'REQUIREMENTS.md').startsWith('# Requirements: Dolphins 2026\n'), 'the form carries the new name');
        assert(!fs.existsSync(at('dolphins-2026', 'STARTED-FROM.md')), 'the template leaves nothing to start from');
        assert(!/\]\(\.\.\//.test(text('dolphins-2026', 'REQUIREMENTS.md')), 'no link points back into the repository by a relative path');
        assert(/\]\(https:\/\/github\.com\/lgbeno\/lanecast\/blob\/main\/docs\/agents\/theme-requirements\.md\)/.test(text('dolphins-2026', 'REQUIREMENTS.md')), 'the guide is linked online');
        assert(fs.existsSync(at('lanecast-theme.js')) && fs.existsSync(at('preview.html')), 'the runtime and the preview page sit beside it');

        const board = await made.create('Spring Sprint', 'b-arcade');
        assert.equal(board, 'u-spring-sprint');
        const m = JSON.parse(text('spring-sprint', 'theme.json'));
        assert.deepEqual([m.name, m.author, m.description, m.control.page], ['Spring Sprint', '', 'My theme, started from Arcade.', 'control.html']);
        for (const file of [...SHARED, 'theme.css', 'overlay.html', 'fonts/PressStart2P-Regular.ttf', 'fonts/OFL.txt']) assert(fs.existsSync(at('spring-sprint', file)), `the copy has ${file}`);
        assert.equal(text('spring-sprint', 'scoreboard.js'), read('arcade', 'scoreboard.js'), 'the engine is copied unchanged');
        const form = text('spring-sprint', 'REQUIREMENTS.md'), before = text('spring-sprint', 'STARTED-FROM.md');
        assert(form.startsWith('# Requirements: Spring Sprint\n') && /\| \*\*Starts from\*\* \| Arcade\. .*\[STARTED-FROM\.md\]\(STARTED-FROM\.md\) \|/.test(form), 'a blank form that says where it started');
        assert(/`event\.change`/.test(form) && /<the club, the meet, the date>/.test(form), 'and is otherwise blank');
        assert(before.startsWith('# Requirements: Arcade\n') && !/\]\(\.\.\//.test(before) && /blob\/main\/themes\/template\/REQUIREMENTS\.md/.test(before), 'what Arcade was asked to be is kept, with its links pointing online');

        const again = await made.create('Sprint Two', board);                                   // from a theme of the user's own
        assert(/started from Spring Sprint/.test(JSON.parse(text('sprint-two', 'theme.json')).description));
        await assert.rejects(made.create('Spring Sprint', 'b-clean'), /already exists/);
        await assert.rejects(made.create('Another', 'b-no-such-theme'), /no longer there/);
        await assert.rejects(made.create('  '), /Give the theme a name/);
        assert.equal((await made.list()).filter(t => t.source === 'mine').length, 3);
        console.log('PASS a new theme starts as a copy of the template or of any other theme, with a blank requirements form under its own name');
    } catch (e) { console.error('FAIL a new theme starts as a copy'); console.error(e); process.exitCode = 1; }
    finally { await fsp.rm(userDir, { recursive: true, force: true }); }
})();
