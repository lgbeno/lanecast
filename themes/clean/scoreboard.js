/* The engine every "scoreboard on the lanes" theme shares. It builds the header and the lane rows, keeps them in step with
 * the race, and switches classes on and off; the theme's theme.css decides what each class looks like and how it moves.
 *
 *   <div id="sb"></div>
 *   <script src="../lanecast-theme.js"></script>
 *   <script src="scoreboard.js"></script>
 *   <script> Scoreboard.start({ … }) </script>
 *
 * What it draws, and the classes it uses (the whole contract between this file and a theme.css):
 *
 *   .header-container
 *     #eventBox  .header-content  > .label "Event"  .value            .visible / .hiding come and go with the board;
 *     #heatBox   .header-content  > .label "Heat"   .value            .exploding then .appearing when the number changes
 *     #nameBox   .header-content  > .event-name-wrapper(.scrolling) > .event-name-track > .event-name, .event-name-copy
 *     #timerBox  .timer-content   > .timer-label  .running-time       .visible only while a race is on
 *   .lanes-container
 *     .lane-box[data-lane]                                            one a lane
 *       .lane-indicator                                               the lane's marker; .brick-explode then .gone when nobody is in it
 *       .lineup-content > .lineup-name, .lineup-team                  .visible before the start, for a lane with a name
 *       .split-content  > .split-time                                 .visible while the lane shows a split
 *       .lane-content   > .place-indicator, .swimmer-name, .swimmer-team, .final-time
 *                                                                     .visible once the lane has a place; .first-place, .second-place, .third-place
 *
 * Every piece is hidden until it gets .visible; a piece that is leaving gets .hiding for as long as its animation runs.
 *
 * Scoreboard.start(options), every one optional:
 *   labels    { event: 'Event', heat: 'Heat', clock: 'Time' }
 *   marker    n => HTML for lane n's marker                 (default: the number)
 *   place     n => what to write for place n                (default: 1st, 2nd …)
 *   row       (rowElement, n) => …                          called when a row is built: add art to it
 *   lane      (rowElement, lane) => …                       called when who is in a lane changes: lane is the state's lane
 *   fragments ['#colour', …]                                what a marker bursts into
 *   meetInName false                                        do not put the meet's name where the event's name goes when an event has none
 *   buttons   [{ label, action }]                           extra buttons for the control panel; a press arrives as
 *                                                           Lanecast.on('control', m => m.action === …)
 *
 * Scoreboard.root is #sb; Scoreboard.row(n) is lane n's row; Scoreboard.settings is what is in force.
 * For moments (a new event, the start, the end of a heat) listen to Lanecast yourself: Lanecast.on('event.change', …).
 *
 * The same file in every theme that uses it; the app's tests check that it is.
 */
