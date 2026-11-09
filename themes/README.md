# Themes

The built-in themes. Each is a folder with a `theme.json`, an `overlay.html` drawn over the picture, and perhaps a `control.html` shown in the Stream tab. `lanecast-theme.js` is the runtime every theme page loads with `<script src="../lanecast-theme.js"></script>`.

- `classic/` — a lower third: event and heat, title, clock, lanes; lineup before the start, places and times after; a banner when a heat or event finishes.
- `clean/` — the plain scoreboard laid over the pool: event, heat, the event's name and the clock across the top, and a board on each lane. Its `scoreboard.js`, `scoreboard.css`, `control.html` and `settings.html` are shared, unchanged, by every theme of that kind (the next three); the look is all in `theme.css`. Each has a `REQUIREMENTS.md` saying what it was asked to be.
- `arcade/` — the scoreboard as an 8-bit game: bevelled blocks, a lit marquee, a coin for every finisher, a flashing high score for the winner, a duck at each new event.
- `jaguars/` — a school's championship look in green and gold, with every swimmer's school in its own colours; a dialog says which team code is which school.
- `spooky/` — Spooky Splash, for a Halloween meet: gravestones, a coffin that slides open, jack-o'-lantern lane numbers, a ghost, witch, zombie or mummy crossing at each new event, a spider's web when a heat is done.
- `template/` — the starting point for your own: everything commented, a control panel, a settings dialog (colours, meet name, logo) saved per theme, the camera directed from the theme. **Theme tab → New theme…** copies it into your themes folder (or any other theme you pick under **Start from**), with a blank `REQUIREMENTS.md`: the form for writing down what a theme should be before building it.

- `preview.html` — see a theme react to a race without the app or a meet: open `preview.html?theme=template` in a browser. It plays a scripted heat into the theme and logs what the theme asks the app to do.

Your own themes do not go here; they live in the app's data folder (**Theme tab → Open folder**, beside the theme in use). How to write one, with every message spelled out: [docs/themes.md](../docs/themes.md). An AI assistant can do most of the work: point it at [AGENTS.md](../AGENTS.md), which leads to the documents written for it in [docs/agents/](../docs/agents/).
