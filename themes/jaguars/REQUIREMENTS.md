# Requirements: Jaguars

> What this theme is asked to be. The blank form is [themes/template/REQUIREMENTS.md](../template/REQUIREMENTS.md); how to use it is in [docs/agents/theme-requirements.md](../../docs/agents/theme-requirements.md). This one was written after the fact, from the theme its author built for a high-school sectional meet on an earlier overlay system, and that theme's notes.

| | |
| --- | --- |
| **For** | Ashwaubenon High School (the Jaguars) hosting a girls' swimming and diving sectional: thirteen programs in one pool |
| **In one sentence** | A broadcast that looks like the host school's, and tells you at a glance which school every swimmer is from |
| **Starts from** | [`clean`](../clean): its engine unchanged, `theme.css` rewritten, the school table and its dialog added |

## 1. The idea

A championship meet, treated seriously: forest green and gold, dark solid panels, large finish times, short plain movements. The one flourish is identity: each lane is edged in its swimmer's school colour and names the school on a chip of that colour, so a parent finds their team without reading. No mascot art for other schools, no full-screen effects, nothing that flashes.

## 2. Colours and type

| Use | Colour | Notes |
| --- | --- | --- |
| Panels behind text | green `#173f30` into near-black `#081d17`, solid | A 3 px gold foot on every panel |
| Text | warm white `#fffdf2` | |
| Accent | gold `#e8b949` | Numbers in the header, lane numbers, the meet's name, first place |
| Second, third | `#d9e4ef`, `#eeb78b` | The place number only |
| A school | its own two colours, from the table in section 10 | Edge of the board and the chip; the second colour is the chip's end |
| A school not in the table | grey `#394c44` / `#bdc7c1` | |

Type: Arial, heavy weights. Finish times are the largest thing on a board, in figures of equal width.

## 3. The pool and the picture

