/* What Lanecast tells a theme (and any overlay on the WebSocket feed): a state message whenever
 * the scoreboard changes, and an event message when something happens (heat lined up, race
 * started, lane finished, heat finished, event finished…). Plain JSON, one object per message.
 * Documented for theme authors in docs/themes.md.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Packet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const VERSION = 2;
    /** The whole picture of the scoreboard right now.
     *  @param snapshot CTS.Decoder#snapshot()  @param rosters GENSER.RosterStore#view(), a Map by event number
     *  @param extra { phase, cameras, camera } from the host: where the race is, which cameras there are, which is on. */
    function state(snapshot, rosters, extra = {}) {
        const roster = rosters.get(snapshot.event), heat = roster?.heats[snapshot.heat - 1];
        return {
            type: 'state', v: VERSION,
            event: snapshot.event, heat: snapshot.heat, heats: roster?.heats.length || 0, title: roster?.title || '',
            clock: snapshot.clock, running: snapshot.state === 'running', phase: extra.phase || 'idle',
            lanes: snapshot.lanes.map((lane, i) => {
                const athlete = heat?.[i];
                return { lane: i + 1, name: athlete?.name || '', team: athlete?.team || '',
                    time: lane.time, place: lane.place ? Number(lane.place) || lane.place : null, followsClock: lane.followsClock };
            }),
            cameras: extra.cameras || [], camera: extra.camera || null
        };
    }
    /** One thing that happened, from Events.Tracker, as a message. */
    function event(e) { return { type: 'event', v: VERSION, ...e }; }
    return { VERSION, state, event };
});
