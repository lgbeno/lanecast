'use strict';
let count = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); count++; }
/** Groups passed since the last call: each file reports its own. */
test.count = () => { const n = count; count = 0; return n; };
// A scoreboard block as the console sends it: the control byte, then one data byte per digit position.
const control = (channel, format = false, universal = false) => 128 | ((channel ^ 31) << 1) | Number(format) | (universal ? 64 : 0);
const block = (channel, chars, format = false, universal = false) => [control(channel, format, universal), ...Array.from(chars, (ch, i) => (i << 4) | (ch === ' ' ? 0 : 15 - Number(ch)))];
// A start-list record the way Meet Manager lays it out. See docs/meet-manager-link.md.
function record({ event, heat, title = 'Girls 9-10 50 Back', round = 'Timed Finals', gender = 'G', lanes = {}, counter = 0 }) {
    const s = Array(502).fill(' ');
    const put = (at, value) => { for (let i = 0; i < value.length; i++) s[at + i] = value[i]; };
    s[0] = '\r'; put(1, String(counter % 10)); put(2, '0120'); put(8, title.slice(0, 28)); put(38, round); put(68, gender); put(70, title.slice(0, 28));
    for (const [lane, [name, team]] of Object.entries(lanes)) {
        const at = 116 + (lane - 1) * 38; put(at, String(lane % 10)); put(at + 1, name.slice(0, 20)); put(at + 21, team.slice(0, 4));
    }
    put(496, String(event).padStart(3)); put(499, String(heat).padStart(3));
    return Uint8Array.from(s, c => c.charCodeAt(0));
}
module.exports = { test, control, block, record };