As [Clean](../clean/REQUIREMENTS.md#3-the-pool-and-the-picture): 8 lanes, the lower 60% of the picture, lane 1 at the bottom, boards on the right; all in the settings.

## 4. What is on screen

| Thing | Where | Shows | Looks like |
| --- | --- | --- | --- |
| Event number, heat number | Top left | "EVENT 12", "HEAT 1" | Green panels, gold numbers |
| Event name | The rest of the top | The name; scrolls when too long | A lighter green panel |
| Clock | Top right | "TIME" and the console's time | The darkest panel, the largest figures in the header |
| Meet strip | Hung under the header's left end | The meet's name, from the settings, after a three-slash claw mark | Near-black with a gold left edge. Not shown when no meet name is set |
| Lane marker | The right-hand end of each lane | The lane number | A green tile, gold number |
| Lane board | On each lane | Lineup: the name, and under it the school on its chip. Split: "SPLIT" and the time. Finished: place; name over school chip; time | Edged on the left in the school's colour |

## 5. What happens, and when

| When | Lanecast says | The viewer sees |
| --- | --- | --- |
| Nothing is on the board | `state.event` is `null` | Nothing at all |
| A new event comes up | `event.change` | The numbers slip out and in |
| A heat is lined up | `heat.lineup`, `phase: "lineup"` | Each swimmer's name and school, in the school's colours |
| The race starts | `race.start`, `phase: "racing"` | The lineup slips away; the clock arrives |
| A swimmer turns | `lane.split` | "SPLIT" and the time beside the lane's number |
| A swimmer finishes | `lane.finish` | Place, name, school and a large time. First place has a gold place number and a faint gold wash |
| Everyone has finished | `heat.finish`, `phase: "finished"` | The clock goes; results stay until the next heat |
| The last heat of the event is over | `event.finish` | Nothing more |
| A false start or recall | `race.reset` | The clock goes; the lineup comes back |
| A lane nobody is in | no `name` on that lane | No number and no board, without any burst |
| No start lists are loaded | no names, teams or event name | Header and clock; lane numbers; splits and results without names or schools |

Every movement is a 16 px slide and a fade, a third of a second.

## 6. Characters and effects

None.

## 7. Directing the picture

None.

## 8. Buttons for the person running the stream

Header, Lane boards, Clock (show or hide each); **Team colours…** (opens the dialog in section 10); Line up the lanes….

## 9. What changes from meet to meet

| Setting | Kind | Starts as |
| --- | --- | --- |
| Meet name | text; shown on the meet strip | empty |
| Which team code is which school | one choice per code, in the Team colours dialog | none |
| The shared scoreboard settings | as Clean | |

## 10. Teams

Start lists name a team by a short code (four characters from Meet Manager). Which code means which school differs from meet to meet, so **the theme does not guess**: the Team colours dialog lists every code the theme has seen in this meet's start lists and the person picks the school for each. A full name, or one of the spellings below, also matches by itself. Matching is exact once case, spaces and punctuation are ignored; nothing matches because it looks similar.

| Team | Mascot | Also written | Colours |
| --- | --- | --- | --- |
| Ashwaubenon | Jaguars | | `#174b35` `#e8b949` |
| Antigo | Red Robins | | `#791c39` `#ffffff` |
| Clintonville | Truckers | | `#98400d` `#181818` |
| Marinette/Peshtigo | Marines | Marinette/Peshti, Marinette | `#5c287b` `#ffffff` |
| New London | Bulldogs | | `#a32032` `#ffffff` |
| Notre Dame/Green Bay N.E.W. Lutheran | Tritons | Notre Dame/N.E.W. Lutheran, Notre Dame/N.E.W, Notre Dame | `#204ba0` `#38a65a` |
| Pulaski | Red Raiders | | `#b02331` `#ffffff` |
| Shawano/Bonduel | Hawks | Shawano | `#a12332` `#151515` |
| Seymour/Freedom | Thunder | Seymour | `#a61f32` `#ffffff` |
| Sturgeon Bay/Sevastopol/Southern Door | Clippers | Sturgeon Bay Co-op, Sturgeon Bay | `#a12035` `#ffffff` |
| Two Rivers/Roncalli | Purple Raiders | Two Rivers/Ronc, Two Rivers | `#57277b` `#e8bc42` |
| Wausau East | Lumberjacks | | `#a62032` `#ffffff` |
| Wittenberg-Birnamwood | Chargers | Witt-Birn, Wittenberg Birnamwood | `#225637` `#e8bc42` |

A matched team is written by its full name, so every school of a co-op is visible. A team that is not in the table keeps the name the start list gave it, on a grey chip. The table is `teams.js`; colour families were checked against the state association's directory, and the exact values are an interpretation for the screen.

## 11. Supplied material

| File | What | Where it came from, and the right to use it |
| --- | --- | --- |
| `claws.svg` | Three gold slashes | Drawn for the earlier theme by its author. Not the school's logo |

## 12. Not wanted

- Any school's actual logo or mascot artwork (none was supplied, and each belongs to its school).
- Full-screen effects, flashing, sound.
- Guessed team matches. A wrong school's colours on a swimmer is worse than none.

## 13. Checked

- [x] In the preview at the lineup, on a split, as swimmers finish and on the results, with three of the preview's team codes assigned to schools and one left unmatched
- [x] With no event on the board, and with no start lists
- [x] A very long name; a three-school co-op's name on a chip; ten lanes; six lanes on the left
- [x] The school table's matching rules, by a unit test
- [ ] The Team colours dialog in the app with a real meet's start lists
- [ ] Against a picture of the real pool

## Decisions and open questions

- 2026-11-09. The earlier theme matched schools by their full names and left a blank table for codes "to add after checking the meet's export". Lanecast's start lists carry only the codes, so the table of codes became a dialog the person fills in at the pool, with the codes offered as they are seen.
- 2026-11-09. The earlier theme had the sectional's title and dates written into the page. Here the meet's name is a setting and no date is shown.
- 2026-11-09. Ashwaubenon's own chip is green on a green board. It has a faint outline and its gold end so it still reads as a chip.
