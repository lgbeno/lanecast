# Requirements: Spooky Splash

> What this theme is asked to be. The blank form is [themes/template/REQUIREMENTS.md](../template/REQUIREMENTS.md); how to use it is in [docs/agents/theme-requirements.md](../../docs/agents/theme-requirements.md). This one comes from a requirements document a swim club wrote for its Halloween meet (sections 1 to 6 are that document, rearranged into this form), and from the theme first built to it for an earlier overlay system.

| | |
| --- | --- |
| **For** | A club's Halloween meet, the "Spooky Splash Spectacular" |
| **Asked for by** | The club's meet director |
| **In one sentence** | Halloween at the pool: a bit silly, never scary |
| **Starts from** | [`clean`](../clean): its engine unchanged, `theme.css` rewritten, creatures added in `overlay.html` |

## 1. The idea

Pumpkins, ghosts, witches, a mummy, a zombie, bats, spider webs. The audience is families and the swimmers are children, some of them small: **not scary, fun for all ages.** No blood, no skulls, nothing that jumps at the viewer. The race information stays as easy to read as on a plain scoreboard; the Halloween is in the shapes around it.

## 2. Colours and type

Asked for: orange, yellow, brown, black, white, green, purple; "a spooky font".

| Use | Colour | Notes |
| --- | --- | --- |
| Panels behind text | night purple `#130e20` to `#201629`, 93 to 96% solid | |
| Text | bone white `#fff4df` | |
| Accent | pumpkin orange `#ff9b38`, violet `#b59aff` | Violet edges the boards; orange is the pumpkins and the first-place glow |
| The clock and splits | ghoulish green `#c2f790`, `#ddffb8` | |
| First, second, third | gold `#ffdc89`, silver `#d9e1f2`, bronze `#e7a87f` | The place number and the board's edge; first also gets a warm orange wash |
| Gravestones | grey-violet `#565066` to `#272332` | |
| Coffin | brass edge `#e0a25a`, wooden lid `#6a4426` | |

Type: Trebuchet MS for names; Georgia (a serif with some character) for numbers on the gravestones and places; Courier New for times, so the figures do not shift. All three are on every computer. See the open question about a spooky font.

## 3. The pool and the picture

| | |
| --- | --- |
| Lanes | 8 |
| Course | 25 yards |
| Where the camera stands | Along the side of the pool |
| Where the lanes are in the picture | Lane 1 at the bottom, counting upward; the lanes fill the lower 60% |
| What must stay uncovered | The swimmers. Creatures keep to the header and the strip just under it |

## 4. What is on screen

| Thing | Where | Shows | Looks like |
| --- | --- | --- | --- |
| Event number | Top left | "EVENT" over the number | A gravestone: rounded top, an inner carved line |
| Heat number | Beside it | "HEAT" over the number | A second gravestone |
| Event name | The rest of the top | The name; scrolls when too long | A coffin lying on its side, pointed at both ends, brass-edged; its wooden lid slides away to show the name |
| Clock | Top right, in the header | "RACE TIME" over the console's time | A mossy stone with a zombie beside the figures, bobbing as if running |
| Lane marker | The right-hand end of each lane | The lane number | A jack-o'-lantern with the number carved in it and lit from inside |
| Lane board | On each lane | Lineup: a small ghost, the name, the club. Split: the time. Finished: place, name, time | A night-purple bar with a violet edge |

## 5. What happens, and when

