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

    // ---- overlay feed and the theme ---------------------------------------------------------
    const tracker = new Events.Tracker();         // what happened: heat lined up, race started, lane finished…
    /** The state to the theme and the feed on every change (at most once a second when nothing changes); events as they happen. */
    function publish() {
        if (!connected('timer') || !latest.event || !latest.heat) return;
        const view = rosters.view(), now = performance.now();
        for (const e of tracker.update(latest, view, now)) { const message = Packet.event(e); api.relay.send(JSON.stringify(message)); toTheme(message); }
        const message = Packet.state(latest, view, { phase: tracker.phase, cameras: cameraList.map(c => ({ id: c.id, name: c.name })), camera: programCameraId() });
        const serialized = JSON.stringify(message);
        if (serialized === lastSent && now - lastSendAt < 1000) return;
        api.relay.send(serialized); toTheme(message); lastSent = serialized; lastSendAt = now; packets++; lastPacketAt = now;
    }

    // ---- cameras -------------------------------------------------------------------------
    const SIM_CAMERA = 'cam-sim';
    let engine = { running: false, error: '', api: '', version: '', installed: false, ffmpeg: false };
    let cameraList = [];                 // [{ id, name, url, producers, consumers }]
    const players = new Map();           // id -> Player
    /** The simulated camera: a photo or video from the camera's view, as a video stream. */
    class SimCamera {
        constructor() {
            this.canvas = document.createElement('canvas'); this.canvas.width = 1280; this.canvas.height = 720;
            this.ctx = this.canvas.getContext('2d'); this.media = null; this.element = null; this.url = null; this.stream = this.canvas.captureStream(30);
            const draw = () => { this.draw(); requestAnimationFrame(draw); }; draw();
        }
        setMedia(media) {
            if (JSON.stringify(media) === JSON.stringify(this.media)) return;
            this.media = media; this.element = null;
            if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
            if (!media) return;
            // The file's bytes come from the main process and become a same-origin blob, so the canvas stays untainted and keeps streaming.
            const show = url => {
                if (this.media !== media) return;
                this.url = url;
                if (media.kind === 'video') { const v = document.createElement('video'); v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.play().catch(() => {}); this.element = v; }
                else { const img = new Image(); img.src = url; this.element = img; }
            };
            if (media.url) show(media.url);                                            // design mode hands a blob URL straight over
            else api.sim.mediaBytes().then(file => { if (file) show(URL.createObjectURL(new Blob([file.bytes], { type: file.mime }))); }).catch(e => showError(e));
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
            // Nothing chosen yet: black. The stage says what to do.
            ctx.fillStyle = '#060a0f'; ctx.fillRect(0, 0, W, H);
        }
        /** A photo or video is loaded and has a size: the stream shows something real. */
        get hasPicture() { const el = this.element; return !!(el && (el.videoWidth || el.naturalWidth)); }
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
        cameraList = (sim.cameras ? [{ id: SIM_CAMERA, name: 'Simulated camera', url: sim.media ? sim.media.name : '' }] : []).concat(real);
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
        $('mediaName').textContent = sim.media ? `${sim.media.kind === 'video' ? 'Video' : 'Photo'}: ${sim.media.name}` : 'No photo or video chosen.';
        $('clearMedia').disabled = !sim.media;
        if (simCamera) simCamera.setMedia(sim.cameras ? sim.media : null);
        let live = 0;
        for (const figure of $('cameraList').children) {
            const player = players.get(figure.dataset.id), status = figure.querySelector('.small');
            if (!player) continue;
            const v = player.video, isSim = player.id === SIM_CAMERA;
            if (player.live && (!isSim || simCamera?.hasPicture)) { live++; status.textContent = `Live · ${v.videoWidth}×${v.videoHeight}`; status.className = 'small live'; }
            else { status.className = 'small'; status.textContent = isSim ? (sim.media ? 'Loading…' : 'No photo or video chosen') : performance.now() - player.startedAt < 8000 ? 'Connecting…' : 'No video yet · check the address, and that the camera sends H.264'; }
        }
        return live > 0;
    }

    // ---- program -------------------------------------------------------------------------
    let programCamera = null;            // chosen id, or null for the first camera
    const live = false;                  // on air: set by the YouTube output once it exists
    const programCameraId = () => cameraList.some(c => c.id === programCamera) ? programCamera : cameraList[0]?.id || null;
    /** The picture: the program camera, placed as the theme asks, under the theme's overlay. */
    function renderProgram() {
        const id = programCameraId(), player = id ? players.get(id) : null, video = $('programVideo');
        const source = player?.video.srcObject || null;
        if (video.srcObject !== source) video.srcObject = source;
        const picture = !!player?.live && (id !== SIM_CAMERA || !!simCamera?.hasPicture);
        $('stageNote').hidden = picture;
        $('stageNote').textContent = !cameraList.length ? 'No camera. Add one on the Camera tab.' : id === SIM_CAMERA && !sim.media ? 'Simulated camera · choose a photo or video on the Camera tab' : 'Waiting for the camera…';
        $('goLive').disabled = true; $('goLive').title = 'Streaming out is not built yet';
        $('programStatus').textContent = live ? 'Live' : picture ? 'Idle · program ready' : 'Idle';
        return picture;
    }

    // ---- theme ---------------------------------------------------------------------------
    // The theme's overlay page runs in a frame over the picture, its control page in a box in the deck.
    // Both get the state and the events; either may direct the picture or talk to the other.
    const themes = { list: [], active: null, activeId: null, ready: { overlay: false, control: false }, log: [] };
    const frames = { overlay: $('overlayFrame'), control: $('controlFrame'), dialog: $('dialogFrame') };
    const toFrame = (which, message) => { if (themes.ready[which]) frames[which].contentWindow?.postMessage(message, '*'); };
    const toTheme = message => { for (const which of Object.keys(frames)) toFrame(which, message); };
    // The theme's settings: an object the theme defines, kept per theme, handed to every page at hello and on change.
    let themeSettings = {};
    const settingsKey = () => 'theme-settings:' + (themes.activeId || '');
    async function loadThemeSettings() { try { themeSettings = (await api.store.get(settingsKey())) || {}; } catch (e) { themeSettings = {}; } }
    /** One of the theme's pages as a modal. */
    function openThemeDialog(page, title, width, height) {
        if (!themes.active || typeof page !== 'string' || page.includes('..')) return;
        themes.ready.dialog = false;
        const dialog = $('themeDialog');
        dialog.style.width = Math.min(window.innerWidth - 40, Math.max(320, Number(width) || 520)) + 'px';
        frames.dialog.style.height = Math.min(window.innerHeight - 120, Math.max(200, Number(height) || 480)) + 'px';
        $('themeDialogTitle').textContent = title || themes.active.name;
        frames.dialog.src = `${themes.active.url}${page.replace(/^\/+/, '')}?role=dialog`;
        if (!dialog.open) dialog.showModal();
    }
    function closeThemeDialog() { const dialog = $('themeDialog'); if (dialog.open) dialog.close(); frames.dialog.src = 'about:blank'; themes.ready.dialog = false; }
    $('themeDialogClose').onclick = closeThemeDialog;
    $('themeDialog').addEventListener('close', () => { frames.dialog.src = 'about:blank'; themes.ready.dialog = false; });
    function loadTheme(theme) {
        closeThemeDialog();
        themes.active = theme; themes.ready = { overlay: false, control: false, dialog: false };
        loadThemeSettings();
        frames.overlay.src = theme ? `${theme.url}${theme.overlay}?role=overlay` : 'about:blank';
        $('drawerToggle').hidden = !theme?.control;
        if (theme?.control) {
            if (!drawer.sized && theme.control.width) $('drawer').style.width = Math.max(240, theme.control.width) + 'px';    // the theme's preferred width, until the user drags
            frames.control.src = `${theme.url}${theme.control.page}?role=control`;
        } else frames.control.src = 'about:blank';
        setLayout({ x: 0, y: 0, w: 1, h: 1, fit: 'contain' });
        applyDrawer();
    }
    /** Where the camera sits in the picture, as fractions, set by the theme. */
    function setLayout(box) {
        const clamp = (v, d) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d;
        const v = $('programVideo'), x = clamp(box.x, 0), y = clamp(box.y, 0), w = clamp(box.w, 1), h = clamp(box.h, 1);
        v.style.left = x * 100 + '%'; v.style.top = y * 100 + '%'; v.style.width = w * 100 + '%'; v.style.height = h * 100 + '%';
        v.style.objectFit = box.fit === 'cover' ? 'cover' : 'contain';
    }
    const cameraByRef = ref => cameraList.find(c => c.id === ref) || cameraList.find(c => c.name.toLowerCase() === String(ref).toLowerCase()) || null;
    window.addEventListener('message', e => {
        const from = e.source === frames.overlay.contentWindow ? 'overlay' : e.source === frames.control.contentWindow ? 'control' : e.source === frames.dialog.contentWindow ? 'dialog' : null;
        const m = e.data; if (!from || !m || typeof m !== 'object') return;
        switch (m.type) {
            case 'ready':
                themes.ready[from] = true;
                toFrame(from, { type: 'hello', theme: { id: themes.active?.id, name: themes.active?.name }, size: { width: $('stage').clientWidth, height: $('stage').clientHeight }, settings: themeSettings });
                if (lastSent) toFrame(from, JSON.parse(lastSent));
                renderThemes(); render(); break;
            case 'camera': { const cam = cameraByRef(m.select); if (cam) { programCamera = cam.id; lastSent = ''; render(); } break; }
            case 'layout': setLayout(m); break;
            case 'send': for (const which of Object.keys(frames)) if (which !== from) toFrame(which, { type: from, data: m.data }); break;   // to the theme's other pages
            case 'settings':
                if (m.data && typeof m.data === 'object') { themeSettings = { ...themeSettings, ...m.data }; api.store.set(settingsKey(), themeSettings).catch(() => {}); toTheme({ type: 'settings', data: themeSettings }); }
                break;
            case 'dialog': openThemeDialog(m.page, m.title, m.width, m.height); break;
            case 'closeDialog': closeThemeDialog(); break;
            case 'log': themes.log.push(`${new Date().toLocaleTimeString()} ${from}: ${String(m.message).slice(0, 300)}`); if (themes.log.length > 60) themes.log.shift(); renderThemes(); break;
        }
    });
    async function refreshThemes(selectId) {
        try { themes.list = await api.themes.list(); } catch (e) { themes.list = []; showError(e); }
        const id = selectId || themes.activeId || (await api.themes.active().catch(() => 'b-classic'));
        const theme = themes.list.find(t => t.id === id) || themes.list.find(t => t.id === 'b-classic') || themes.list[0] || null;
        if (theme?.id !== themes.activeId || !themes.active) { themes.activeId = theme?.id || null; loadTheme(theme); }
        renderThemes();
    }
    function renderThemes() {
        const list = $('themeList');
        list.replaceChildren(...themes.list.map(t => {
            const card = document.createElement('figure'); card.className = 'theme' + (t.id === themes.activeId ? ' active' : '');
            const h = document.createElement('h3'); h.textContent = t.name; const v = document.createElement('span'); v.className = 'count'; v.textContent = t.version; h.append(v);
            const src = document.createElement('div'); src.className = 'source'; src.textContent = (t.source === 'mine' ? 'My themes' : 'Built in') + (t.control ? ' · control panel' : '');
            const p = document.createElement('p'); p.className = 'small'; p.textContent = t.description;
            const actions = document.createElement('div'); actions.className = 'actions';
            const use = document.createElement('button'); use.textContent = t.id === themes.activeId ? 'In use' : 'Use'; use.disabled = t.id === themes.activeId; use.className = t.id === themes.activeId ? '' : 'primary';
            use.onclick = async () => { try { await api.themes.select(t.id); themes.activeId = t.id; loadTheme(t); renderThemes(); } catch (e) { showError(e); } };
            actions.append(use); card.append(h, src, p, actions); return card;
        }));
        $('themeStatus').textContent = themes.active ? `${themes.active.name} · ${themes.ready.overlay ? 'overlay ready' : 'loading overlay'}${themes.active.control ? themes.ready.control ? ' · control panel ready' : ' · loading control panel' : ''}` : 'no theme';
        $('themeLog').textContent = themes.log.length ? themes.log.join('\n') : 'Nothing logged yet. A theme\'s Lanecast.log(…) shows here.';
    }
    $('newTheme').onclick = async () => {
        hideError(); const name = $('newThemeName').value.trim();
        if (!name) { $('themeNote').textContent = 'Give the theme a name first.'; return; }
        try { const id = await api.themes.create(name); await api.themes.select(id); $('newThemeName').value = ''; await refreshThemes(id); $('themeNote').textContent = `Made ${name} from the template and switched to it. Open the folder to edit it; changes show after Reload.`; }
        catch (e) { $('themeNote').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    };
    $('openThemes').onclick = async () => { try { const r = await api.themes.openFolder(); if (r) $('themeNote').textContent = r; } catch (e) { showError(e); } };
    $('reloadThemes').onclick = () => { const id = themes.activeId; themes.activeId = null; refreshThemes(id); };

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
            theme: !!themes.active && themes.ready.overlay                      // the theme's overlay is up
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
        $('camerasLabel').textContent = cameraList.length > 1 ? 'Cameras' : 'Camera';
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
            $('simRun').setAttribute('aria-pressed', String(sim.running));
            $('simSummary').textContent = sim.running ? `Running · event ${sim.event} heat ${sim.heat}` + (rosters.events.size ? ` of ${plural(rosters.events.size, 'loaded event')}` : ' of the built-in meet')
                : `Queued · event ${sim.event} heat ${sim.heat}` + (rosters.events.size ? '' : ' · no start lists loaded, lanes made up');
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
            if (!editing) $('startList').replaceChildren(...(heat ? heat.map((a, i) => { const tr = row([i + 1, GENSER.displayName(a.name) || '—', a.team || '—']); tr.dataset.lane = i; tr.title = 'Click to edit'; return tr; }) : []));
            $('storedEvents').textContent = rosters.events.size ? `${rosters.events.size} stored` : '';
            $('heatCount').textContent = entry ? `of ${entry.heats.length}` : '';
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
        $('timerStatus').textContent = sim.timer ? (connected('timer') ? 'Simulated · the pretend console is connected · its controls are on the Stream tab' : 'Simulated · connecting the pretend console…')
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
            if (state.state !== 'open' && was === 'open') { latest = decoder.snapshot(Infinity); lastSent = ''; tracker.reset(); }
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
        if (changed('cameras') || first) await refreshCameras();
        render(); fitStage();
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
    $('fetchSim').onclick = fetchSimulatedEvents;
    $('chooseMedia').onclick = async () => { hideError(); try { await api.sim.chooseMedia(); } catch (e) { showError(e); } };
    $('clearMedia').onclick = async () => { hideError(); try { await api.sim.clearMedia(); } catch (e) { showError(e); } };

    // ---- fit ------------------------------------------------------------------------------
    /** The stage fills what is left under the top bar beside the drawer, 16:9; the drawer is as tall as the stage. Nothing scrolls. */
    function fitStage() {
        const stage = $('stage'), work = $('work'), side = $('drawer'); if ($('stream').hidden) return;
        const top = work.getBoundingClientRect().top, availableH = Math.max(180, window.innerHeight - top - 16);
        const drawerW = side.hidden ? 0 : side.offsetWidth + 12, availableW = Math.max(240, work.clientWidth - drawerW);
        const w = Math.min(availableW, availableH * 16 / 9), h = w * 9 / 16;
        stage.style.width = w + 'px'; stage.style.height = h + 'px';
        side.style.height = Math.max(h, 200) + 'px';
        const control = themes.active?.control;
        frames.control.style.height = control?.height ? control.height + 'px' : '100%';
    }
    window.addEventListener('resize', fitStage);
    // The drawer: the theme's control panel on the right. Hide it for the full picture; drag its left edge to resize.
    const drawer = { open: true, sized: false };
    function applyDrawer() {
        const has = !!themes.active?.control;
        $('drawer').hidden = !has || !drawer.open;
        $('drawerToggle').setAttribute('aria-pressed', String(drawer.open));
        fitStage(); requestAnimationFrame(fitStage);
    }
    $('drawerToggle').onclick = () => { drawer.open = !drawer.open; api.store.set('drawer', { open: drawer.open, width: drawer.sized ? $('drawer').offsetWidth : null }).catch(() => {}); applyDrawer(); };
    $('drawerGrip').addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX, startW = $('drawer').offsetWidth, grip = $('drawerGrip'); grip.classList.add('active');
        const move = ev => { const w = Math.max(240, Math.min($('work').clientWidth * 0.6, startW + (startX - ev.clientX))); $('drawer').style.width = w + 'px'; fitStage(); };
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); grip.classList.remove('active'); drawer.sized = true; api.store.set('drawer', { open: drawer.open, width: $('drawer').offsetWidth }).catch(() => {}); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });

    // ---- tabs ----------------------------------------------------------------------------
    function showTab(name, remember = true) {
        if (!TABS.includes(name)) name = TABS[0];
        tab = name;
        for (const t of TABS) { $(t).hidden = t !== name; $('tab-' + t).setAttribute('aria-selected', String(t === name)); }
        if (remember) api.store.set('tab', name).catch(() => {});
        render(); fitStage(); requestAnimationFrame(fitStage);
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
    // Stepping away stops the view following new start lists; stepping back onto the newest one resumes it.
    const pick = (event, heat) => { selected.event = event; selected.heat = Math.max(1, Math.min(heat, 99)); following = !!lastStartList && lastStartList.event === selected.event && lastStartList.heat === selected.heat; editing = null; render(); };
    $('eventUp').onclick = () => { const next = storedEvents().find(e => e > (selected.event || 0)); if (next) pick(next, 1); };
    $('eventDown').onclick = () => { const prev = storedEvents().filter(e => e < (selected.event || Infinity)).pop(); if (prev) pick(prev, 1); };
    $('heatUp').onclick = () => { if (selected.event) pick(selected.event, Math.min(selected.heat + 1, rosters.events.get(selected.event)?.heats.length || 1)); };
    $('heatDown').onclick = () => { if (selected.event) pick(selected.event, selected.heat - 1); };
    $('viewEventNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (n >= 1 && n <= 999) pick(n, 1); else render(); };
    $('viewHeatNo').onchange = e => { const n = Math.floor(Number(e.target.value)); if (selected.event && n >= 1) pick(selected.event, n); else render(); };
    /** Click a lane in the start list to change its swimmer or team in place. Enter or clicking away keeps it; Escape drops it. */
    let editing = null;                  // { lane } while a row holds inputs
    $('startList').addEventListener('click', e => {
        const tr = e.target.closest('tr'); if (!tr || editing || !selected.event) return;
        const entry = rosters.events.get(selected.event), heat = entry?.heats[selected.heat - 1]; if (!heat) return;
        const lane = Number(tr.dataset.lane), athlete = heat[lane];
        editing = { lane };
        const [, nameCell, teamCell] = tr.children;
        const name = document.createElement('input'); name.value = athlete.name; name.placeholder = 'Last, First'; name.className = 'edit';
        const team = document.createElement('input'); team.value = athlete.team; team.placeholder = 'Team'; team.className = 'edit team';
        nameCell.replaceChildren(name); teamCell.replaceChildren(team); name.focus(); name.select();
        const finish = keep => {
            if (!editing) return;
            if (keep) {
                heat[lane] = { name: name.value.trim(), team: team.value.trim().toUpperCase().slice(0, 16) };
                rosters.version++; rosters._view = null; saveRosters(); lastSent = ''; publish();
            }
            editing = null; render();
        };
        for (const input of [name, team]) {
            input.addEventListener('keydown', ev => { if (ev.key === 'Enter') finish(true); else if (ev.key === 'Escape') finish(false); });
            input.addEventListener('blur', () => setTimeout(() => { if (editing && document.activeElement !== name && document.activeElement !== team) finish(true); }, 0));
        }
    });
    $('clearRosters').onclick = () => {
        rosters.clear(); lastRecord = null; lastStartList = null; selected.event = null; selected.heat = 1; following = true; editing = null;
        $('fileStatus').textContent = ''; api.store.set(rosterKey(), null).catch(() => {}); lastSent = ''; pushSchedule(); render();
    };

    async function init() {
        const info = await api.info();
        document.title = `Lanecast ${info.version}`;
        remembered = (await api.store.get('ports')) || {};
        programCamera = (await api.store.get('programCamera')) || null;
        const savedDrawer = await api.store.get('drawer');
        if (savedDrawer) { drawer.open = savedDrawer.open !== false; if (savedDrawer.width) { drawer.sized = true; $('drawer').style.width = savedDrawer.width + 'px'; } }
        showTab((await api.store.get('tab')) || 'stream', false);
        relay = await api.relay.status();
        engine = await api.cameras.status();
        for (const role of ROLES) links[role] = await api.serial.state(role);
        await applySim(await api.sim.state(), true);
        await refreshThemes();
        // Real ports that were connected when the app last closed are connected again.
        for (const role of ROLES) if (!sim[PART_OF[role]] && remembered[role] && ports[role].some(p => p.path === remembered[role]) && links[role].state === 'closed') connect(role, remembered[role]);
        setInterval(refreshPorts, 3000);
        setInterval(refreshCameras, 3000);
        setInterval(() => { if (connected('timer')) latest = decoder.snapshot(performance.now() - timerStart); publish(); render(); }, 100);
        render();
    }
    init().catch(showError);
})();
