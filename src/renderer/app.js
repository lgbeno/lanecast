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
    let sim = { timer: false, events: false, event: null, heat: null, running: false, racing: false };
    const PART_OF = { timer: 'timer', meet: 'events' };            // which part each port role belongs to
    let ports = { timer: [], meet: [] }, remembered = {};
    const links = { timer: { state: 'closed', message: '', path: null }, meet: { state: 'closed', message: '', path: null } };
    const connected = role => links[role].state === 'open';
    const busy = role => links[role].state === 'connecting';
    const rosterKey = () => sim.events ? 'rosters-sim' : 'rosters';     // made-up names are kept apart from a real meet's

    const showError = e => { $('error').hidden = false; $('error').textContent = (e.message || String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); };
    const hideError = () => { $('error').hidden = true; };
    // Nothing fails silently: an error thrown anywhere in the window shows in the line under the tabs, instead of leaving
    // the page quietly half drawn (a tab label that no longer follows, a list that stops updating).
    window.addEventListener('error', e => showError(e.error || new Error(e.message)));
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
        const message = Packet.state(latest, view, { phase: tracker.phase, cameras: cameraList.map(c => ({ id: c.id, name: c.name, steerable: canSteer(c), positions: canSteer(c) ? c.positions || [] : [] })), camera: programCameraId() });
        const serialized = JSON.stringify(message);
        if (serialized === lastSent && now - lastSendAt < 1000) return;
        api.relay.send(serialized); toTheme(message); lastSent = serialized; lastSendAt = now; packets++; lastPacketAt = now;
    }

    // ---- cameras -------------------------------------------------------------------------
    // Each camera has its own switch: the real picture, or a stand-in photo or video while simulated.
    let engine = { running: false, error: '', api: '', version: '', installed: false, ffmpeg: false };
    let cameraList = [];                 // [{ id, name, url, simulate, local, media, producers, consumers }]
    const players = new Map();           // id -> Player
    const anyCameraSimulated = () => cameraList.some(c => c.simulate);
    /** A simulated camera's picture: its stand-in, drawn onto a canvas and captured as a video stream. */
    class StandIn {
        constructor() {
            this.canvas = document.createElement('canvas'); this.canvas.width = 1280; this.canvas.height = 720;
            this.ctx = this.canvas.getContext('2d'); this.key = null; this.element = null; this.url = null; this.stream = this.canvas.captureStream(30);
            const draw = () => { this.draw(); requestAnimationFrame(draw); }; draw();
        }
        /** Load the camera's stand-in if it changed. The bytes come from the main process as a same-origin blob, so the canvas stays untainted. */
        setMedia(camera) {
            const key = camera.media ? `${camera.id}:${camera.media.version}` : `${camera.id}:none`;
            if (key === this.key) return;
            this.key = key; this.element = null;
            if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
            if (!camera.media) return;
            const show = url => {
                if (this.key !== key) return;
                this.url = url;
                if (camera.media.kind === 'video') { const v = document.createElement('video'); v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.play().catch(() => {}); this.element = v; }
                else { const img = new Image(); img.src = url; this.element = img; }
            };
            if (camera.media.url) show(camera.media.url);                                           // design mode hands a blob URL straight over
            else api.cameras.mediaBytes(camera.id).then(file => { if (file) show(URL.createObjectURL(new Blob([file.bytes], { type: file.mime }))); }).catch(e => showError(e));
        }
        draw() {
            const { ctx, canvas } = this, W = canvas.width, H = canvas.height, el = this.element;
            const w = el && (el.videoWidth || el.naturalWidth), h = el && (el.videoHeight || el.naturalHeight);
            ctx.fillStyle = '#060a0f'; ctx.fillRect(0, 0, W, H);
            if (el && w && h) { const scale = Math.max(W / w, H / h), dw = w * scale, dh = h * scale; ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh); }   // cover, as a camera fills its frame
        }
        get hasPicture() { const el = this.element; return !!(el && (el.videoWidth || el.naturalWidth)); }
    }
    /** One camera's picture: the stand-in while simulated; else a device on this computer, or the engine over WebRTC.
     *  A network camera reconnects by itself. A camera on this computer is opened once, and when it ends (the
     *  iPhone's Disconnect, a cable pulled) it stays off until Reconnect is pressed: retrying on its own would
     *  keep waking a phone someone has just put away. */
    const LOOK_MS = 90000;
    const PHONE_HINT = 'after the phone’s own Disconnect button, macOS offers it again only once it is locked and set down in landscape nearby, or plugged in (use the tile’s Disconnect instead to keep it on hand)';
    class Player {
        constructor(camera, video) { this.id = camera.id; this.camera = camera; this.video = video; this.pc = null; this.stream = null; this.standIn = null; this.timer = null; this.stopped = false; this.frames = 0; this.frameAt = 0; this.startedAt = performance.now(); this.state = 'connecting'; this.error = ''; this.attempt = 0; this.lookingUntil = 0; this.start(); }
        get isDevice() { return !this.camera.simulate && !!this.camera.url && this.camera.url.startsWith('device:'); }
        /** The device this camera is, by its id or, when the id has changed (an iPhone gets a new one each time), by its name.
         *  With `wait`, keeps looking for a few seconds: macOS offers a phone a moment after it is unlocked. Remembers a new id. */
        async findDevice(wait) {
            // After the iPhone's Disconnect, macOS drops the phone from every app's camera list until it is locked and set
            // down again (or plugged in), which takes a person a while: so Reconnect keeps looking for a good minute and a half.
            const deadline = performance.now() + (wait ? LOOK_MS : 0), id = this.camera.url.slice(7), attempt = this.attempt;
            this.lookingUntil = wait ? deadline : 0;
            try {
                for (;;) {
                    const known = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
                    this.seen = known.map(d => d.label).filter(Boolean);                       // what macOS offers right now, for the tile to say
                    const found = known.find(d => d.deviceId === id) || (this.camera.deviceLabel && known.find(d => d.label === this.camera.deviceLabel)) || null;
                    if (found) {
                        if (found.deviceId !== id) { this.camera = { ...this.camera, url: 'device:' + found.deviceId }; api.cameras.update(this.id, { url: 'device:' + found.deviceId }).catch(() => {}); }
                        return found.deviceId;
                    }
                    if (performance.now() >= deadline || this.attempt !== attempt || this.stopped) return null;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } finally { if (this.attempt === attempt) this.lookingUntil = 0; }
        }
        /** How many seconds Reconnect will keep looking, or 0 when it is not. */
        get looking() { return this.state === 'connecting' && this.lookingUntil ? Math.max(0, Math.ceil((this.lookingUntil - performance.now()) / 1000)) : 0; }
        /** Stop pressed while looking. */
        cancel() { this.attempt++; clearTimeout(this.timer); this.close(); this.lookingUntil = 0; this.state = 'off'; this.error = 'stopped looking'; render(); }
        /** Disconnect pressed on the tile: let the camera go, but from this side, so macOS keeps offering it and Reconnect finds it at once.
         *  (The phone's own Disconnect button withdraws it from the Mac until the phone is locked and set down again, or plugged in.) */
        disconnect() { this.attempt++; clearTimeout(this.timer); this.close(); this.video.srcObject = null; this.frames = 0; this.frameAt = 0; this.state = 'off'; this.error = 'by you · Reconnect when ready'; render(); }
        async start(wait = false) {
            if (this.stopped) return;
            if (this.camera.simulate) { this.standIn ||= new StandIn(); this.standIn.setMedia(this.camera); this.video.srcObject = this.standIn.stream; return; }
            if (!this.camera.url) return;
            if (this.camera.url.startsWith('device:')) {
                // A camera on this computer: a webcam, a capture card, an iPhone. Opened by device id, 1080p if it can.
                const attempt = ++this.attempt;
                this.state = 'connecting'; this.error = ''; render();
                try {
                    const access = api.cameras.access ? await api.cameras.access() : 'granted';     // macOS asks the person the first time
                    if (access !== 'granted') throw Object.assign(new Error('camera access was refused'), { name: 'NotAllowedError' });
                    const deviceId = await this.findDevice(wait);
                    if (this.attempt !== attempt || this.stopped) return;
                    if (!deviceId) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
                    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
                    if (this.attempt !== attempt || this.stopped || this.camera.simulate) { stream.getTracks().forEach(t => t.stop()); return; }
                    this.stream = stream; this.video.srcObject = stream; this.state = 'open';
                    // A camera added before its name was known (no camera access yet) learns it now, so Reconnect can find it by name.
                    const label = stream.getVideoTracks()[0].label;
                    if (label && label !== this.camera.deviceLabel) { this.camera = { ...this.camera, deviceLabel: label }; api.cameras.update(this.id, { deviceLabel: label }).catch(() => {}); }
                    stream.getVideoTracks()[0].onended = () => {                                // the phone's Disconnect, or a cable pulled: off until Reconnect
                        if (this.stream !== stream) return;
                        this.close(); this.video.srcObject = null; this.state = 'off'; this.error = 'the camera ended the picture'; render();
                    };
                } catch (e) {
                    if (this.attempt !== attempt || this.stopped) return;
                    this.state = 'off';
                    this.error = e.name === 'NotAllowedError' ? 'camera access was refused · allow Lanecast in System Settings → Privacy → Camera'
                        : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? (this.camera.deviceLabel ? `${this.camera.deviceLabel} was not found · macOS lists ${this.seen?.length ? this.seen.join(', ') : 'no camera'} · ${PHONE_HINT}, then Reconnect` : 'not found · is it plugged in?')
                        : e.name === 'NotReadableError' ? 'another app has the camera' : e.message;
                }
                render();
                return;
            }
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
        /** The camera's record changed: a new name is just shown; a new switch, address or stand-in restarts the picture. */
        update(camera) {
            const restart = camera.simulate !== this.camera.simulate || camera.url !== this.camera.url || (camera.media?.version || 0) !== (this.camera.media?.version || 0);
            this.camera = camera;
            if (restart) { clearTimeout(this.timer); this.close(); this.frames = 0; this.frameAt = 0; this.startedAt = performance.now(); this.video.srcObject = null; this.start(); }
        }
        /** Reconnect pressed: open the device again, looking for it by name for a few seconds if it is not there yet. */
        reconnect() { clearTimeout(this.timer); this.close(); this.frames = 0; this.frameAt = 0; this.startedAt = performance.now(); this.video.srcObject = null; this.start(true); }
        later() { clearTimeout(this.timer); this.timer = setTimeout(() => this.start(), 2000); }
        close() { if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; } if (this.stream) { this.stream.getVideoTracks().forEach(t => { t.onended = null; }); this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } }
        stop() { this.stopped = true; clearTimeout(this.timer); this.close(); this.video.srcObject = null; }
        /** Frames are still arriving, and for a simulated camera there is a stand-in to show. */
        get live() {
            const q = this.video.getVideoPlaybackQuality ? this.video.getVideoPlaybackQuality().totalVideoFrames : 0, now = performance.now();
            if (q > this.frames) { this.frames = q; this.frameAt = now; }
            return this.frames > 0 && now - this.frameAt < 2000 && this.video.videoWidth > 0 && (!this.camera.simulate || !!this.standIn?.hasPicture);
        }
    }
    // Which network cameras can be steered: each is asked once (a question that moves nothing), and asked again now and
    // then while the answer is no, since a camera may simply not have been switched on yet.
    const steerable = new Map();                    // camera id -> { url, info, at }
    function askSteerable(camera, again = false) {
        if (!api.ptz || !camera.url || camera.local) { steerable.delete(camera.id); return; }
        const had = steerable.get(camera.id);
        if (!again && had && had.url === camera.url && (had.info || had.asking || Date.now() - had.at < 30000)) return;
        const entry = { url: camera.url, info: had && had.url === camera.url ? had.info : null, at: Date.now(), asking: true };
        steerable.set(camera.id, entry);
        api.ptz.probe(camera.id, again).then(info => { entry.info = info || null; }, () => { entry.info = null; }).then(() => { entry.asking = false; entry.at = Date.now(); render(); });
    }
    /** The controls that steer one camera: pan and tilt, zoom, home, speed, and its named positions. The camera's tile and the
     *  Stream tab's camera panel each hold a set. Returns { element, positions(names) }. */
    function steeringControls(id) {
        const root = document.createElement('div'); root.className = 'ptz';
        const row = className => { const r = document.createElement('div'); r.className = 'ptz-row' + (className ? ' ' + className : ''); return r; };
        const key = (text, title, className) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = title; if (className) b.className = className; return b; };
        const speed = document.createElement('input'); speed.type = 'range'; speed.min = '1'; speed.max = '10'; speed.value = '4'; speed.title = 'Speed'; speed.className = 'ptzSpeed';
        const rate = () => Number(speed.value) / 10;
        // A held button drives. The camera keeps going until told to stop, so the drive is renewed while the button is held
        // (the main process stops the camera if the renewals cease) and letting go stops it at once.
        const held = (button, drive) => {
            let timer = null;
            const end = () => { if (timer === null) return; clearInterval(timer); timer = null; api.ptz.stop(id).catch(() => {}); };
            button.addEventListener('pointerdown', e => { e.preventDefault(); try { button.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer */ } const go = () => drive().catch(() => {}); clearInterval(timer); go(); timer = setInterval(go, 300); });
            for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, end);
            window.addEventListener('blur', end);
            return button;
        };
        const drive = (text, title, pan, tilt) => held(key(text, title), () => api.ptz.move(id, pan * rate(), tilt * rate()));
        const zoomKey = (text, title, zoom) => held(key(text, title), () => api.ptz.zoom(id, zoom * rate()));
        const home = key('Home', 'Back to the camera’s home position', 'wide'); home.onclick = () => api.ptz.home(id).catch(showError);
        const gap = () => document.createElement('i');
        const moves = row(); moves.append(drive('◀', 'Pan left', -1, 0), drive('▲', 'Tilt up', 0, 1), drive('▼', 'Tilt down', 0, -1), drive('▶', 'Pan right', 1, 0), gap(), zoomKey('−', 'Zoom out', -1), zoomKey('+', 'Zoom in', 1), gap(), home, speed);
        // Positions have names. Saving one reads where the camera points and keeps that under the name, in the camera's record
        // (so in the project): pressing it sends the camera back there. Edit… re-teaches one to where the camera points now, or removes it.
        const places = row('ptz-places'), form = row('ptz-save'); form.hidden = true;
        const input = document.createElement('input'); input.placeholder = 'Name this position, e.g. Finish line'; input.maxLength = 40; input.spellcheck = false;
        const save = key('Save', 'Store where the camera points now under this name', 'wide primary'), remove = key('Remove', 'Forget this position', 'wide ptzRemove'), cancel = key('Cancel', '', 'wide');
        let names = [], editing = false, target = null;            // target: the position being re-taught or removed
        const has = name => names.some(n => n.toLowerCase() === name.trim().toLowerCase());
        const sync = () => { save.textContent = target ? 'Re-teach here' : has(input.value) ? 'Update' : 'Save'; save.disabled = !input.value.trim(); remove.hidden = !target; input.readOnly = !!target; };
        const close = () => { form.hidden = true; target = null; };
        const draw = () => {
            const chips = names.map(name => {
                const chip = key(name, editing ? `Re-teach ${name} to where the camera points now, or remove it` : `Go to ${name}`, 'wide ptzPlace' + (editing ? ' editing' : '')); chip.dataset.position = name;
                chip.onclick = () => { if (editing) { target = name; input.value = name; form.hidden = false; sync(); } else api.ptz.goPosition(id, name).catch(showError); };
                return chip;
            });
            const add = key('+ Save position', 'Name where the camera points now (pan, tilt, zoom and focus), to come back to it', 'wide ptzAdd'); add.onclick = () => { target = null; input.value = ''; form.hidden = false; sync(); input.focus(); };
            const edit = key(editing ? 'Done' : 'Edit…', 'Re-teach a position to where the camera points now, or remove it', 'wide ptzEdit'); edit.hidden = !names.length; edit.onclick = () => { editing = !editing; close(); draw(); };
            places.replaceChildren(...chips, add, edit);
        };
        const commit = async () => { const name = input.value.trim(); if (!name) return; save.disabled = true; try { await api.ptz.savePosition(id, name); close(); await refreshCameras(); } catch (e) { showError(e); } sync(); };
        input.oninput = sync; save.onclick = commit; cancel.onclick = close;
        remove.onclick = async () => { if (!target) return; try { await api.ptz.removePosition(id, target); close(); await refreshCameras(); } catch (e) { showError(e); } };
        input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } });
        form.append(input, save, remove, cancel); root.append(moves, places, form); draw();
        return { element: root, positions(list) { const next = list || []; if (next.join('|') !== names.join('|')) { names = [...next]; if (!names.length) editing = false; if (target && !has(target)) close(); draw(); } } };
    }
    const tileSteering = new Map();                 // camera id -> the controls on its tile
    /** A camera showing its real picture that has said it can be steered. */
    const canSteer = camera => !!camera && !camera.simulate && !!steerable.get(camera.id)?.info;
    const tileFor = camera => {
        const figure = document.createElement('figure'); figure.className = 'tile'; figure.dataset.id = camera.id;
        const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true;
        const caption = document.createElement('figcaption'), name = document.createElement('strong'), badge = document.createElement('b'), status = document.createElement('span');
        name.className = 'name'; badge.className = 'sim-badge'; badge.textContent = 'Sim'; status.className = 'small';
        const sw = document.createElement('label'); sw.className = 'switch'; sw.title = 'Show the stand-in instead of the real picture';
        const box = document.createElement('input'); box.type = 'checkbox'; box.className = 'camSim'; const knob = document.createElement('span');
        sw.append(box, knob, document.createTextNode('Simulate'));
        box.onchange = async () => { try { await api.cameras.update(camera.id, { simulate: box.checked }); } catch (e) { showError(e); } await refreshCameras(); };
        const gear = document.createElement('button'); gear.type = 'button'; gear.className = 'gear'; gear.textContent = 'Settings'; gear.title = 'Name, address, simulation and stand-in';
        gear.onclick = () => openCameraDialog(camera.id);
        const again = document.createElement('button'); again.type = 'button'; again.className = 'reconnect'; again.textContent = 'Reconnect'; again.title = 'Open this camera again'; again.hidden = true;
        again.onclick = () => { players.get(camera.id)?.reconnect(); render(); };
        // Steering, for a camera that has said it can be steered (see steerable): the same controls the Stream tab offers.
        const steering = steeringControls(camera.id); steering.element.hidden = true; tileSteering.set(camera.id, steering);
        // Remove, in the corner of the box. It asks once more, in place, since a camera takes its saved positions and stand-in with it.
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove'; remove.textContent = '✕'; remove.title = 'Remove this camera';
        let armed = null;
        const disarm = () => { clearTimeout(armed); armed = null; remove.textContent = '✕'; remove.classList.remove('sure'); remove.title = 'Remove this camera'; };
        remove.onclick = async () => {
            if (armed === null) { remove.textContent = 'Remove?'; remove.classList.add('sure'); remove.title = 'Press again to remove this camera'; armed = setTimeout(disarm, 4000); return; }
            disarm(); hideError();
            try { await api.cameras.remove(camera.id); } catch (e) { showError(e); }
            await refreshCameras();
        };
        remove.addEventListener('blur', disarm);
        caption.append(name, badge, status, sw, remove, again, gear, steering.element); figure.append(video, caption);
        players.set(camera.id, new Player(camera, video));
        return figure;
    };
    let listedSources = '';                         // the cameras the found list was last drawn against
    async function refreshCameras() {
        try { cameraList = await api.cameras.list(); } catch (e) { cameraList = []; }
        const list = $('cameraList'), have = new Set(cameraList.map(c => c.id));
        for (const figure of [...list.children]) if (!have.has(figure.dataset.id)) { players.get(figure.dataset.id)?.stop(); players.delete(figure.dataset.id); tileSteering.delete(figure.dataset.id); figure.remove(); }
        for (const camera of cameraList) {
            if (players.has(camera.id)) players.get(camera.id).update(camera);
            else list.append(tileFor(camera));
            askSteerable(camera);
        }
        for (const id of steerable.keys()) if (!have.has(id)) steerable.delete(id);
        const sources = cameraList.map(c => c.url + '|' + (c.deviceLabel || '')).join('\n');
        if (sources !== listedSources) { listedSources = sources; renderFound(); }                    // the found list says Added, or offers Add again
        const select = $('programCamera'), current = programCameraId();
        select.replaceChildren(...cameraList.map(c => new Option(c.name, c.id)));
        if (!cameraList.length) select.append(new Option('No cameras yet', ''));
        if (current) select.value = current;
        if ($('cameraDialog').open && dialogCamera) fillCameraDialog(cameraList.find(c => c.id === dialogCamera) || null);
        render();
    }
    /** Add manually: the fallback for a camera the search does not find, or one that wants a login. Its fields live in a dialog. */
    function openManual(name = '', url = '') {
        hideError(); $('camName').value = name; $('camUrl').value = url; $('camAddStatus').textContent = '';
        $('manualDialog').showModal(); (url ? $('camUrl') : $('camName')).focus();
    }
    async function addCamera(simulated = false) {
        hideError(); $('camAddButton').disabled = true; $('camAddStatus').textContent = 'Adding…';
        try {
            const pretend = cameraList.filter(c => /^Simulated camera/.test(c.name)).length;
            const camera = await api.cameras.add(simulated ? { name: 'Simulated camera' + (pretend ? ' ' + (pretend + 1) : ''), url: '', simulate: true } : { name: $('camName').value, url: $('camUrl').value });
            $('camName').value = ''; $('camUrl').value = ''; $('camAddStatus').textContent = '';
            if ($('manualDialog').open) $('manualDialog').close();
            await refreshCameras(); renderFound();
            if (simulated) openCameraDialog(camera.id);
        } catch (e) { if (simulated) showError(e); else $('camAddStatus').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
        $('camAddButton').disabled = false;
    }
    // The camera's settings dialog: name, address, the simulate switch, the stand-in, and removal.
    let dialogCamera = null;
    function fillCameraDialog(camera) {
        if (!camera) { $('cameraDialog').close(); return; }
        $('cameraDialogTitle').textContent = camera.name;
        if (document.activeElement !== $('cdName')) $('cdName').value = camera.name;
        $('cdUrlField').hidden = camera.local;
        if (document.activeElement !== $('cdUrl')) $('cdUrl').value = camera.local ? '' : camera.url;
        // A camera on this computer can be pointed at another device: the one macOS lists now, when the saved id or name no longer matches.
        $('cdDeviceField').hidden = !camera.local;
        if (camera.local && document.activeElement !== $('cdDevice')) {
            const options = devices.filter(d => d.deviceId).map((d, i) => new Option(d.label || `Camera ${i + 1}`, 'device:' + d.deviceId));     // ids are hidden until camera access is given
            if (!devices.some(d => 'device:' + d.deviceId === camera.url)) options.unshift(new Option(`${camera.deviceLabel || 'Saved device'} (not present now)`, camera.url));
            $('cdDevice').replaceChildren(...options); $('cdDevice').value = camera.url;
        }
        $('cdSource').textContent = camera.local ? 'A camera on this computer.' : camera.url ? '' : 'No address: this camera is a stand-in only until one is set.';
        $('cdSimulate').checked = camera.simulate; $('cdSimulate').disabled = !camera.url;
        $('cdMedia').textContent = camera.media ? `${camera.media.kind === 'video' ? 'Video' : 'Photo'}: ${camera.media.name}` : 'None yet.';
        $('cdClearMedia').disabled = !camera.media;
    }
    function openCameraDialog(id) {
        dialogCamera = id; const camera = cameraList.find(c => c.id === id) || null;
        fillCameraDialog(camera); if (dialogCamera) $('cameraDialog').showModal();
        if (camera?.local) refreshDevices(false).then(() => { if (dialogCamera === id) fillCameraDialog(cameraList.find(c => c.id === id) || null); });     // the device list as it is now
    }
    $('cdSave').onclick = async () => {
        hideError();
        try {
            const camera = cameraList.find(c => c.id === dialogCamera), patch = { name: $('cdName').value, url: $('cdUrlField').hidden ? undefined : $('cdUrl').value, simulate: $('cdSimulate').checked };
            if (camera?.local && $('cdDevice').value && $('cdDevice').value !== camera.url) {        // pointed at another device: new id and name
                const picked = devices.find(d => 'device:' + d.deviceId === $('cdDevice').value);
                patch.url = $('cdDevice').value; patch.deviceLabel = picked?.label || '';
            }
            await api.cameras.update(dialogCamera, patch); $('cameraDialog').close();
        }
        catch (e) { showError(e); }
        await refreshCameras();
    };
    $('cdCancel').onclick = () => $('cameraDialog').close();
    $('cdChoose').onclick = async () => { hideError(); try { await api.cameras.chooseMedia(dialogCamera); } catch (e) { showError(e); } await refreshCameras(); };
    $('cdClearMedia').onclick = async () => { hideError(); try { await api.cameras.clearMedia(dialogCamera); } catch (e) { showError(e); } await refreshCameras(); };
    $('cameraDialog').addEventListener('close', () => { dialogCamera = null; });
    // ---- finding cameras: this computer's own and the network's, in one list -----------------
    /** Cameras attached to this computer. Their names only show once camera access has been given, so a search asks once. */
    let devices = [], devicesAsked = false, deviceProblem = '';
    let found = null, searching = false, searchError = '';       // the last network search's answer; one in progress; why it failed
    async function refreshDevices(ask = false) {
        if (!navigator.mediaDevices?.enumerateDevices) { devices = []; renderFound(); return; }
        try {
            if (ask && !devicesAsked) {
                devicesAsked = true; deviceProblem = '';
                try {
                    const access = api.cameras.access ? await api.cameras.access() : 'granted';
                    if (access !== 'granted') throw Object.assign(new Error('refused'), { name: 'NotAllowedError' });
                    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); s.getTracks().forEach(t => t.stop());
                }
                catch (e) { deviceProblem = e.name === 'NotAllowedError' ? 'This computer’s own cameras are hidden: camera access was refused. Allow Lanecast in System Settings → Privacy & Security → Camera.' : e.name === 'NotFoundError' ? '' : e.message; }
            }
            devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
        } catch (e) { devices = []; deviceProblem = e.message; }
        renderFound();
    }
    /** Everything found, as one list: each camera with Add, or with what stands in the way of adding it. */
    function renderFound() {
        const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
        const item = (name, detail) => { const box = el('div', 'found-item'), head = el('div', 'found-head'); head.append(el('strong', '', name), el('span', 'small', detail)); box.append(head); return { box, head }; };
        const adder = (head, have, label, add) => { const button = el('button', '', have ? 'Added' : label); button.type = 'button'; button.disabled = have; button.onclick = async () => { button.disabled = true; try { await add(); } catch (e) { showError(e); button.disabled = false; } }; head.append(button); };
        const rows = [];
        // On this computer: webcams, capture cards, an iPhone as a camera.
        devices.forEach((device, i) => {
            if (!device.deviceId) return;                                        // its id is hidden until camera access is given
            const name = device.label || `Camera ${i + 1}`, url = 'device:' + device.deviceId;
            const have = cameraList.some(c => c.url === url || (!!device.label && c.deviceLabel === device.label));
            const { box, head } = item(name, 'On this computer');
            adder(head, have, 'Add', async () => { await api.cameras.add({ name, url, deviceLabel: device.label }); await refreshCameras(); renderFound(); });
            rows.push(box);
        });
        // On the network: each with whether it can be reached and, if not, what to set.
        for (const camera of found ? found.cameras : []) {
            const { box, head } = item(camera.name, [camera.address || camera.host, camera.kinds.join(' + '), camera.ptz ? 'PTZ' : ''].filter(Boolean).join(' · '));
            if (camera.rtsp && camera.rtsp.needsLogin) adder(head, false, 'Add…', async () => openManual(camera.name, camera.rtsp.url.replace('rtsp://', 'rtsp://user:password@')));    // it wants a login: finish the address by hand
            else if (camera.rtsp) adder(head, cameraList.some(c => c.url === camera.rtsp.url), 'Add', async () => { await api.cameras.add({ name: camera.name, url: camera.rtsp.url }); await refreshCameras(); renderFound(); });
            const fix = camera.diagnosis.fix;
            if (fix) {
                // Found, but this computer cannot talk to it yet. No lesson in networking: just the two ways to put it right.
                const lead = el('p', 'small', camera.explanation + ' To fix this you may:'); if (camera.detail) lead.title = camera.detail;
                const settings = el('p', 'small fix-option', `1) Open ${fix.where}, and enter IP address ${fix.address} and subnet mask ${fix.netmask}.`);
                box.append(lead, settings);
                if (fix.command) {
                    const line = el('div', 'fix'), copy = el('button', '', 'Copy');
                    copy.type = 'button'; copy.title = 'Copy the command';
                    copy.onclick = async () => { try { await navigator.clipboard.writeText(fix.command); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Select it'; } setTimeout(() => { copy.textContent = 'Copy'; }, 1500); };
                    line.append(el('code', '', fix.command), copy);
                    box.append(el('p', 'small fix-or', 'or'), el('p', 'small fix-option', `2) ${fix.terminal || 'Open a terminal'}, then paste this command and press Enter:`), line);
                }
                box.append(el('p', 'small', 'This list updates by itself once that is done.'));
            }
            else if (!camera.rtsp || camera.rtsp.needsLogin) box.append(el('p', 'small', camera.explanation));
            rows.push(box);
        }
        if (found && found.blocked && !found.cameras.length) {
            // Not silence but a shut door: the system let nothing through. Say so, and take the person to the switch.
            const { box } = item('The network search was shut out', '');
            box.append(el('p', 'small', `${found.blocked.what} Allow it in ${found.blocked.where}, then Find cameras again.`));
            if (found.blocked.settings && api.cameras.openNetworkPrivacy) { const line = el('div', 'fix'), open = el('button', '', 'Open that setting'); open.type = 'button'; open.onclick = () => api.cameras.openNetworkPrivacy().catch(showError); line.append(open); box.append(line); }
            rows.push(box);
        }
        const real = rows.length;
        if (searchError) rows.push(el('p', 'small', searchError));
        if (deviceProblem && !devices.some(device => device.deviceId)) rows.push(el('p', 'small', deviceProblem));     // only while none of them can be listed
        if (!real && !searching) rows.push(el('p', 'small', found ? 'No camera found. Check that it is switched on and plugged in, then Find cameras again; or add it by hand.' : 'Find cameras looks on this computer and on the network.'));
        // Always on offer: a stand-in for a camera that is not here yet, to build the stream against a photo or video of its view.
        const sim = item('Simulated camera', 'A stand-in photo or video');
        sim.box.classList.add('simulated');
        adder(sim.head, false, 'Add', async () => { await addCamera(true); renderFound(); });
        rows.push(sim.box);
        $('foundList').replaceChildren(...rows);
        const count = devices.filter(device => device.deviceId).length + (found ? found.cameras.length : 0);
        // While it searches: a spinner and what it is doing, and a bar that fills over the seconds the search takes.
        $('searchStatus').textContent = searching ? 'Searching for network cameras…' : found ? (count ? `${count} found` : 'None found') : '';
        $('searchStatus').classList.toggle('busy', searching);
        const bar = $('searchProgress');
        if (bar.hidden === searching) { bar.hidden = !searching; if (searching) bar.replaceChildren(document.createElement('i')); }     // a fresh bar starts from empty
        $('findDevices').disabled = searching;
    }
    /** Find cameras: one press looks on this computer and listens on the network, together. Also run when the tab is first opened. */
    let finding = null, findAgain = false;
    function findCameras() {
        if (finding) return finding;
        searching = true; searchError = ''; renderFound();
        for (const camera of cameraList) askSteerable(camera, true);               // and ask each network camera again whether it can be steered
        const network = api.cameras.discover().then(result => { found = result; }, e => { found = found || { cameras: [], adapters: [], notes: [], blocked: null }; searchError = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); });
        finding = Promise.all([refreshDevices(true).catch(() => {}), network]).then(() => { searching = false; finding = null; renderFound(); if (findAgain) { findAgain = false; findCameras(); } });
        return finding;
    }
    $('findDevices').onclick = () => { findCameras(); };
    // This computer's network changed (the adapter was set as the list asked, a cable went in): look again, unasked. Only once a
    // search has been made, so the app does not start searching before the Camera tab has ever been opened.
    if (api.cameras.onNetwork) api.cameras.onNetwork(() => { if (finding) findAgain = true; else if (found) findCameras(); });
    // Cameras come and go: keep the list current. A camera that went away is not reopened on its own; its tile has Reconnect.
    if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices(false));
    function renderCameras() {
        $('engineStatus').textContent = !engine.installed ? 'The camera engine (go2rtc) is not in this build.' : engine.error ? `Camera engine · ${engine.error}`
            : !engine.running ? 'Starting the camera engine…' : `Camera engine running${engine.version ? ' · go2rtc ' + engine.version : ''}${engine.ffmpeg ? '' : ' · ffmpeg not found, so network cameras must send H.264'}`;
        $('noCameras').hidden = cameraList.length > 0;
        let live = 0;
        for (const figure of $('cameraList').children) {
            const player = players.get(figure.dataset.id); if (!player) continue;
            const c = player.camera, v = player.video, status = figure.querySelector('.small');
            figure.querySelector('.name').textContent = c.name;
            figure.querySelector('.sim-badge').hidden = !c.simulate;
            const box = figure.querySelector('.camSim'); if (box.checked !== c.simulate) box.checked = c.simulate; box.disabled = !c.url;
            const steering = tileSteering.get(c.id);
            if (steering) { steering.element.hidden = !canSteer(c); steering.positions(c.positions); }
            // One button for a camera on this computer: Disconnect while it is open, Stop while looking, else Reconnect.
            const again = figure.querySelector('.reconnect'), looking = player.looking, open = player.state === 'open';
            again.hidden = !player.isDevice; again.disabled = player.state === 'connecting' && !looking;
            again.textContent = looking ? 'Stop' : open ? 'Disconnect' : 'Reconnect';
            again.title = open ? 'Let the camera go from here; Reconnect brings it back at once. The phone’s own Disconnect button withdraws it from the Mac until it is locked and set down again.' : 'Open this camera again';
            again.onclick = looking ? () => player.cancel() : open ? () => player.disconnect() : () => { player.reconnect(); render(); };
            if (player.live) { live++; status.textContent = `${c.simulate ? 'Stand-in' : 'Live'} · ${v.videoWidth}×${v.videoHeight}`; status.className = 'small live'; }
            else {
                status.className = 'small';
                status.textContent = c.simulate ? (c.media ? 'Loading the stand-in…' : 'No stand-in yet · Settings to choose a photo or video')
                    : player.isDevice ? (player.state === 'off' ? `Disconnected · ${player.error}`
                        : player.looking ? `Looking for ${c.deviceLabel || 'the camera'} · ${player.looking} s · macOS lists ${player.seen?.length ? player.seen.join(', ') : 'no camera'} · ${PHONE_HINT}`
                        : performance.now() - player.startedAt < 8000 ? 'Connecting…' : 'No picture · the camera is open but sends nothing · try Reconnect')
                    : performance.now() - player.startedAt < 8000 ? 'Connecting…' : 'No video yet · check the address, and that the camera sends H.264';
            }
            status.title = status.textContent;                       // the whole message, where the tile cuts it short
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
        const picture = !!player?.live;
        $('stageNote').hidden = picture;
        $('stageNote').textContent = !cameraList.length ? 'No camera. Add one on the Camera tab.' : player?.camera.simulate && !player.camera.media ? `${player.camera.name} is simulated · choose its stand-in photo or video in its settings on the Camera tab` : 'Waiting for the camera…';
        $('goLive').disabled = true; $('goLive').title = 'Streaming out is not built yet';
        $('programStatus').textContent = live ? 'Live' : picture ? 'Idle · program ready' : 'Idle';
        return picture;
    }

    // ---- theme ---------------------------------------------------------------------------
    // The theme's overlay page runs in a frame over the picture, its control page in a box in the deck.
    // Both get the state and the events; either may direct the picture or talk to the other.
    const themes = { list: [], active: null, activeId: null, ready: { overlay: false, control: false }, log: [], unknown: new Set() };
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
        themes.active = theme; themes.ready = { overlay: false, control: false, dialog: false }; themes.unknown = new Set();
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
            case 'camera': {
                const cam = cameraByRef(m.select);
                if (cam) { programCamera = cam.id; lastSent = ''; render(); }
                else if (!themes.unknown.has(String(m.select))) {                  // said once a name, not every race
                    themes.unknown.add(String(m.select));
                    themes.log.push(`${new Date().toLocaleTimeString()} ${from}: no camera named ${JSON.stringify(m.select)} (ignored)`); if (themes.log.length > 60) themes.log.shift(); renderThemes();
                }
                break;
            }
            case 'position': {
                // Steer a camera to a position the person saved under that name: the program camera, unless the theme names another.
                const cam = m.camera === undefined || m.camera === null ? cameraList.find(c => c.id === programCameraId()) : cameraByRef(m.camera);
                const note = text => { themes.log.push(`${new Date().toLocaleTimeString()} ${from}: ${text}`); if (themes.log.length > 60) themes.log.shift(); renderThemes(); };
                if (!cam) note(`position ${JSON.stringify(m.name)}: no such camera`);
                else if (!canSteer(cam)) note(`position ${JSON.stringify(m.name)}: ${cam.name} cannot be steered`);
                else api.ptz.goPosition(cam.id, String(m.name)).then(ok => { if (!ok) note(`${cam.name} has no position named ${JSON.stringify(m.name)}`); }, () => {});
                break;
            }
            case 'steer': {
                // Drive a camera: pan, tilt and zoom each -1..1. Renewed by the theme while it should keep moving; the main process stops
                // the camera when the renewals cease. Said many times a second, so nothing is noted when the camera cannot be steered.
                const cam = m.camera === undefined || m.camera === null ? cameraList.find(c => c.id === programCameraId()) : cameraByRef(m.camera);
                if (cam && canSteer(cam)) api.ptz.steer(cam.id, Number(m.pan) || 0, Number(m.tilt) || 0, Number(m.zoom) || 0).catch(() => {});
                break;
            }
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
    // The Theme tab, on the same lines as the Camera tab: every theme one under another on the left, each with Use; the one in
    // use on the right, with its state, its folder and its console. Making a new one waits behind New theme…
    const SOURCES = { 'built-in': 'Built in', mine: 'Mine', project: 'This project' };
    let themesDrawn = '';
    function renderThemes() {
        const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
        const key = themes.list.map(t => [t.id, t.name, t.version, t.source, t.description, t.control ? 1 : 0].join('\u0001')).join('\u0002') + '#' + themes.activeId;
        if (key !== themesDrawn) {                       // drawn again only when the themes or the choice changed, so a button being pressed is not pulled from under the pointer
            themesDrawn = key;
            $('themeList').replaceChildren(...themes.list.map(t => {
                const active = t.id === themes.activeId, box = el('div', 'found-item theme-item' + (active ? ' active' : '')), head = el('div', 'found-head');
                box.dataset.id = t.id;
                head.append(el('strong', '', t.name), el('span', 'small', [SOURCES[t.source] || '', t.version ? 'v' + t.version : '', t.control ? 'control panel' : ''].filter(Boolean).join(' · ')));
                const use = el('button', 'use' + (active ? '' : ' primary'), active ? 'In use' : 'Use'); use.type = 'button'; use.disabled = active;
                use.onclick = async () => { try { await api.themes.select(t.id); themes.activeId = t.id; loadTheme(t); renderThemes(); } catch (e) { showError(e); } };
                head.append(use);
                if (t.source === 'mine') {
                    // One of your own can be removed: asked once more in place; its folder goes to the Trash.
                    const remove = el('button', 'remove', '✕'); remove.type = 'button'; remove.title = 'Remove this theme (its folder goes to the Trash)';
                    let armed = null;
                    const disarm = () => { clearTimeout(armed); armed = null; remove.textContent = '✕'; remove.classList.remove('sure'); };
                    remove.onclick = async () => {
                        if (armed === null) { remove.textContent = 'Remove?'; remove.classList.add('sure'); armed = setTimeout(disarm, 4000); return; }
                        disarm(); hideError();
                        try { await api.themes.remove(t.id); if (themes.activeId === t.id) themes.activeId = null; await refreshThemes(); } catch (e) { showError(e); }
                    };
                    remove.addEventListener('blur', disarm);
                    head.append(remove);
                }
                box.append(head); if (t.description) box.append(el('p', 'small', t.description));
                return box;
            }));
        }
        const now = themes.active;
        $('themeName').textContent = now ? now.name : 'No theme';
        $('themeState').textContent = now ? ` · ${themes.ready.overlay ? 'overlay ready' : 'loading overlay'}${now.control ? themes.ready.control ? ' · control panel ready' : ' · loading control panel' : ''}` : '';
        const own = !!now && now.source !== 'built-in';
        $('themeAbout').textContent = !now ? '' : own ? 'Edit its files and the stream follows as you save.' : 'Built in. To change how the stream looks, make a theme of your own with New theme…';
        $('openThemes').hidden = !own;
        $('themeConsole').hidden = !themes.log.length;
        $('themeLog').textContent = themes.log.join('\n');
    }
    // New theme…: a name is all it asks; the theme starts from the template, in its own folder, and is switched to.
    $('newThemeOpen').onclick = () => { hideError(); $('newThemeName').value = ''; $('themeNote').textContent = ''; $('newThemeDialog').showModal(); $('newThemeName').focus(); };
    $('newThemeCancel').onclick = () => $('newThemeDialog').close();
    async function newTheme() {
        const name = $('newThemeName').value.trim();
        if (!name) { $('themeNote').textContent = 'Give the theme a name first.'; return; }
        $('newTheme').disabled = true;
        try { const id = await api.themes.create(name); await api.themes.select(id); await refreshThemes(id); $('newThemeDialog').close(); }
        catch (e) { $('themeNote').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
        $('newTheme').disabled = false;
    }
    $('newTheme').onclick = newTheme;
    $('newThemeName').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); newTheme(); } });
    $('openThemes').onclick = async () => { try { const problem = await api.themes.openFolder(themes.activeId); if (problem) showError(new Error(problem)); } catch (e) { showError(e); } };
    $('themeLogClear').onclick = () => { themes.log.length = 0; renderThemes(); };
    const reloadTheme = () => { const id = themes.activeId; themes.activeId = null; return refreshThemes(id); };
    $('reloadThemes').onclick = reloadTheme;
    // Themes are followed on disk: the list keeps up with the folder, and the theme in use is read again when its own files change.
    if (api.themes.onChange) api.themes.onChange(ids => { if (Array.isArray(ids) && (ids.includes(themes.activeId) || ids.includes('*'))) reloadTheme(); else refreshThemes(); });

    // ---- display -------------------------------------------------------------------------
    const row = cells => {
        const tr = document.createElement('tr');
        for (const cell of cells) { const td = document.createElement('td'); td.textContent = cell.text ?? cell; if (cell.className) td.className = cell.className; tr.append(td); }
        return tr;
    };
    const ago = at => `${Math.round((performance.now() - at) / 1000)} s ago`;
    // ---- camera control on the Stream tab ------------------------------------------------
    // The same steering as on a camera's tile, in a small panel over the corner of the picture: for the camera on the
    // program, or any other that can be steered (to frame it before cutting to it).
    let panelCamera = null, panelFor = null, panelSteering = null;       // the one chosen (null: follow the program), the one shown, its controls
    function renderCameraPanel() {
        const list = cameraList.filter(canSteer), toggle = $('cameraControlToggle'), panel = $('cameraPanel');
        toggle.hidden = !list.length;
        if (!list.length) { panel.hidden = true; toggle.setAttribute('aria-pressed', 'false'); panelFor = null; panelSteering = null; return; }
        if (panel.hidden) return;
        const want = list.find(c => c.id === panelCamera) || list.find(c => c.id === programCameraId()) || list[0];
        const select = $('cameraPanelSelect'), key = list.map(c => c.id + ':' + c.name).join('|');
        if (select.dataset.key !== key) { select.replaceChildren(...list.map(c => new Option(c.name, c.id))); select.dataset.key = key; }
        if (select.value !== want.id) select.value = want.id;
        select.hidden = list.length < 2; $('cameraPanelName').textContent = list.length < 2 ? want.name : '';
        if (panelFor !== want.id) { panelFor = want.id; panelSteering = steeringControls(want.id); $('cameraPanelBody').replaceChildren(panelSteering.element); }
        panelSteering.positions(want.positions);
    }
    $('cameraControlToggle').onclick = () => {
        const panel = $('cameraPanel'); panel.hidden = !panel.hidden;
        $('cameraControlToggle').setAttribute('aria-pressed', String(!panel.hidden));
        if (panel.hidden) panelCamera = null;
        renderCameraPanel();
    };
    $('cameraPanelClose').onclick = () => $('cameraControlToggle').click();
    $('cameraPanelSelect').onchange = e => { panelCamera = e.target.value; renderCameraPanel(); };

    function render() {
        $('camerasLabel').textContent = cameraList.length > 1 ? 'Cameras' : 'Camera';         // one camera, or several
        renderCameraPanel();
        const camerasLive = renderCameras();
        const ready = {
            stream: renderProgram(),                                            // the program has a picture
            timer: connected('timer') && latest.blocks > 0 && !latest.stale,    // the console's clock is arriving
            events: rosters.heats > 0,                                          // start lists in hand
            cameras: camerasLive,                                               // a camera's picture is arriving
            theme: !!themes.active && themes.ready.overlay                      // the theme's overlay is up
        };
        // Stream is idle or live, never simulated: its badge is Live, and only when on air (not built yet).
        const simulatedTab = { stream: false, timer: sim.timer, events: sim.events, cameras: anyCameraSimulated(), theme: false };
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
        if (first) await refreshCameras();
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

    // ---- project -------------------------------------------------------------------------
    let project = { path: null, name: 'Untitled project', named: false };
    function renderProject() {
        $('projectButton').title = `Project: ${project.name}` + (project.path ? ` · ${project.path}` : ' · not saved yet');
        if (document.activeElement !== $('projectName')) $('projectName').value = project.named ? project.name : '';
        $('projectPath').textContent = project.path || 'Not saved yet.';
    }
    // The name is kept as soon as it is typed; the title bar follows. Enter keeps the dialog open.
    $('projectName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    $('projectName').addEventListener('change', async () => { try { project = await api.project.rename($('projectName').value); renderProject(); } catch (e) { showError(e); } });
    const projectAction = (what, fn) => async () => {
        hideError(); $('projectNote').textContent = what + '…';
        try { project = await fn(); renderProject(); $('projectNote').textContent = project.path ? `${what}: ${project.path}` : ''; }
        catch (e) { $('projectNote').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    };
    $('projectButton').onclick = () => { renderProject(); $('projectNote').textContent = ''; $('projectDialog').showModal(); };
    $('projectSave').onclick = projectAction('Saved', () => api.project.save());
    $('projectSaveAs').onclick = projectAction('Saved', () => api.project.saveAs());
    $('projectOpen').onclick = projectAction('Opened', () => api.project.open());
    $('projectNew').onclick = projectAction('New project', () => api.project.new());
    api.project.onChange(info => { project = info; renderProject(); });

    // ---- tabs ----------------------------------------------------------------------------
    function showTab(name, remember = true) {
        if (!TABS.includes(name)) name = TABS[0];
        tab = name;
        for (const t of TABS) { $(t).hidden = t !== name; $('tab-' + t).setAttribute('aria-selected', String(t === name)); }
        if (remember) api.store.set('tab', name).catch(() => {});
        if (name === 'cameras' && !found && !searching) findCameras();            // the Camera tab looks for cameras by itself, the first time it is opened
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
    $('manualAdd').onclick = () => openManual();
    $('manualClose').onclick = () => $('manualDialog').close();
    $('camAddButton').onclick = () => addCamera(false);
    // Enter adds, rather than closing the dialog as a form would.
    $('camUrl').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addCamera(false); } });
    $('camName').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); $('camUrl').focus(); } });
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
        try { project = await api.project.info(); } catch (e) { /* design mode */ } renderProject();
        programCamera = (await api.store.get('programCamera')) || null;
        const savedDrawer = await api.store.get('drawer');
        if (savedDrawer) { drawer.open = savedDrawer.open !== false; if (savedDrawer.width) { drawer.sized = true; $('drawer').style.width = savedDrawer.width + 'px'; } }
        showTab((await api.store.get('tab')) || 'stream', false);
        relay = await api.relay.status();
        engine = await api.cameras.status();
        for (const role of ROLES) links[role] = await api.serial.state(role);
        await applySim(await api.sim.state(), true);
        await refreshThemes();
        refreshDevices(false);
        // Real ports that were connected when the app last closed are connected again.
        for (const role of ROLES) if (!sim[PART_OF[role]] && remembered[role] && ports[role].some(p => p.path === remembered[role]) && links[role].state === 'closed') connect(role, remembered[role]);
        setInterval(refreshPorts, 3000);
        setInterval(refreshCameras, 3000);
        // Ten times a second: read the console, tell the theme, redraw. A failure in one must not stop the others.
        setInterval(() => {
            try { if (connected('timer')) latest = decoder.snapshot(performance.now() - timerStart); publish(); } catch (e) { showError(e); }
            render();
        }, 100);
        render();
    }
    init().catch(showError);
})();