| When | Lanecast says | The viewer sees |
| --- | --- | --- |
| Nothing is on the board | `state.event` is `null` | Nothing at all |
| A new event comes up | `event.change` | The coffin's lid slides shut and open on the new name. A character, one of ghost, witch, zombie and mummy, crosses the header (see 6) |
| A heat is lined up | `heat.lineup`, `phase: "lineup"` | Names and clubs slide in from the pumpkins. The pumpkins of empty lanes smash and are gone. Any web is swept away |
| The race starts | `race.start`, `phase: "racing"` | The lineup boards swell and blur away like ghosts. The clock appears, zombie running. A character still crossing is removed |
| A swimmer turns | `lane.split` | The split, in green, beside that lane's pumpkin, for as long as the console shows it |
| A swimmer finishes | `lane.finish` | Place and finishing time on that lane's board |
| Everyone has finished | `heat.finish`, `phase: "finished"` | Every board shows place and time. A spider spins a web in the left corner under the gravestones and lets itself down on a thread. It fades after twelve seconds or when the next heat lines up |
| The last heat of the event is over | `event.finish` | A flock of bats crosses under the header |
| A false start or recall | `race.reset` | The clock goes; the lineup comes back |
| A lane nobody is in | no `name` on that lane | Nothing: no pumpkin, no board. If that lane shows a split or a finish after all, its pumpkin comes back with it |
| No start lists are loaded | no names or event name | Gravestones and clock; no coffin (or the meet's name in it, from the settings). Every lane keeps its pumpkin; splits and results show without names |

## 6. Characters and effects

| Effect | When | How long | Where it may go | How often |
| --- | --- | --- | --- | --- |
| A character crosses: ghost, witch (on a broom), zombie or mummy | A new event, and only when no race is on | 4 to 6 s | Along the header | Once an event. Each of the four appears once before any repeats, and never the same one twice running |
| Bats | The last heat of an event has finished | 6 s | The strip just under the header | Once an event |
| Spider and web | A heat has finished | Spun in 2.5 s; stays up to 12 s | The top-left corner under the gravestones | Once a heat |
| The timekeeper zombie bobs | While the clock shows | | Inside the clock's box | |

No creature ever crosses the lanes or covers a time. A viewer who has asked their computer for less motion gets no characters or bats.

## 7. Directing the picture

None.

## 8. Buttons for the person running the stream

| Button | Does |
| --- | --- |
| Header, Lane boards, Clock | Show or hide each |
| Send a character across | The next character crosses the header now (not during a race) |
| Release the bats | The flock crosses now (not during a race) |
| Spin a web | The spider spins its web now |
| Line up the lanes… | Opens the settings |

## 9. What changes from meet to meet

The shared scoreboard settings: lanes (8), lane 1 at the bottom, boards on the right, where the lanes start and end (41% / 100%), meet name.

## 11. Supplied material

| File | What | Where it came from, and the right to use it |
| --- | --- | --- |
| (none) | Every creature is a pixel map in `overlay.html`, drawn for this theme | Original to this theme |

## 12. Not wanted

- Nothing frightening: no blood, bones, weapons or sudden movement towards the viewer.
- No sound.
- Nothing over the swimmers, and no character in the header during a race.
- No club's or company's name or logo.

## 13. Checked

- [x] In the preview at the lineup, on a split, as swimmers finish and on the results (web spun, spider down)
- [x] A character crossing the header at a new event
- [x] With no event on the board, and with no start lists
- [x] A very long name; a very long event name (scrolls inside the coffin); ten lanes; six lanes on the left
- [ ] The bats and the three buttons: built, not looked at frame by frame
- [ ] Against a picture of the real pool

## Decisions and open questions

- 2026-11-09. The club asked for the web "in the left corner". It is in the top-left corner under the gravestones, not over the pool, so it can never cover a swimmer.
- 2026-11-09. The earlier system had a separate page of fifteen full-screen vignettes (a monster waving, a cauldron, a skeleton dance, a pumpkin portal and more) played at random between events. They are **not** in this theme: full-screen effects over the pool are the kind of thing section 12 rules out during a meet, and each is a piece of work of its own. The four header characters, the bats and the web are what the club's document actually asks for. Open: which, if any, of the vignettes are wanted back.
- 2026-11-09. "A spooky font" is not met. A display face needs a font file in the theme's folder and a licence that lets it ship; none was supplied. Georgia stands in. Open: a font to use.
- 2026-11-09. The club's document has the names "explode" as one option at the start. Here the lineup blurs away like a ghost; the explosion is kept for the pumpkins of empty lanes.
