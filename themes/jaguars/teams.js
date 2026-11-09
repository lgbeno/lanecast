/* The schools this theme knows, each with its colours. Used by the overlay and by teams.html.
 *
 * Colour families were checked against the state association's directory; the hex values are an interpretation for
 * broadcast, darkened where needed so white type reads on them. A co-op uses its lead school's colours.
 *
 * A start list names a team by a short code (four characters from Meet Manager). Which code means which school differs
 * from meet to meet, so it is not guessed here: the person says, in the Team colours dialog, and that is saved with the
 * theme's settings. A full name or one of the spellings below also matches, exactly; nothing matches by resemblance.
 */
(function (root) {
    const teams = [
        ['ashwaubenon', 'Ashwaubenon', 'Jaguars', '#174b35', '#e8b949', []],
        ['antigo', 'Antigo', 'Red Robins', '#791c39', '#ffffff', []],
        ['clintonville', 'Clintonville', 'Truckers', '#98400d', '#181818', []],
        ['marinette', 'Marinette/Peshtigo', 'Marines', '#5c287b', '#ffffff', ['Marinette/Peshti', 'Marinette']],
        ['new-london', 'New London', 'Bulldogs', '#a32032', '#ffffff', []],
        ['notre-dame', 'Notre Dame/Green Bay N.E.W. Lutheran', 'Tritons', '#204ba0', '#38a65a', ['Notre Dame/N.E.W. Lutheran', 'Notre Dame/N.E.W', 'Notre Dame']],
        ['pulaski', 'Pulaski', 'Red Raiders', '#b02331', '#ffffff', []],
        ['shawano', 'Shawano/Bonduel', 'Hawks', '#a12332', '#151515', ['Shawano']],
        ['seymour', 'Seymour/Freedom', 'Thunder', '#a61f32', '#ffffff', ['Seymour']],
        ['sturgeon-bay', 'Sturgeon Bay/Sevastopol/Southern Door', 'Clippers', '#a12035', '#ffffff', ['Sturgeon Bay Co-op', 'Sturgeon Bay']],
        ['two-rivers', 'Two Rivers/Roncalli', 'Purple Raiders', '#57277b', '#e8bc42', ['Two Rivers/Ronc', 'Two Rivers']],
        ['wausau-east', 'Wausau East', 'Lumberjacks', '#a62032', '#ffffff', []],
        ['wittenberg', 'Wittenberg-Birnamwood', 'Chargers', '#225637', '#e8bc42', ['Witt-Birn', 'Wittenberg Birnamwood']]
    ].map(([id, name, mascot, primary, secondary, aliases]) => ({ id, name, mascot, primary, secondary, aliases }));
    const normalize = value => String(value == null ? '' : value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
    const byName = new Map();
    for (const team of teams) for (const name of [team.name, ...team.aliases]) byName.set(normalize(name), team);
    /** The school a start list's team means: by the codes the person assigned ({ code: school id }), else by exact name. */
    function match(value, codes) {
        const key = normalize(value); if (!key) return null;
        for (const [code, id] of Object.entries(codes || {})) if (normalize(code) === key) return teams.find(t => t.id === id) || null;
        return byName.get(key) || null;
    }
    root.JaguarTeams = { teams, normalize, match };
})(window);
