# Writing down what a theme should be: a guide for AI agents

A theme goes wrong long before any code is written: when "a Halloween theme" is taken as enough to start on. This page is about the step before building: getting what the person wants onto one page, in a shape that the next agent (or you, tomorrow, with no memory of today) can build from and check against.

**The form:** [`themes/template/REQUIREMENTS.md`](../../themes/template/REQUIREMENTS.md). A copy lands in every theme started with **Theme tab → New theme…**, under the new theme's name. A theme started from another (the dialog's **Start from**) also gets `STARTED-FROM.md`: the requirements of the theme it was copied from, which is what the copy does until you change it. Read that, fill in the form with what should be different, and delete `STARTED-FROM.md` when the form says everything.

**Filled in, four times.** Read one before filling in your own:

| Theme | Its requirements show |
| --- | --- |
| [Clean](../../themes/clean/REQUIREMENTS.md) | The shortest. A plain scoreboard; every row of the moments table answered |
| [Spooky Splash](../../themes/spooky/REQUIREMENTS.md) | A club's own written brief turned into the form: characters and effects with rules about where they may go, and a list of what was asked for but not built |
| [Jaguars](../../themes/jaguars/REQUIREMENTS.md) | Teams: thirteen schools with colours and spellings, and what happens to a team that is not in the table |
| [Arcade](../../themes/arcade/REQUIREMENTS.md) | A look borrowed from somewhere, and the line it must not cross |

## When to use it

| The request | Do |
| --- | --- |
| A new theme, or "make it look like …" | Fill in the form first. Show it to the person. Build when they say it is right |
| A change to a theme that has a `REQUIREMENTS.md` | Read it first. Change it in the same piece of work as the code, so it stays true |
| A change to a theme that has none | Small change: just make it. Large one: write the form from the theme as it is, then change both |
| "Move that box left a bit" | No form. Do it |

## How to fill it in

1. **Start from what you were given.** A message, a sketch, a document, last year's theme, the club's website. Put every fact it contains in the form before asking anything.
2. **Ask only for what is missing and matters.** The form's blanks are the questions. Ask the ones the theme cannot be built without (what is on screen and when; the colours; the pool) and decide the rest yourself.
3. **Write your own decisions down as decisions.** Where you chose because nobody said, add a dated line under *Decisions and open questions*. The person reads that list and corrects what they care about; that is quicker for them than twenty questions.
4. **Fill in section 5 completely.** The table of moments is the part people skip and the part that decides whether the theme feels finished. Every row gets an answer, even if the answer is "nothing". The rows people forget: a lane nobody is in, no start lists, a false start.
5. **Say what it must not be.** "Not scary." "Never covers a swimmer." "Nothing that looks like another club." One line here prevents the largest rework.
6. **Keep real people out of it.** Team names and colours belong in the form. Swimmers' names do not: use invented ones in examples.

A good form can be read in three minutes and leaves no question whose answer would change what you build.

## From the form to a theme

| The form says | Start from | You write |
| --- | --- | --- |
| A header across the top and a board on each lane | [`themes/clean`](../../themes/clean): copy the folder | `theme.css` (the whole look), and a few lines in `overlay.html` for anything that moves on its own |
| Anything else: a lower third, a results table, a corner clock, picture-in-picture | [`themes/template`](../../themes/template) | `overlay.html` |

Then map the form onto the build, section by section:

| Section | Becomes |
| --- | --- |
| 2. Colours and type | Custom properties at the top of the stylesheet. Font files in the theme's folder |
| 3. The pool and the picture | Settings with the pool's values as their defaults, never numbers in the code: the next pool is different |
| 4. What is on screen | The elements. One per row of the table |
| 5. What happens, and when | Drawing from `state` for what is true now, and one `Lanecast.on(…)` per row for what just happened ([messages](theme-messages.md)) |
| 6. Characters and effects | Elements of their own, above the boards, that never take a click and never cover a time |
| 7. Directing the picture | `Lanecast.camera`, `Lanecast.position`, `Lanecast.layout`, each one harmless when the name is not set up ([cookbook](theme-cookbook.md#cut-cameras-with-the-race)) |
| 8. Buttons | The control panel |
| 9. What changes from meet to meet | The settings dialog, saved with `Lanecast.saveSettings` |
| 10. Teams | A table in a file of its own, matched exactly; a team not in it keeps the ordinary look |
| 12. Not wanted | Things to check for at the end |
| 13. Checked | What you actually looked at. Tick only what you saw |

## The scoreboard themes

`themes/clean` and the themes made from it (`arcade`, `jaguars`, `spooky`) share four files, byte for byte: `scoreboard.js` (builds the header and a row per lane and keeps them in step with the race), `scoreboard.css` (where everything sits), `control.html` and `settings.html` (show and hide; the number of lanes and where they are in the picture). A theme of this kind is those four files unchanged, plus:

- `theme.css`: every colour, font and animation. The classes it may style are listed at the top of [`scoreboard.js`](../../themes/clean/scoreboard.js). Each piece is hidden until it is given `.visible`, and has `.hiding` while it leaves: the theme writes the two animations.
- `overlay.html`: loads the files and calls `Scoreboard.start({ … })`, with the theme's own lane markers, wording for places, and buttons. Characters and effects go here, driven by `Lanecast.on(…)`.

They are drawn on a fixed 1920 x 1080 canvas that the engine scales to the picture, so their stylesheets are in pixels and em rather than `vh`; [`scoreboard.css`](../../themes/clean/scoreboard.css) says which where.
