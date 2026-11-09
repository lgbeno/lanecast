# Themes

The built-in themes. Each is a folder with a `theme.json`, an `overlay.html` drawn over the picture, and perhaps a `control.html` shown in the Stream tab. `lanecast-theme.js` is the runtime every theme page loads with `<script src="../lanecast-theme.js"></script>`.

- `classic/` — a lower third: event and heat, title, clock, lanes; lineup before the start, places and times after; a banner when a heat or event finishes.
- `template/` — the starting point for your own: everything commented, a control panel, a settings dialog (colours, meet name, logo) saved per theme, the camera directed from the theme. **Theme tab → New theme…** copies it into your themes folder.

- `preview.html` — see a theme react to a race without the app or a meet: open `preview.html?theme=template` in a browser. It plays a scripted heat into the theme and logs what the theme asks the app to do.

Your own themes do not go here; they live in the app's data folder (**Theme tab → Open folder**, beside the theme in use). How to write one, with every message spelled out: [docs/themes.md](../docs/themes.md). An AI assistant can do most of the work: point it at [AGENTS.md](../AGENTS.md), which leads to the documents written for it in [docs/agents/](../docs/agents/).
