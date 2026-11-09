# Requirements: Clean

> What this theme is asked to be. The blank form is [themes/template/REQUIREMENTS.md](../template/REQUIREMENTS.md); how to use it is in [docs/agents/theme-requirements.md](../../docs/agents/theme-requirements.md). This one was written after the fact, from the plain theme its author built for an earlier overlay system, so that the port had something to be checked against.

| | |
| --- | --- |
| **For** | Any pool, any meet. The theme other "scoreboard on the lanes" themes start from |
| **In one sentence** | A scoreboard that could belong to any club: nothing to like or dislike, every number easy to read |
| **Starts from** | Nothing. It is where `scoreboard.js` and `scoreboard.css` come from |

## 1. The idea

The whole meet's information laid over the pool itself: a strip across the top says which race this is, and each lane carries its own board, so a viewer never has to match a lane number in a table to a swimmer in the water. Plain on purpose. Not a club's theme: no logo, no colour that belongs to anyone.

## 2. Colours and type

| Use | Colour | Notes |
| --- | --- | --- |
| Panels behind text | black, 84% solid (`rgba(8, 12, 18, .84)`) | The lineup's panels are a little lighter (70%), so results read as the stronger statement |
| Text | white, 96%; secondary text 80% | |
| First, second, third | gold `#ffd700`, silver `#cdd2d7`, bronze `#cd7f32` | A tint that fades across the board from the place towards the time, not a solid fill |

Type: Arial (on every computer; no file to ship). Names and labels in capitals. Times and the clock in figures of equal width, so they do not shiver as they count.

## 3. The pool and the picture

| | |
| --- | --- |
| Lanes | 8 to start with; 4 to 10 in the settings |
| Where the camera stands | Along the side of the pool, looking across it |
| Where the lanes are in the picture | The lower 60%, lane 1 at the bottom, the boards on the right. All four can be changed in the settings |
| What must stay uncovered | The left and middle of the lanes, where the swimmers are, and everything between the header and the lanes |

## 4. What is on screen

| Thing | Where | Shows | Looks like |
| --- | --- | --- | --- |
| Event number | Top left, 170 px wide | "EVENT 12" | A dark box, small label, large number |
| Heat number | Beside it, 130 px | "HEAT 1" | The same |
| Event name | The rest of the top, up to the clock | "GIRLS 11-12 100 FREE"; scrolls round when too long | The same; centred |
| Clock | Top right, 264 px | "TIME 0:14.3" | The same; the largest figures in the header |
| Lane marker | The right-hand end of each lane | The lane number | A small dark square |
| Lane board | On each lane, growing leftwards from the marker | Before the start: name, team. A split: the time alone. Finished: place, name, time | A dark bar the height of the lane |

Drawn on a 1920 x 1080 canvas: header 20 px from the top and sides and 70 px tall; boards 760 px wide.

## 5. What happens, and when

| When | Lanecast says | The viewer sees |
| --- | --- | --- |
| Nothing is on the board | `state.event` is `null` | Nothing at all |
| A new event comes up | `event.change` | The event and heat numbers lift out and the new ones drop in; the name changes |
| A heat is lined up | `heat.lineup`, `phase: "lineup"` | Each lane with a swimmer grows a board from its marker: name and team. The markers of empty lanes burst and are gone |
| The race starts | `race.start`, `phase: "racing"` | The lineup boards fade out at once. The clock grows in at the top right |
| A swimmer turns | `lane.split` | A short board with the split grows from that lane's marker and stays as long as the console shows the split |
| A swimmer finishes | `lane.finish` | That lane's board grows in with place, name and time. First, second and third are tinted |
| Everyone has finished | `heat.finish`, `phase: "finished"` | The clock shrinks away. The results stay until the next heat is lined up |
| The last heat of the event is over | `event.finish` | Nothing more |
| A false start or recall | `race.reset` | The clock goes; the lineup comes back |
| A lane nobody is in | no `name` on that lane | No marker and no board. If that lane shows a time after all, its marker comes back |
| No start lists are loaded | no names or event name | Header without a name box (or with the meet's name, if the settings have one). Every lane keeps its marker. Splits, and results with place and time but no name |

## 6. Characters and effects

None. Every movement is a box arriving or leaving, under half a second.

## 7. Directing the picture

None. The theme never cuts, moves or shrinks the camera.

## 8. Buttons for the person running the stream

| Button | Does |
| --- | --- |
| Header | Shows or hides the strip across the top |
| Lane boards | Shows or hides everything on the lanes |
| Clock | Shows or hides the clock |
| Line up the lanes… | Opens the settings |

## 9. What changes from meet to meet

| Setting | Kind | Starts as |
| --- | --- | --- |
| Lanes | 4 to 10 | 8 |
| Lane 1 is at the | bottom or top | bottom |
| Boards are on the | left or right | right |
| Top lane starts at / bottom lane ends at | share of the picture's height | 41% / 100% |
| Meet name | text, shown when an event has no name | empty |

The three buttons above are remembered too.

## 12. Not wanted

- No sound, no characters, nothing full-screen.
- Nothing that says whose meet it is.

## 13. Checked

- [x] In the preview at the lineup, on a split, as swimmers finish and on the results
- [x] With no event on the board, and with no start lists
- [x] A very long name; ten lanes; six lanes
- [ ] Against a picture of a real pool: not done here. The first thing to do at a pool is open **Line up the lanes…** and drag the two ends until each board sits on its lane

## Decisions and open questions

- 2026-11-09. The earlier theme was three separate pages (header, lanes, clock) composed in a video mixer. Here it is one overlay, with the clock in the header's last box.
- 2026-11-09. The panels are more solid than the original's 70% (and the text whiter than its 70% white), because the original was hard to read over bright water.
- 2026-11-09. The earlier theme showed a split for a share of the split's own length. Here it shows for as long as the timing console shows it, so the picture never disagrees with the scoreboard on the wall.