(function () {
    'use strict';
    /* What the person can change in the settings dialog and the control panel. Places are shares of the picture's height. */
    const DEFAULTS = { lanes: 8, laneOne: 'bottom', side: 'right', top: 41, bottom: 100, meet: '', header: true, board: true, clock: true };
    const ROW = 67;                                       // the row height the theme was drawn at: 1em = 16px there
    const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    const opt = { labels: { event: 'Event', heat: 'Heat', clock: 'Time' }, marker: n => String(n), place: n => Lanecast.ordinal(n), row: null, lane: null, fragments: ['#ffffff', '#cfd8e3'], buttons: [], meetInName: true };
    const api = { root: null, settings: { ...DEFAULTS }, row: n => rows[n] && rows[n].box };
    let rows = {}, built = '', head = null, started = false;

    /* ---- coming and going: .visible while shown, .hiding while it leaves ---- */
    const shown = new WeakMap();
    function show(e, on) {
        if ((shown.get(e) || false) === on) return;
        shown.set(e, on);
        clearTimeout(e._hide);
        if (on) { e.classList.remove('hiding'); e.classList.add('visible'); }
        else { e.classList.remove('visible'); e.classList.add('hiding'); e._hide = setTimeout(() => e.classList.remove('hiding'), 700); }
    }
    const texts = new WeakMap();
    function text(e, value) { const v = value == null ? '' : String(value); if (texts.get(e) === v) return false; texts.set(e, v); e.textContent = v; return true; }

    /* ---- building ---- */
    function buildHeader() {
        const box = (id, cls, inner) => { const b = el('div', 'header-box ' + cls); b.id = id; b.innerHTML = inner; return b; };
        const header = el('div', 'header-container');
        header.append(
            box('eventBox', 'fixed', `<div class="header-content"><span class="label"></span><span class="value"></span></div>`),
            box('heatBox', 'fixed', `<div class="header-content"><span class="label"></span><span class="value"></span></div>`),
            box('nameBox', 'stretch', `<div class="header-content"><div class="event-name-wrapper"><div class="event-name-track"><span class="event-name"></span><span class="event-name event-name-copy"></span></div></div></div>`),
            box('timerBox', 'fixed', `<div class="timer-container"><div class="timer-content"><span class="timer-label"></span><span class="running-time"></span></div></div>`));
        const q = s => header.querySelector(s);
        q('#eventBox .label').textContent = opt.labels.event; q('#heatBox .label').textContent = opt.labels.heat; q('.timer-label').textContent = opt.labels.clock;
        head = { header, event: q('#eventBox .header-content'), eventValue: q('#eventBox .value'), heat: q('#heatBox .header-content'), heatValue: q('#heatBox .value'),
            name: q('#nameBox .header-content'), wrapper: q('.event-name-wrapper'), title: q('.event-name'), copy: q('.event-name-copy'), timer: q('.timer-content'), clock: q('.running-time') };
        return header;
    }
    function buildRow(n) {
        const box = el('div', 'lane-box'); box.dataset.lane = n;
        box.innerHTML = `<div class="lane-indicator"></div>
            <div class="lineup-content"><div class="lineup-info"><span class="lineup-name"></span><span class="lineup-team"></span></div></div>
            <div class="lane-content"><div class="place-indicator"></div><div class="lane-info"><span class="swimmer-name"></span><span class="swimmer-team"></span><span class="final-time"></span></div></div>
            <div class="split-content"><span class="split-time"></span></div>`;
        const q = s => box.querySelector(s);
        const r = { box, marker: q('.lane-indicator'), lineup: q('.lineup-content'), lineupName: q('.lineup-name'), lineupTeam: q('.lineup-team'), result: q('.lane-content'), place: q('.place-indicator'),
            name: q('.swimmer-name'), team: q('.swimmer-team'), time: q('.final-time'), split: q('.split-content'), splitTime: q('.split-time'), there: true, who: null };
        r.marker.innerHTML = opt.marker(n);
        if (opt.row) opt.row(box, n);
        return r;
    }
    /* The rows, in the order they sit in the picture. Rebuilt only when the number of lanes or their order changes. */
    function buildLanes() {
        const s = api.settings, key = s.lanes + s.laneOne;
        if (key === built) return;
        built = key; rows = {};
        const order = Array.from({ length: s.lanes }, (_, i) => i + 1);
        if (s.laneOne === 'bottom') order.reverse();
        for (const n of order) rows[n] = buildRow(n);
        lanesEl.replaceChildren(...order.map(n => rows[n].box));
    }
    /* The canvas is 1920 wide; the picture is whatever it is. Checked on every draw as well as on a resize, because a frame
     * that was loaded while hidden has no width yet. */
    let width = -1;
    function scale() { if (window.innerWidth === width) return; width = window.innerWidth; api.root.style.setProperty('--k', String(width / 1920)); }
    function layout() {
        const s = api.settings, root = api.root;
        scale();
        root.style.setProperty('--lanes-top', String(s.top / 100)); root.style.setProperty('--lanes-bottom', String(s.bottom / 100));
        root.classList.toggle('left', s.side === 'left');
        const rowHeight = ((s.bottom - s.top) / 100 * 1080 - 40) / s.lanes - 8;
        root.style.setProperty('--s', String(clamp(rowHeight / ROW, .5, 1.25)));
        head.header.classList.toggle('away', !s.header); lanesEl.classList.toggle('away', !s.board);
    }
    function settle(saved) {
        const s = { ...DEFAULTS, ...(saved || {}) };
        s.lanes = clamp(Math.round(Number(s.lanes)) || 8, 1, 10);
        s.top = clamp(Number(s.top) || 0, 0, 90); s.bottom = clamp(Number(s.bottom) || 100, s.top + 10, 100);
        api.settings = s;
        buildLanes(); layout(); draw(Lanecast.state);
    }

    /* ---- a number in the header changes: the old one leaves, the new one arrives ---- */
    function swap(content, valueEl, value) {
        const v = value == null ? '' : String(value);
        if (texts.get(valueEl) === v) return;
        const first = !texts.get(valueEl) || !shown.get(content);
        texts.set(valueEl, v);
        clearTimeout(valueEl._a); clearTimeout(valueEl._b);
        if (first) { valueEl.textContent = v; content.classList.remove('exploding', 'appearing'); return; }
        content.classList.remove('appearing'); content.classList.add('exploding');
        valueEl._a = setTimeout(() => { valueEl.textContent = v; content.classList.remove('exploding'); content.classList.add('appearing'); }, 300);
        valueEl._b = setTimeout(() => content.classList.remove('appearing'), 800);
    }
    /* A name too long for its box scrolls round and round */
    function marquee() {
        const w = head.wrapper; w.classList.remove('scrolling');
        requestAnimationFrame(() => {
            const need = head.title.offsetWidth, room = w.clientWidth - 8;
            if (!need || need <= room) return;
            const distance = need + 100;                  // the copy starts 100px after the name
            w.style.setProperty('--scroll-distance', -distance + 'px'); w.style.setProperty('--scroll-duration', (distance / 70).toFixed(1) + 's');
            w.classList.add('scrolling');
        });
    }
    /* A marker bursting into pieces */
    function burst(r, delay) {
        clearTimeout(r._burst);
        r._burst = setTimeout(() => {
            const k = (window.innerWidth / 1920) || 1, a = r.marker.getBoundingClientRect(), x = (a.left + a.width / 2) / k, y = (a.top + a.height / 2) / k;
            r.marker.classList.add('brick-explode');
            for (let i = 0; i < 8; i++) {
                const f = el('div', 'brick-fragment'), angle = Math.PI * 2 * i / 8 + Math.random() * .5, far = 40 + Math.random() * 40;
                f.style.left = x - 5 + 'px'; f.style.top = y - 5 + 'px'; f.style.background = opt.fragments[i % opt.fragments.length];
                f.style.setProperty('--fx', Math.cos(angle) * far + 'px'); f.style.setProperty('--fy', Math.sin(angle) * far + 'px');
                api.root.append(f); setTimeout(() => f.remove(), 700);
            }
            r._burst = setTimeout(() => { r.marker.classList.remove('brick-explode'); r.marker.classList.add('gone'); }, 420);
        }, delay);
    }
    function marker(r, there, index, animate) {
        if (r.there === there) return;
        r.there = there; clearTimeout(r._burst);
        if (there) r.marker.classList.remove('brick-explode', 'gone');
        else if (animate) burst(r, index * 70);
        else r.marker.classList.add('gone');
    }

    /* ---- the board, from the state. Runs ten times a second in a race, so it only touches what changed ---- */
    let wasOn = false;
    function draw(s) {
        if (!started) return;
        scale();
        const set = api.settings, on = !!(s && s.event != null);
        api.root.classList.toggle('off', !on && !wasOn);
        show(head.event, on); show(head.heat, on);
        const title = on ? (s.title || (opt.meetInName && set.meet) || '') : '';
        show(head.name, on && !!title);
        show(head.timer, on && set.clock && s.phase === 'racing');
        if (on) {
            swap(head.event, head.eventValue, s.event); swap(head.heat, head.heatValue, s.heat);
            if (title && text(head.title, title)) { head.copy.textContent = title; marquee(); }
            text(head.clock, s.clock || '0:00.0');
        }
        const named = on && s.lanes.some(l => l.name);     // with start lists, a lane without a name is empty
        let index = 0;
        for (const n of Object.keys(rows)) {
            const r = rows[n], l = on ? s.lanes[n - 1] : null, i = index++;
            const active = !!(l && (l.name || l.time || l.place != null || l.followsClock));
            marker(r, on && (named ? active : true), i, on);
            const finished = !!l && l.place != null;
            show(r.lineup, !!l && s.phase === 'lineup' && !!l.name);
            show(r.split, !!l && !finished && !!l.time && s.phase !== 'lineup');
            show(r.result, finished);
            if (!l) continue;
            if (l.name) { text(r.lineupName, l.name); text(r.lineupTeam, l.team); }
            if (!finished && l.time) text(r.splitTime, l.time);
            if (finished) {
                text(r.place, opt.place(l.place)); text(r.name, l.name); text(r.team, l.team); text(r.time, l.time);
                r.result.classList.toggle('first-place', l.place === 1); r.result.classList.toggle('second-place', l.place === 2); r.result.classList.toggle('third-place', l.place === 3);
            }
            const who = l.name + '|' + l.team + '|' + (l.place == null ? '' : l.place);
            if (who !== r.who) { r.who = who; if (opt.lane) opt.lane(r.box, l); }
        }
        wasOn = on;
    }

    let lanesEl = null;
    api.start = function (options) {
        if (started) return api;
        Object.assign(opt, options || {}); opt.labels = { event: 'Event', heat: 'Heat', clock: 'Time', ...((options || {}).labels || {}) };
        api.root = document.getElementById('sb') || document.body.appendChild(Object.assign(el('div'), { id: 'sb' }));
        lanesEl = el('div', 'lanes-container');
        api.root.append(buildHeader(), lanesEl);
        started = true;
        settle(Lanecast.settings);
        Lanecast.on('settings', settle);
        Lanecast.on('state', draw);
        // A new heat: every marker comes back, and the ones for lanes nobody is in burst again
        Lanecast.on('heat.lineup', () => { for (const n of Object.keys(rows)) { const r = rows[n]; clearTimeout(r._burst); r.there = true; r.marker.classList.remove('brick-explode', 'gone'); } draw(Lanecast.state); });
        window.addEventListener('resize', scale);
        // The control panel asks which extra buttons this theme has; tell it when this page is up too, in case it is already there
        const tell = () => Lanecast.send({ buttons: opt.buttons });
        Lanecast.on('control', m => { if (m && m.ask === 'buttons') tell(); });
        Lanecast.on('hello', tell);
        return api;
    };
    window.Scoreboard = api;
})();
