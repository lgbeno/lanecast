/* The window: decodes what the main process reads from the two ports, keeps the start lists,
 * shows the cameras, draws the program, and publishes one packet per scoreboard change to the
 * overlay feed. Talks to the main process only through window.lanecast (see preload.js; in an
 * ordinary browser, mock.js stands in).
 */
'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const api = window.lanecast;
    const ROLES = ['timer', 'meet'];
    const TABS = ['stream', 'timer', 'events', 'cameras', 'theme'];
    let tab = 'stream';
    const visible = id => !$(id).hidden;
    const parser = new GENSER.StreamParser();
    let decoder = new CTS.Decoder(), latest = decoder.snapshot(0), timerStart = performance.now();
    let rosters = new GENSER.RosterStore(), lastRecord = null, lastRecordAt = null, saveTimer = null;
    let lastStartList = null;                    // the newest start list to arrive, from either source
    const selected = { event: null, heat: 1 };   // the start list shown in the Events tab
    let following = true;                        // the selection moves to each start list as it arrives, until the user steps away
    let lastSent = '', lastSendAt = 0, packets = 0, lastPacketAt = null;
    let relay = { port: 0, listening: false, clients: 0, sent: 0, error: '', hosts: [] };
    // Simulation, part by part: the timer, the meet data, the cameras.
    let sim = { timer: false, events: false, cameras: false, event: null, heat: null, running: false, racing: false, media: null };
    const PART_OF = { timer: 'timer', meet: 'events' };            // which part each port role belongs to
    const anySim = () => sim.timer || sim.events || sim.cameras;
    let ports = { timer: [], meet: [] }, remembered = {};
    const links = { timer: { state: 'closed', message: '', path: null }, meet: { state: 'closed', message: '', path: null } };
    const connected = role => links[role].state === 'open';
    const busy = role => links[role].state === 'connecting';
    const rosterKey = () => sim.events ? 'rosters-sim' : 'rosters';     // made-up names are kept apart from a real meet's

    const showError = e => { $('error').hidden = false; $('error').textContent = (e.message || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); };
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
        const key = rosterKey();
        saveTimer = setTimeout(() => api.store.set(key, rosters.toJSON()).catch(() => {}), 500);
        pushSchedule();
    }
    function onMeetChunk(chunk) {
        const now = performance.now(), records = parser.feed(chunk, now);
        for (const record of records) {
            rosters.add(record, 'serial', Date.now()); lastRecord = record; lastRecordAt = now;
            arrived(record.event, record.heat, record.title, record.lanes, 'serial', Date.now());
        }
        if (records.length) { saveRosters(); publish(); }
    }
    async function loadRosters() {
        try { rosters = GENSER.RosterStore.fromJSON(await api.store.get(rosterKey())); } catch (e) { rosters = new GENSER.RosterStore(); }
        lastRecord = null; lastStartList = null; selected.event = null; selected.heat = 1; following = true; lastSent = '';
        pushSchedule();
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
    /** A dozen made-up events after the last one stored: random swimmers, mostly short races. */
    function fetchSimulatedEvents() {
        hideError();
        const from = Math.max(0, ...rosters.events.keys()) + 1, at = Date.now();
        const meet = Sim.generateMeet({ events: 12, from });
        for (const e of meet) {
            rosters.addEvent({ event: e.event, title: e.title, heats: e.heats.map(h => h.map(a => ({ name: a ? a[0] : '', team: a ? a[1] : '' }))) }, 'simulated', at);
        }
        arrived(meet[0].event, 1, meet[0].title, null, 'simulated', at);
        saveRosters(); lastSent = ''; publish();
        $('fileStatus').textContent = `Fetched ${meet.length} simulated events, ${meet[0].event}–${meet.at(-1).event}.`;
        render();
    }
    /** What the simulated console runs through: the start lists loaded, whatever their source. */
    let scheduleTimer = null;
    function pushSchedule() {
        clearTimeout(scheduleTimer);
        scheduleTimer = setTimeout(() => {
            if (!sim.timer) return;
            const meet = Array.from(rosters.events.values(), e => ({ event: e.event, title: e.title, gender: '', seconds: Sim.secondsFor(e.title),
                heats: e.heats.map(h => Array.from({ length: Sim.LANES }, (_, i) => h && h[i] && h[i].name ? [h[i].name, h[i].team] : null)) }));
            api.sim.schedule(meet).then(state => { sim = { ...sim, ...state }; render(); }).catch(() => {});
        }, 300);
    }

    // ---- overlay feed --------------------------------------------------------------------
    function publish() {
        if (!connected('timer') || !latest.event || !latest.heat) return;
        const serialized = JSON.stringify(Packet.scoreboard(latest, rosters.view())), now = performance.now();
        if (serialized === lastSent && now - lastSendAt < 1000) return;
        api.relay.send(serialized); lastSent = serialized; lastSendAt = now; packets++; lastPacketAt = now;
    }

    // ---- cameras -------------------------------------------------------------------------
    const SIM_CAMERA = 'cam-sim';
    let engine = { running: false, error: '', api: '', version: '', installed: false, ffmpeg: false };
    let cameraList = [];                 // [{ id, name, url, producers, consumers }]
    const players = new Map();           // id -> Player
    /** The simulated camera: a photo or video from the camera's view, or a drawn pool, as a video stream. */
    class SimCamera {
        constructor() {
            this.canvas = document.createElement('canvas'); this.canvas.width = 1280; this.canvas.height = 720;
            this.ctx = this.canvas.getContext('2d'); this.media = null; this.element = null; this.stream = this.canvas.captureStream(30);
            const draw = () => { this.draw(); requestAnimationFrame(draw); }; draw();
        }
        setMedia(media) {
            if (JSON.stringify(media) === JSON.stringify(this.media)) return;
            this.media = media; this.element = null;
            if (!media) return;
            if (media.kind === 'video') { const v = document.createElement('video'); v.src = media.url; v.muted = true; v.loop = true; v.playsInline = true; v.play().catch(() => {}); this.element = v; }
            else { const img = new Image(); img.src = media.url; this.element = img; }
        }
        draw() {
            const { ctx, canvas } = this, W = canvas.width, H = canvas.height, el = this.element;
            const w = el && (el.videoWidth || el.naturalWidth), h = el && (el.videoHeight || el.naturalHeight);
            if (el && w && h) {
                const scale = Math.max(W / w, H / h), dw = w * scale, dh = h * scale;        // cover, as a camera would fill the frame
                ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
                ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
                return;
            }
            // A pool from the stands: water, lane ropes, a deck.
            const sky = ctx.createLinearGradient(0, 0, 0, H);
            sky.addColorStop(0, '#15314d'); sky.addColorStop(0.42, '#1d6fa8'); sky.addColorStop(1, '#0d4f86');
            ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#c9c3b4'; ctx.fillRect(0, 0, W, H * 0.3);
            ctx.fillStyle = '#8f8a7c'; ctx.fillRect(0, H * 0.28, W, H * 0.02);
            for (let i = 0; i <= 8; i++) {
                const y = H * 0.33 + i * (H * 0.62 / 8), x0 = W * 0.08 + i * 4, x1 = W * 0.92 - i * 4;
                ctx.strokeStyle = i % 2 ? '#e8e2d0' : '#d85a4a'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
                ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '600 26px system-ui'; ctx.textAlign = 'right';
            ctx.fillText('simulated camera · drawn pool', W - 36, 50);
        }
    }
    let simCamera = null;
    /** One camera's picture, pulled from the engine over WebRTC (WHEP). Reconnects by itself. */
    class Player {
        constructor(id, video) { this.id = id; this.video = video; this.pc = null; this.timer = null; this.stopped = false; this.frames = 0; this.frameAt = 0; this.startedAt = performance.now(); this.start(); }
        async start() {
            if (this.stopped) return;
            if (this.id === SIM_CAMERA) { this.video.srcObject = (simCamera ||= new SimCamera()).stream; return; }
            if (api.cameras.mockStream) { this.video.srcObject = api.cameras.mockStream(this.id); return; }     // design mode
            this.close();
            const pc = this.pc = new RTCPeerConnection({ iceServers: [] });
            pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' });
            pc.ontrack = e => { if (this.pc === pc) this.video.srcObject = e.streams[0]; };
            pc.onconnectionstatechange = () => { if (this.pc === pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.later(); };
            try {
                await pc.setLocalDescription(await pc.createOffer());
                await new Promise(resolve => { if (pc.iceGatheringState === 'complete') resolve(); else { pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve(); setTimeout(resolve, 1000); } });
                const res = await fetch(`${engine.api}/api/webrtc?src=${encodeURIComponent(this.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
                if (!res.ok) throw new Error(`engine answered ${res.status}`);
                if (this.pc === pc) await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
            } catch (e) { if (this.pc === pc) this.later(); }
        }
        later() { clearTimeout(this.timer); this.timer = setTimeout(() => this.start(), 2000); }
        close() { if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; } }
        stop() { this.stopped = true; clearTimeout(this.timer); this.close(); this.video.srcObject = null; }
        /** Frames are still arriving. */
        get live() {
            const q = this.video.getVideoPlaybackQuality ? this.video.getVideoPlaybackQuality().totalVideoFrames : 0, now = performance.now();
            if (q > this.frames) { this.frames = q; this.frameAt = now; }
            return this.frames > 0 && now - this.frameAt < 2000 && this.video.videoWidth > 0;
        }
    }
    const tileFor = camera => {
        const figure = document.createElement('figure'); figure.className = 'tile'; figure.dataset.id = camera.id;
        const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true;
        const caption = document.createElement('figcaption'), name = document.createElement('strong'), status = document.createElement('span');
        name.textContent = camera.name; status.className = 'small'; status.textContent = 'Connecting…';
        caption.append(name, status);
        if (camera.id !== SIM_CAMERA) {
            const remove = document.createElement('button');
            remove.className = 'quiet'; remove.type = 'button'; remove.textContent = 'Remove'; remove.title = camera.url;
            remove.onclick = async () => { remove.disabled = true; try { await api.cameras.remove(camera.id); } catch (e) { showError(e); } await refreshCameras(); };
            caption.append(remove);
        }
        figure.append(video, caption);
        players.set(camera.id, new Player(camera.id, video));
        return figure;
    };
    async function refreshCameras() {
        let real = [];
        try { real = await api.cameras.list(); } catch (e) { real = []; }
        cameraList = (sim.cameras ? [{ id: SIM_CAMERA, name: 'Simulated camera', url: sim.media ? sim.media.name : 'drawn pool' }] : []).concat(real);
        const list = $('cameraList'), have = new Set(cameraList.map(c => c.id));
        for (const figure of [...list.children]) if (!have.has(figure.dataset.id)) { players.get(figure.dataset.id)?.stop(); players.delete(figure.dataset.id); figure.remove(); }
        for (const camera of cameraList) if (!players.has(camera.id) && (camera.id === SIM_CAMERA || engine.running)) list.append(tileFor(camera));
        const select = $('programCamera'), current = programCameraId();
        select.replaceChildren(...cameraList.map(c => new Option(c.name, c.id)));
        if (!cameraList.length) select.append(new Option('No cameras yet', ''));
        if (current) select.value = current;
        render();
    }
    async function addCamera() {
        hideError(); $('camAddButton').disabled = true; $('camAddStatus').textContent = 'Adding…';
        try {
            const camera = await api.cameras.add({ name: $('camName').value, url: $('camUrl').value });
            $('camName').value = ''; $('camUrl').value = ''; $('camAddStatus').textContent = `Added ${camera.name}.`;
            await refreshCameras();
        } catch (e) { $('camAddStatus').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
        $('camAddButton').disabled = false;
    }
    function renderCameras() {
        $('engineStatus').textContent = !engine.installed ? 'The camera engine (go2rtc) is not in this build.' : engine.error ? `Camera engine · ${engine.error}`
            : !engine.running ? 'Starting the camera engine…' : `Camera engine running${engine.version ? ' · go2rtc ' + engine.version : ''}${engine.ffmpeg ? '' : ' · ffmpeg not found, so cameras must send H.264'}`;
        $('noCameras').hidden = cameraList.length > 0;
        $('camSim').hidden = !sim.cameras; $('camAdd').hidden = sim.cameras;
        $('mediaName').textContent = sim.media ? `${sim.media.kind === 'video' ? 'Video' : 'Photo'}: ${sim.media.name}` : 'Showing the drawn pool.';
        $('clearMedia').disabled = !sim.media;
        if (simCamera) simCamera.setMedia(sim.cameras ? sim.media : null);
        let live = 0;
        for (const figure of $('cameraList').children) {
            const player = players.get(figure.dataset.id), status = figure.querySelector('.small');
            if (!player) continue;
            const v = player.video;
            if (player.live) { live++; status.textContent = `Live · ${v.videoWidth}×${v.videoHeight}`; status.className = 'small live'; }
            else { status.className = 'small'; status.textContent = performance.now() - player.startedAt < 8000 ? 'Connecting…' : 'No video yet · check the address, and that the camera sends H.264'; }
        }
        return live > 0;
    }

    // ---- program -------------------------------------------------------------------------
    let programCamera = null;            // chosen id, or null for the first camera
    const live = false;                  // on air: set by the YouTube output once it exists
    const programCameraId = () => cameraList.some(c => c.id === programCamera) ? programCamera : cameraList[0]?.id || null;
    const bugRow = (lane, athlete, time, placed) => {
        const li = document.createElement('li'); if (placed) li.className = 'placed';
        const n = document.createElement('span'); n.className = 'lane'; n.textContent = placed ? `${placed}.` : String(lane);
        const name = document.createElement('span'); name.className = 'name'; name.textContent = athlete?.name || '';
        if (athlete?.team) { const team = document.createElement('small'); team.textContent = athlete.team; name.append(team); }
        const t = document.createElement('span'); t.className = 'time'; t.textContent = time;
        li.append(n, name, t); return li;
    };
    /** The picture: the program camera under a lower third built from the timer and the start lists. */
    function renderProgram() {
        const id = programCameraId(), player = id ? players.get(id) : null, video = $('programVideo');
        const source = player?.video.srcObject || null;
        if (video.srcObject !== source) video.srcObject = source;
        const picture = !!player?.live;
        $('stageNote').hidden = picture; $('stageNote').textContent = cameraList.length ? 'Waiting for the camera…' : 'No camera. Add one on the Cameras tab.';
        const showBug = connected('timer') && latest.event;
        $('bug').hidden = !showBug;
        if (showBug) {
            const roster = rosters.view().get(latest.event), heat = roster?.heats[latest.heat - 1] || [];
            $('bugEvent').textContent = `EVENT ${latest.event} · HEAT ${latest.heat || '—'}`;
            $('bugTitle').textContent = roster?.title || '';
            $('bugClock').textContent = latest.clock || '0:00.0';
            const finished = latest.lanes.filter(l => l.time && l.place).sort((a, b) => Number(a.place) - Number(b.place));
            const rows = finished.length ? finished.map(l => bugRow(l.lane, heat[l.lane - 1], l.time, l.place))
                : latest.lanes.filter((l, i) => heat[i]?.name).map(l => bugRow(l.lane, heat[l.lane - 1], l.time || '', 0));
            $('bugLanes').replaceChildren(...rows);
        }
        $('goLive').disabled = true; $('goLive').title = 'Streaming out is not built yet';
        $('programStatus').textContent = live ? 'Live' : picture ? 'Idle · program ready' : 'Idle';
        return picture;
    }

    // ---- display -------------------------------------------------------------------------
    const row = cells => {
        const tr = document.createElement('tr');
        for (const cell of cells) { const td = document.createElement('td'); td.textContent = cell.text ?? cell; if (cell.className) td.className = cell.className; tr.append(td); }
        return tr;
    };
    const ago = at => `${Math.round((performance.now() - at) / 1000)} s ago`;
    function render() {
        const camerasLive = renderCameras();
        const ready = {
            stream: renderProgram(),                                            // the program has a picture
            timer: connected('timer') && latest.blocks > 0 && !latest.stale,    // the console's clock is arriving
            events: rosters.heats > 0,                                          // start lists in hand
            cameras: camerasLive,                                               // a camera's picture is arriving
            theme: false                                                        // not built yet
        };
        // Stream is idle or live, never simulated: its badge is Live, and only when on air (not built yet).
        const simulatedTab = { stream: false, timer: sim.timer, events: sim.events, cameras: sim.cameras, theme: false };
        for (const name of TABS) {
            const button = $('tab-' + name);
            button.firstElementChild.dataset.ready = String(ready[name]);
            const badge = button.querySelector('.sim-badge'); if (badge) badge.hidden = !simulatedTab[name];
        }
        $('liveBadge').hidden = !live;
        for (const toggle of document.querySelectorAll('.simToggle')) toggle.checked = !!sim[toggle.dataset.part];
        // Timer: only what the console sends, and, when simulated, the console's own controls.
        $('event').textContent = `${latest.event ?? '—'} / ${latest.heat ?? '—'}`;
        $('clock').textContent = latest.clock || '—:—.—';
        $('raceState').textContent = latest.state === 'reset' ? 'RESET · INFERRED' : latest.state.toUpperCase();
        if (visible('timer')) $('lanes').replaceChildren(...latest.lanes.map(lane => row([lane.lane, lane.place || '—',
            lane.time ? { text: lane.time, className: 'time' } : lane.followsClock && latest.clock ? { text: latest.clock, className: 'faint' } : '—'])));
        $('timerHead').textContent = sim.timer ? 'Simulated timing console' : 'Timing console';
        // The simulated console's controls live on the Stream tab, where the picture is; folded away when not wanted.
        $('simConsole').hidden = !sim.timer;
        if (sim.timer) {
            if (document.activeElement !== $('simEventNo')) $('simEventNo').value = sim.event ?? '';
            if (document.activeElement !== $('simHeatNo')) $('simHeatNo').value = sim.heat ?? '';
            $('simRun').setAttribute('aria-pressed', String(sim.running)); $('simRace').setAttribute('aria-pressed', String(sim.racing));
            const doing = sim.running ? `Running the meet through ${rosters.events.size ? plural(rosters.events.size, 'loaded event') : 'the built-in meet'}`
                : sim.racing ? `Racing event ${sim.event} heat ${sim.heat}` : `Lined up on event ${sim.event} heat ${sim.heat}`;
            $('simSummary').textContent = doing;
            $('simNote').textContent = sim.running ? 'Lineup, race, results, next heat, round and round.' : rosters.events.size ? 'Step through the events loaded; race this heat, or run the meet from here.' : 'No start lists loaded, so lanes are made up. Fetch or load some on the Events tab.';
        }
        // Events: how much is stored, what arrived last, and the selected start list.
        $('eventsLoaded').textContent = rosters.events.size;
        $('heatsLoaded').textContent = rosters.heats ? plural(rosters.heats, 'heat') : 'no heats';
        $('lastNo').textContent = lastStartList ? `${lastStartList.event} / ${lastStartList.heat}` : '— / —';
        $('saveFiles').disabled = !rosters.events.size;
        $('clearRosters').disabled = !rosters.heats && !lastStartList;
        $('meetHead').textContent = sim.events ? 'Simulated Meet Manager' : 'Meet Manager';
        // Simulated: made-up events are fetched, not loaded or saved.
        $('fetchSim').hidden = !sim.events; $('loadFiles').hidden = sim.events; $('saveFiles').hidden = sim.events;
        if (visible('events')) {
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
        // Overlay feed, in the Configure dialog.
        const address = `ws://${relay.hosts[0] || 'localhost'}:${relay.port}/`;
        $('relayStatus').textContent = relay.error ? `Not listening · ${relay.error}` : !relay.listening ? 'Starting…'
            : `Listening · overlays connect to ${address}` + (connected('timer') ? '' : ' · waiting for the timer');
        $('clients').textContent = relay.clients;
        $('packets').textContent = packets.toLocaleString();
        $('lastSent').textContent = lastPacketAt === null ? '—' : ago(lastPacketAt);
        if ($('configureDialog').open && $('packetJson').parentElement.open) $('packetJson').textContent = lastSent ? JSON.stringify(JSON.parse(lastSent), null, 2) : 'No packet yet. Packets go out while the timer is connected and an event and heat are decoded.';
        // Ports: the real ones' controls go away while that part is simulated.
        for (const role of ROLES) {
            const link = links[role], part = PART_OF[role];
            $(role + 'Port').parentElement.hidden = !!sim[part];
            $(role + 'Connect').disabled = !ports[role].length || connected(role) || busy(role);
            $(role + 'Disconnect').disabled = link.state === 'closed';
            $(role + 'Port').disabled = link.state !== 'closed';
        }
        const timer = links.timer, meet = links.meet;
        $('timerStatus').textContent = sim.timer ? (connected('timer') ? 'Simulated · the pretend console is connected' : 'Simulated · connecting the pretend console…')
            : timer.state === 'connecting' ? 'Connecting…' : timer.state === 'retrying' || timer.state === 'error' ? timer.message
            : timer.state !== 'open' ? 'Not connected.'
            : !latest.bytes ? 'Connected · no data yet'
            : latest.blocks ? 'Connected · receiving' : 'Connected · bytes arriving but nothing decodes. Is this the console’s scoreboard line?';
        $('meetStatus').textContent = sim.events ? 'Simulated · start lists come from Fetch simulated events'
            : meet.state === 'connecting' ? 'Connecting…' : meet.state === 'retrying' || meet.state === 'error' ? meet.message
            : meet.state !== 'open' ? 'Not connected.'
            : parser.records ? `Connected · ${plural(parser.records, 'start list')} received · last was event ${lastRecord.event} heat ${lastRecord.heat}, ${ago(lastRecordAt)}`
            : parser.requests ? 'Connected · this is the scoreboard computer’s line, not Meet Manager’s. Move the tap to the other wire.'
            : parser.bytes ? 'Connected · bytes arriving, no start list yet' : 'Connected · waiting for Meet Manager';
    }

    // ---- ports ---------------------------------------------------------------------------
    async function refreshPorts() {
        for (const role of ROLES) {
            try { ports[role] = await api.serial.list(role); } catch (e) { ports[role] = []; }
            const select = $(role + 'Port'), current = links[role].path || select.value || remembered[role] || '';
            select.replaceChildren(...ports[role].map(p => new Option(p.label, p.path)));
            if (!ports[role].length) select.append(new Option('No serial ports found', ''));
            if (ports[role].some(p => p.path === current)) select.value = current;
        }
        render();
    }
    async function connect(role, path) {
        hideError();
        try {
            await api.serial.open(role, path);
            if (!path.startsWith('sim:')) { remembered[role] = path; api.store.set('ports', remembered); }
        } catch (e) { showError(e); }
        render();
    }
    async function disconnect(role) {
        if (!sim[PART_OF[role]]) { remembered[role] = null; api.store.set('ports', remembered); }
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

    // ---- simulation ----------------------------------------------------------------------
    /** The timer simulated: the pretend console connected, fed the loaded start lists. Meet Manager simulated: no port, Fetch or Load.
     *  A camera simulated: a stand-in tile. Switched back: the remembered real port, if it is there. */
    async function applySim(state, first = false) {
        const was = sim; sim = { ...sim, ...state };
        const changed = part => first || was[part] !== sim[part];
        if (changed('events')) await loadRosters();
        if (changed('timer') || changed('events')) await refreshPorts();
        if (changed('timer')) {
            if (sim.timer) { await connect('timer', 'sim:timer'); pushSchedule(); }
            else if (!first && remembered.timer && ports.timer.some(p => p.path === remembered.timer)) connect('timer', remembered.timer);
        }
        if (changed('events') && sim.events && connected('meet')) await api.serial.close('meet');
        if (changed('events') && !sim.events && !first && remembered.meet && ports.meet.some(p => p.path === remembered.meet)) connect('meet', remembered.meet);
        const parts = [sim.timer && 'the timer', sim.events && 'Meet Manager', sim.cameras && 'a camera'].filter(Boolean);
        const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0] || '';
        $('banner').hidden = !parts.length;
        $('banner').textContent = (api.designMode ? 'Design mode in a browser, nothing real. ' : '') + 'Simulating ' + list + '. Nothing simulated comes from the pool.';
        if (changed('cameras') || first) await refreshCameras();
        render();
    }
    for (const toggle of document.querySelectorAll('.simToggle')) toggle.addEventListener('change', async e => {
        hideError();
        try { await api.sim.set(e.target.dataset.part, e.target.checked); } catch (err) { showError(err); render(); }
    });
    api.sim.onChange(state => applySim(state));
    const simCall = async promise => { try { sim = { ...sim, ...await promise }; } catch (e) { showError(e); } render(); };
    // Stepping the event goes through the events loaded, when there are any; typing a number lines up that event.
    const storedEvents = () => [...rosters.events.keys()].sort((a, b) => a - b);
    const heatsIn = event => rosters.events.get(event)?.heats.length || 99;
    const simEvent = () => sim.event || 1, simHeat = () => sim.heat || 1;
    $('simEventUp').onclick = () => { const stored = storedEvents(); simCall(api.sim.control(stored.find(e => e > simEvent()) ?? (stored.length ? stored[0] : simEvent() + 1), 1)); };
    $('simEventDown').onclick = () => { const stored = storedEvents(); simCall(api.sim.control(stored.filter(e => e < simEvent()).pop() ?? (stored.length ? stored.at(-1) : Math.max(1, simEvent() - 1)), 1)); };
    $('simHeatUp').onclick = () => simCall(api.sim.control(simEvent(), Math.min(simHeat() + 1, heatsIn(simEvent()))));
    $('simHeatDown').onclick = () => simCall(api.sim.control(simEvent(), Math.max(1, simHeat() - 1)));
    $('simEventNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (n >= 1) simCall(api.sim.control(n, 1)); else render(); };
    $('simHeatNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (n >= 1) simCall(api.sim.control(simEvent(), n)); else render(); };
    $('simRun').onclick = () => simCall(api.sim.run(!sim.running, simEvent(), simHeat()));
    $('simConsole').addEventListener('toggle', () => api.store.set('simConsoleOpen', $('simConsole').open).catch(() => {}));
    $('simRace').onclick = () => simCall(api.sim.race(!sim.racing));
    $('fetchSim').onclick = fetchSimulatedEvents;
    $('chooseMedia').onclick = async () => { hideError(); try { await api.sim.chooseMedia(); } catch (e) { showError(e); } };
    $('clearMedia').onclick = async () => { hideError(); try { await api.sim.clearMedia(); } catch (e) { showError(e); } };

    // ---- tabs ----------------------------------------------------------------------------
    function showTab(name, remember = true) {
        if (!TABS.includes(name)) name = TABS[0];
        tab = name;
        for (const t of TABS) { $(t).hidden = t !== name; $('tab-' + t).setAttribute('aria-selected', String(t === name)); }
        if (remember) api.store.set('tab', name).catch(() => {});
        render();
    }
    for (const t of TABS) $('tab-' + t).onclick = () => showTab(t);
    document.querySelector('.tabs').addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const next = TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        showTab(next); $('tab-' + next).focus(); e.preventDefault();
    });

    // ---- wiring --------------------------------------------------------------------------
    for (const role of ROLES) {
        $(role + 'Connect').onclick = () => connect(role, $(role + 'Port').value);
        $(role + 'Disconnect').onclick = () => disconnect(role);
    }
    $('configure').onclick = () => { $('configureDialog').showModal(); render(); };
    $('packetJson').parentElement.addEventListener('toggle', render);
    $('programCamera').onchange = e => { programCamera = e.target.value || null; api.store.set('programCamera', programCamera).catch(() => {}); render(); };
    $('camAddButton').onclick = addCamera;
    $('camUrl').addEventListener('keydown', e => { if (e.key === 'Enter') addCamera(); });
    api.cameras.onStatus(state => { const wasRunning = engine.running; engine = state; if (engine.running && !wasRunning) refreshCameras(); else render(); });
    $('loadFiles').onclick = loadStartLists;
    $('saveFiles').onclick = saveStartLists;
    const pick = (event, heat) => { selected.event = event; selected.heat = Math.max(1, Math.min(heat, 99)); following = false; render(); };
    $('eventUp').onclick = () => { const next = storedEvents().find(e => e > (selected.event || 0)); if (next) pick(next, 1); };
    $('eventDown').onclick = () => { const prev = storedEvents().filter(e => e < (selected.event || Infinity)).pop(); if (prev) pick(prev, 1); };
    $('heatUp').onclick = () => { if (selected.event) pick(selected.event, Math.min(selected.heat + 1, rosters.events.get(selected.event)?.heats.length || 1)); };
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
        $('fileStatus').textContent = ''; api.store.set(rosterKey(), null).catch(() => {}); lastSent = ''; pushSchedule(); render();
    };

    async function init() {
        const info = await api.info();
        document.title = `Lanecast ${info.version}`;
        remembered = (await api.store.get('ports')) || {};
        programCamera = (await api.store.get('programCamera')) || null;
        $('simConsole').open = (await api.store.get('simConsoleOpen')) !== false;
        showTab((await api.store.get('tab')) || 'stream', false);
        relay = await api.relay.status();
        engine = await api.cameras.status();
        for (const role of ROLES) links[role] = await api.serial.state(role);
        await applySim(await api.sim.state(), true);
        // Real ports that were connected when the app last closed are connected again.
        for (const role of ROLES) if (!sim[PART_OF[role]] && remembered[role] && ports[role].some(p => p.path === remembered[role]) && links[role].state === 'closed') connect(role, remembered[role]);
        setInterval(refreshPorts, 3000);
        setInterval(refreshCameras, 3000);
        setInterval(() => { if (connected('timer')) latest = decoder.snapshot(performance.now() - timerStart); publish(); render(); }, 100);
        render();
    }
    init().catch(showError);
})();
