/* The packet Lanecast emits to overlays: one scoreboard state, built from the timer's
 * snapshot and the start lists. Plain JSON, one object per message, documented in
 * docs/architecture.md. Fields hold what the console displays; a lane's `time` is the
 * time on its display, which may be a split or a finish, and `place` the displayed place.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Packet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const VERSION = 1;
    /** @param snapshot CTS.Decoder#snapshot()  @param rosters GENSER.RosterStore#view(), a Map by event number */
    function scoreboard(snapshot, rosters) {
        const roster = rosters.get(snapshot.event), heat = roster?.heats[snapshot.heat - 1];
        return {
            v: VERSION, type: 'scoreboard',
            event: snapshot.event, heat: snapshot.heat, title: roster?.title || '',
            clock: snapshot.clock, state: snapshot.state,
            lanes: snapshot.lanes.map((lane, i) => {
                const athlete = heat?.[i];
                return { lane: i + 1, name: athlete?.name || '', team: athlete?.team || '',
                    time: lane.time, place: lane.place, followsClock: lane.followsClock };
            })
        };
    }
    return { VERSION, scoreboard };
});
