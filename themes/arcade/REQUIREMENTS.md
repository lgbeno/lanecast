# Requirements: Arcade

> What this theme is asked to be. The blank form is [themes/template/REQUIREMENTS.md](../template/REQUIREMENTS.md); how to use it is in [docs/agents/theme-requirements.md](../../docs/agents/theme-requirements.md). This one was written after the fact, from an 8-bit theme its author built for an earlier overlay system.

| | |
| --- | --- |
| **For** | Any pool; a fun meet, an age-group meet, a relay carnival |
| **In one sentence** | The meet as an 8-bit platform game: every swimmer scores |
| **Starts from** | [`clean`](../clean): its engine unchanged, `theme.css` rewritten, a few effects added in `overlay.html` |

## 1. The idea

A home console from the 1980s: chunky blocks with hard black edges and a bevel, four loud colours, type with a black outline, things that bounce when they land. A finisher earns a coin; the winner gets the flashing high score. It must not look like any particular game: **no character, block, pipe or logo that belongs to a game company.** The earlier theme borrowed a famous plumber and his green pipes; this one keeps the idea and draws its own things.

## 2. Colours and type

| Use | Colour | Notes |
| --- | --- | --- |
| Lineup boards; second place | blue `#049cd8` | Solid, with a gold edge |
| Result boards; the clock | red `#e52521` | |
| Blocks (event, heat, lane markers); first place | yellow `#fbd000` to orange `#ff8800` | |
| Splits; third place | green `#43b047` | |
| The marquee | night blue `#10122b`, yellow bulbs, a red inner line | |
| Text | white, or yellow for numbers, always with a black outline | The outline is what makes it readable on any colour |

Type: Press Start 2P, a pixel face in which every character is as wide as it is tall, so type sizes are small for what they hold. The font file ships in the theme's folder (`fonts/`), with its licence beside it. The computer's monospaced face is the fallback.

## 3. The pool and the picture

As [Clean](../clean/REQUIREMENTS.md#3-the-pool-and-the-picture): 8 lanes to start with, the lower 60% of the picture, lane 1 at the bottom, boards on the right; all in the settings.

## 4. What is on screen

| Thing | Where | Shows | Looks like |
| --- | --- | --- | --- |
| Event number, heat number | Top left | "EVENT 12", "HEAT 1" | Yellow bevelled blocks |
| Event name | The rest of the top | The name; scrolls when too long | A lit marquee: bulbs chasing along its top and bottom |
| Clock | Top right | The console's time | A red block with a stopwatch whose hand goes round |
| Lane marker | The right-hand end of each lane | The lane number | A yellow block |
| Lane board | On each lane | Lineup: name, team. Split: the time. Finished: place, name, time | Blue for the lineup; red for a result; a green block for a split |
| Callout | Centred under the header | "GO!", "HEAT 1 CLEAR!", "EVENT 12 CLEAR!" | Big outlined letters that flash |

## 5. What happens, and when

| When | Lanecast says | The viewer sees |
| --- | --- | --- |
| Nothing is on the board | `state.event` is `null` | Nothing at all |
| A new event comes up | `event.change` | The numbers pop out and the new ones pop in. A duck waddles across under the header |
| A heat is lined up | `heat.lineup`, `phase: "lineup"` | Blue boards shoot in from the blocks with a little overshoot. The blocks of empty lanes break into bricks |
| The race starts | `race.start`, `phase: "racing"` | "GO!" for a second and a half. The lineup blinks out. The clock powers up |
| A swimmer turns | `lane.split` | A green block with the split drops in beside that lane's block |
| A swimmer finishes | `lane.finish` | A coin jumps out of the lane's block. The board shoots in: red; blue for second; green for third; gold and flashing for first, its place bouncing |
| Everyone has finished | `heat.finish`, `phase: "finished"` | "HEAT 1 CLEAR!" for three seconds. The clock powers down |
| The last heat of the event is over | `event.finish` | "EVENT 12 CLEAR!" after the heat's callout |
| A false start or recall | `race.reset` | The callout goes; the lineup comes back |
| A lane nobody is in | no `name` on that lane | Its block breaks and is gone; it comes back if the lane shows a time |
| No start lists are loaded | no names or event name | Blocks and clock; every lane keeps its block; splits and results without names |

## 6. Characters and effects

| Effect | When | How long | Where it may go | How often |
| --- | --- | --- | --- | --- |
| The duck | A new event | 6 s | The strip just under the header, left to right | Once an event |
| A coin | A swimmer finishes | Under a second | Above that lane's block | Once a finisher |
| The winner's board flashes | First place is on the board | Until the next heat | Its own board | |

## 7. Directing the picture

None.

## 8. Buttons for the person running the stream

Header, Lane boards, Clock (show or hide each); **Send the duck across**; Line up the lanes….

## 9. What changes from meet to meet

The shared scoreboard settings, as Clean.

## 11. Supplied material

| File | What | Where it came from, and the right to use it |
| --- | --- | --- |
| `fonts/PressStart2P-Regular.ttf` | The typeface | The Press Start 2P Project Authors, from the Google Fonts repository. SIL Open Font License 1.1 (`fonts/OFL.txt`), which allows it to be bundled and redistributed with the theme |
| (none) | The duck is a pixel map in `overlay.html`; everything else is CSS | Original to this theme |

## 12. Not wanted

- Any game company's characters, items, sounds or lettering.
- Sound.
- Anything over the swimmers.

## 13. Checked

- [x] In the preview at the lineup, on a split, as swimmers finish (coins) and on the results ("HEAT 1 CLEAR!")
- [x] The duck crossing at a new event
- [x] With no event on the board, and with no start lists
- [x] A very long name; a very long event name; ten lanes, in the pixel font
- [x] The font loading inside the app's strict frames, by the smoke run
- [ ] "GO!" at the start, and the boards on the left: built, not looked at
- [ ] Against a picture of a real pool

## Decisions and open questions

- 2026-11-09. Renamed from the earlier theme, and its borrowed character, question-mark blocks and green pipe replaced by a duck, plain blocks and a marquee. A theme that ships inside a public app cannot carry another company's characters.
- 2026-11-09. The earlier theme loaded the pixel font Press Start 2P from the internet. A Lanecast theme may not load anything from the internet, so the font file is in the theme's folder instead, which its licence (SIL Open Font License) allows. Sizes were set again for it: it is much wider than an ordinary face.
- 2026-11-09. The callouts under the header are new; the earlier theme had none.
