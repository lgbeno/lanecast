/* The window: decodes what the main process reads from the two ports, keeps the start lists,
 * and publishes one packet per scoreboard change to the overlay feed.
 */
'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const api = window.lanecast;
    const ROLES = ['timer', 'meet'];
    const parser = new GENSER.StreamParser();
    let decoder = new CTS.Decoder(), latest = decoder.snapshot(0), timerStart = performance.now();
    let rosters = new GENSER.RosterStore(), lastRecord = null, lastRecordAt = null, saveTimer = null;
    let lastStartList = null;                    // the newest start list to arrive, from either source
    const selected = { event: null, heat: 1 };   // the start list shown in the Meet data dialog
    let following = true;                        // the selection moves to each start list as it arrives, until the user steps away
    let lastSent = '', lastSendAt = 0, packets = 0, lastPacketAt = null;
    let relay = { port: 0, listening: false, clients: 0, sent: 0, error: '', hosts: [] };
    let ports = [], remembered = {};
    const links = { timer: { state: 'closed', message: '', path: null }, meet: { state: 'closed', message: '', path: null } };
    const connected = role => links[role].state === 'open';
    const busy = role => links[role].state === 'connecting';

    const showError = e => { $('error').hidden = false; $('error').textContent = e.message || String(e); };
    const hideError = () => { $('error').hidden = true; };
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    // ---- timer ---------------------------------------------------------------------------
    function feedTimer(chunk, at) {
        let sequence = decoder.clockSequence;
        // Publish at every completed clock block, so two ticks that arrive in one read both go out.
        for (let i = 0; i < chunk.length; i++) {
            decoder.feed(chunk.subarray(i, i + 1), at);
            if (decoder.clockSequence !== sequence) { sequence = decoder.clockSequence; latest = decoder.snapshot(at); publish(); }
        }
        latest = decoder.snapshot(at); publish();
    }

    // ---- meet data -----------------------------------------------------------------------
    function arrived(event, heat, title, lanes, source, at) {
        lastStartList = { event, heat, title, lanes, source, at };
        if (following) { selected.event = event; selected.heat = heat; }
    }
    function saveRosters() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => api.store.set('rosters', rosters.toJSON()).catch(() => {}), 500);
    }
    function onMeetChunk(chunk) {
        const now = performance.now(), records = parser.feed(chunk, now);
        for (const record of records) {
            rosters.add(record, 'serial', Date.now()); lastRecord = record; lastRecordAt = now;
            arrived(record.event, record.heat, record.title, record.lanes, 'serial', Date.now());
        }
        if (records.length) { saveRosters(); publish(); }
    }
    /** Meet Manager start-list files (.scb, one event each). A file replaces its whole event. */
    async function loadStartLists() {
        hideError();
        let files;
        try { files = await api.files.loadStartLists(); } catch (e) { showError(e); return; }
        if (!files.length) return;
        const failed = [], at = Date.now();
        let events = 0, heats = 0;
        for (const file of files) {
            try {
                if (file.error) throw new Error(file.error);
                if (!/\.scb$/i.test(file.name)) throw new Error('not an .scb file');
                const roster = CTS.parseSCB(file.text);
                rosters.addEvent(roster, file.name, at); events++; heats += roster.heats.length;
                arrived(roster.event, 1, roster.title, roster.heats[0], file.name, at);
            } catch (e) { failed.push(`${file.name} (${e.message || e})`); }
        }
        if (events) { saveRosters(); lastSent = ''; publish(); }
        $('fileStatus').textContent = events ? `Loaded ${plural(events, 'event')}, ${plural(heats, 'heat')}.` : 'Nothing loaded.';
        if (failed.length) showError(new Error('Could not read ' + failed.slice(0, 5).join('; ') + (failed.length > 5 ? `; and ${failed.length - 5} more` : '')));
        render();
    }
    /** Every stored event into a folder, as Meet Manager .scb files: E001.scb and so on. */
    async function saveStartLists() {
        hideError();
        const files = Array.from(rosters.events.values(), entry => ({ name: `E${String(entry.event).padStart(3, '0')}.scb`, text: CTS.formatSCB(entry) }));
        try {
            const result = await api.files.saveStartLists(files);
            if (result) $('fileStatus').textContent = result.count ? `Saved ${plural(result.count, 'file')} to ${result.folder}.` : 'Nothing to save.';
        } catch (e) { showError(e); }
        render();
    }

    // ---- overlay feed --------------------------------------------------------------------
    function publish() {
        if (!connected('timer') || !latest.event || !latest.heat) return;
        const serialized = JSON.stringify(Packet.scoreboard(latest, rosters.view())), now = performance.now();
        if (serialized === lastSent && now - lastSendAt < 1000) return;
        api.relay.send(serialized); lastSent = serialized; lastSendAt = now; packets++; lastPacketAt = now;
    }

    // ---- display -------------------------------------------------------------------------
    const row = cells => {
        const tr = document.createElement('tr');
        for (const cell of cells) { const td = document.createElement('td'); td.textContent = cell.text ?? cell; if (cell.className) td.className = cell.className; tr.append(td); }
        return tr;
    };
    const ago = at => `${Math.round((performance.now() - at) / 1000)} s ago`;
    function render() {
        // Timer: only what the console sends.
        $('event').textContent = `${latest.event ?? '—'} / ${latest.heat ?? '—'}`;
        $('clock').textContent = latest.clock || '—:—.—';
        $('raceState').textContent = latest.state === 'reset' ? 'RESET · INFERRED' : latest.state.toUpperCase();
        if ($('timerData').open) $('lanes').replaceChildren(...latest.lanes.map(lane => row([lane.lane, lane.place || '—',
            lane.time ? { text: lane.time, className: 'time' } : lane.followsClock && latest.clock ? { text: latest.clock, className: 'faint' } : '—'])));
        // Meet data: how much is stored, what arrived last, and the selected start list.
        $('eventsLoaded').textContent = rosters.events.size;
        $('heatsLoaded').textContent = rosters.heats ? plural(rosters.heats, 'heat') : 'no heats';
        $('lastNo').textContent = lastStartList ? `${lastStartList.event} / ${lastStartList.heat}` : '— / —';
        $('saveFiles').disabled = !rosters.events.size;
        $('clearRosters').disabled = !rosters.heats && !lastStartList;
        if ($('eventData').open) {
            const entry = selected.event ? rosters.events.get(selected.event) : null, heat = entry?.heats[selected.heat - 1];
            if (document.activeElement !== $('viewEventNo')) $('viewEventNo').value = selected.event ?? '';
            if (document.activeElement !== $('viewHeatNo')) $('viewHeatNo').value = selected.event ? selected.heat : '';
            $('viewTitle').textContent = !selected.event ? (rosters.heats ? 'Step to an event, or type its number' : 'No event data')
                : !entry ? `Nothing stored for event ${selected.event}`
                : heat ? entry.title || `Event ${selected.event}` : `${entry.title || `Event ${selected.event}`} · heat ${selected.heat} not received`;
            $('startList').replaceChildren(...(heat ? heat.map((a, i) => row([i + 1, GENSER.displayName(a.name) || '—', a.team || '—'])) : []));
            $('storedEvents').textContent = rosters.events.size ? `${rosters.events.size} stored` : '';
            $('heatCount').textContent = entry ? `of ${entry.heats.length}` : '';
            $('follow').setAttribute('aria-pressed', String(following));
        }
        // Overlay feed: the server is always on; what changes is who is listening.
        const address = `ws://${relay.hosts[0] || 'localhost'}:${relay.port}/`;
        $('relayStatus').textContent = relay.error ? `Not listening · ${relay.error}` : !relay.listening ? 'Starting…'
            : `Listening · overlays connect to ${address}` + (connected('timer') ? '' : ' · waiting for the timer');
        $('clients').textContent = relay.clients;
        $('packets').textContent = packets.toLocaleString();
        $('lastSent').textContent = lastPacketAt === null ? '—' : ago(lastPacketAt);
        if ($('packetData').open) $('packetJson').textContent = lastSent ? JSON.stringify(JSON.parse(lastSent), null, 2) : 'No packet yet. Packets go out while the timer is connected and an event and heat are decoded.';
        // Ports.
        for (const role of ROLES) {
            const link = links[role];
            $(role + 'Connect').disabled = !ports.length || connected(role) || busy(role);
            $(role + 'Disconnect').disabled = link.state === 'closed';
            $(role + 'Port').disabled = link.state !== 'closed';
        }
        const timer = links.timer, meet = links.meet;
        $('timerStatus').textContent = timer.state === 'connecting' ? 'Connecting…' : timer.state === 'retrying' || timer.state === 'error' ? timer.message
            : timer.state !== 'open' ? 'Not connected.'
            : !latest.bytes ? 'Connected · no data yet'
            : latest.blocks ? 'Connected · receiving' : 'Connected · bytes arriving but nothing decodes. Is this the console’s scoreboard line?';
        $('meetStatus').textContent = meet.state === 'connecting' ? 'Connecting…' : meet.state === 'retrying' || meet.state === 'error' ? meet.message
            : meet.state !== 'open' ? 'Not connected.'
            : parser.records ? `Connected · ${plural(parser.records, 'start list')} received · last was event ${lastRecord.event} heat ${lastRecord.heat}, ${ago(lastRecordAt)}`
            : parser.requests ? 'Connected · this is the scoreboard computer’s line, not Meet Manager’s. Move the tap to the other wire.'
            : parser.bytes ? 'Connected · bytes arriving, no start list yet' : 'Connected · waiting for Meet Manager';
    }

    // ---- ports ---------------------------------------------------------------------------
    async function refreshPorts() {
        try { ports = await api.serial.list(); } catch (e) { ports = []; }
        for (const role of ROLES) {
            const select = $(role + 'Port'), current = links[role].path || select.value || remembered[role] || '';
            select.replaceChildren(...ports.map(p => new Option(p.label, p.path)));
            if (!ports.length) select.append(new Option('No serial ports found', ''));
            if (ports.some(p => p.path === current)) select.value = current;
        }
        render();
    }
    async function connect(role, path) {
        hideError();
        try { await api.serial.open(role, path); remembered[role] = path; api.store.set('ports', remembered); }
        catch (e) { showError(e); }
        render();
    }
    async function disconnect(role) {
        remembered[role] = null; api.store.set('ports', remembered);
        try { await api.serial.close(role); } catch (e) { showError(e); }
        render();
    }
    api.serial.onState((role, state) => {
        const was = links[role].state; links[role] = state;
        if (role === 'timer') {
            if (state.state === 'open' && was !== 'open') { decoder = new CTS.Decoder(); latest = decoder.snapshot(0); timerStart = performance.now(); }
            if (state.state !== 'open' && was === 'open') { latest = decoder.snapshot(Infinity); lastSent = ''; }
        } else if (state.state === 'open' && was !== 'open') parser.reset();
        if (state.state === 'error') showError(new Error(state.message));
        render();
    });
    api.serial.onData((role, bytes) => { if (role === 'timer') feedTimer(bytes, performance.now() - timerStart); else onMeetChunk(bytes); });
    api.relay.onStatus(status => { relay = status; render(); });

    // ---- wiring --------------------------------------------------------------------------
    for (const role of ROLES) {
        $(role + 'Connect').onclick = () => connect(role, $(role + 'Port').value);
        $(role + 'Disconnect').onclick = () => disconnect(role);
    }
    $('timerView').onclick = () => { $('timerData').showModal(); render(); };
    $('packetView').onclick = () => { $('packetData').showModal(); render(); };
    $('eventView').onclick = () => { $('eventData').showModal(); render(); };
    $('loadFiles').onclick = loadStartLists;
    $('saveFiles').onclick = saveStartLists;
    // Stepping the event goes through the events stored; typing a number shows that event, stored or not.
    const storedEvents = () => [...rosters.events.keys()].sort((a, b) => a - b);
    const heatsIn = event => rosters.events.get(event)?.heats.length || 1;
    const pick = (event, heat) => { selected.event = event; selected.heat = Math.max(1, Math.min(heat, 99)); following = false; render(); };
    $('eventUp').onclick = () => { const next = storedEvents().find(e => e > (selected.event || 0)); if (next) pick(next, 1); };
    $('eventDown').onclick = () => { const prev = storedEvents().filter(e => e < (selected.event || Infinity)).pop(); if (prev) pick(prev, 1); };
    $('heatUp').onclick = () => { if (selected.event) pick(selected.event, Math.min(selected.heat + 1, heatsIn(selected.event))); };
    $('heatDown').onclick = () => { if (selected.event) pick(selected.event, selected.heat - 1); };
    $('viewEventNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (n >= 1 && n <= 999) pick(n, 1); else render(); };
    $('viewHeatNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (selected.event && n >= 1) pick(selected.event, n); else render(); };
    $('follow').onclick = () => {
        following = !following;
        if (following && lastStartList) { selected.event = lastStartList.event; selected.heat = lastStartList.heat; }
        render();
    };
    $('clearRosters').onclick = () => {
        rosters.clear(); lastRecord = null; lastStartList = null; selected.event = null; selected.heat = 1; following = true;
        $('fileStatus').textContent = ''; api.store.set('rosters', null).catch(() => {}); lastSent = ''; render();
    };

    async function init() {
        const info = await api.info();
        if (info.simulated) {
            $('banner').hidden = false;
            $('banner').textContent = 'Simulated ports. Both Connect buttons open a made-up meet that repeats; nothing here comes from a timing console or Meet Manager.';
        }
        try { rosters = GENSER.RosterStore.fromJSON(await api.store.get('rosters')); } catch (e) { /* damaged data: start empty */ }
        remembered = (await api.store.get('ports')) || {};
        relay = await api.relay.status();
        for (const role of ROLES) links[role] = await api.serial.state(role);
        await refreshPorts();
        // A port that was connected when the app last closed is connected again.
        for (const role of ROLES) if (remembered[role] && ports.some(p => p.path === remembered[role]) && links[role].state === 'closed') connect(role, remembered[role]);
        setInterval(refreshPorts, 3000);
        setInterval(() => { if (connected('timer')) latest = decoder.snapshot(performance.now() - timerStart); publish(); render(); }, 100);
        render();
    }
    init().catch(showError);
})();
