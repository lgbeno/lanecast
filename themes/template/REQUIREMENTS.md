# Requirements: <theme name>

> What this theme is asked to be. Fill it in **before** building, with the person who wants the theme; keep it in the theme's folder and keep it true as the theme changes. How to use it: [docs/agents/theme-requirements.md](../../docs/agents/theme-requirements.md). Delete any section that does not apply, and write "not decided" rather than guessing.

| | |
| --- | --- |
| **For** | <the club, the meet, the date> |
| **Asked for by** | <who decides whether it is right> |
| **In one sentence** | <what a viewer should think when they see it> |
| **Starts from** | <`template`, `clean`, another theme, or nothing> |

## 1. The idea

<Two or three sentences. The mood, the motifs, who is watching. And what it must **not** be: too scary for small children, too busy to read a time, anything that could be mistaken for another club's or a company's branding.>

## 2. Colours and type

| Use | Colour | Notes |
| --- | --- | --- |
| Panels behind text | <#hex> | <how solid: text has to be readable over bright water> |
| Text | <#hex> | |
| Accent | <#hex> | <what it marks> |
| First, second, third | <#hex, #hex, #hex> | |

Type: <the face for names, the face for times (times need figures of equal width), and where the font files come from. A font has to be in the theme's folder or already on every computer; say what licence lets it be shipped.>

## 3. The pool and the picture

| | |
| --- | --- |
| Lanes | <6, 8, 10> |
| Course | <25 yards, 25 metres, 50 metres> |
| Where the camera stands | <along the side, behind the blocks, high in the stands> |
| Where the lanes are in the picture | <lane 1 at the bottom counting up; the lanes fill the lower 60%; the finish is on the right> |
| What must stay uncovered | <the swimmers in the middle of the picture, the scoreboard on the wall> |
| Cameras, by the names on the Camera tab | <Wide, Finish> |
| Saved positions of a camera that steers | <Whole pool, Blocks, Finish line> |

## 4. What is on screen

One row for each thing the theme draws.

| Thing | Where | Shows | Looks like |
| --- | --- | --- | --- |
| <Event number> | <top left> | <"Event 12"> | <…> |
| <Heat number> | | | |
| <Event name> | | <scrolls when too long for its box> | |
| <Clock> | | <the console's running time; only while racing> | |
| <Lane marker> | <the end of each lane> | <the lane number> | |
| <Lane board> | <on each lane> | <name and team; split; place and time> | |

## 5. What happens, and when

The left column is everything Lanecast tells a theme ([the messages](../../docs/agents/theme-messages.md)). Say what the viewer sees for each; "nothing" is an answer.

| When | Lanecast says | The viewer sees |
| --- | --- | --- |
| Nothing is on the board | `state.event` is `null` | <nothing at all> |
| A new event comes up | `event.change` | |
| A heat is lined up | `heat.lineup`, `phase: "lineup"` | |
| The race starts | `race.start`, `phase: "racing"` | |
| A swimmer turns | `lane.split` | |
| A swimmer finishes | `lane.finish` | |
| Everyone has finished | `heat.finish`, `phase: "finished"` | |
| The last heat of the event is over | `event.finish` | |
| A false start or recall | `race.reset` | |
| A lane nobody is in | no `name` on that lane | |
| No start lists are loaded | no names or event name anywhere | <what still shows: lane numbers, times, places> |

## 6. Characters and effects

| Effect | When | How long | Where it may go | How often |
| --- | --- | --- | --- | --- |
| <a ghost crosses the header> | <a new event> | <5 s> | <the header strip only> | <once an event> |

<Anything that moves a lot: say whether it may ever cover a swimmer, a name or a time (usually never).>

## 7. Directing the picture

Only if the theme should cut cameras, move one, or shrink the picture. The theme has to work with none of these names set up.

| When | Camera | Position | Picture |
| --- | --- | --- | --- |
| <race start> | <Finish> | <—> | <full> |
| <heat finished> | <Wide> | <Whole pool> | <full> |

## 8. Buttons for the person running the stream

| Button | Does |
| --- | --- |
| <Header> | <shows or hides the header> |

## 9. What changes from meet to meet

Belongs in the theme's settings dialog, not in its code.

| Setting | Kind | Starts as |
| --- | --- | --- |
| <Meet name> | <text> | <empty> |

## 10. Teams

Only if teams get their own colours or logos. Names exactly as they come in the start lists, with every spelling that should match.

| Team | Also written | Colours | Logo |
| --- | --- | --- | --- |
| | | | |

A team that is not in the table: <keeps its name, in the theme's ordinary colours>.

## 11. Supplied material

| File | What | Where it came from, and the right to use it |
| --- | --- | --- |
| | | |

## 12. Not wanted

- <No sound.>
- <Nothing full-screen during a race.>
- <No real swimmers' names in the theme's files.>

## 13. Checked

How it was looked at before it was called done, and what was not checked.

- [ ] In the preview at the lineup, mid-race and on the results
- [ ] With no event on the board, and with no start lists
- [ ] A very long name; ten lanes
- [ ] Against a picture of the real pool
- [ ] <anything particular to this theme>

## Decisions and open questions

<Dated notes: what was chosen where the request left a choice, what was changed from what was first asked and why, and what is still waiting on the person.>
