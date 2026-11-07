# Meet Manager scoreboard link (GENSER)

What Lanecast reads from HY-TEK Meet Manager's **generic scoreboard** serial interface: start lists, one heat per record. Reconstructed from a capture of a live link between Meet Manager and a scoreboard computer, with a monitor inline forwarding both directions. It is not HY-TEK's specification, which HY-TEK gives to scoreboard vendors on request. Implementation: `src/protocol/genser.js`.

## Line settings

9600 baud, 8 data bits, no parity, 1 stop bit as observed; Meet Manager lets the operator configure this, so both ends must match. Lanecast only listens by default.

## The conversation

The scoreboard computer asks for one heat at a time; Meet Manager answers with one record, or with silence when that heat does not exist. The scoreboard computer walks the whole meet this way (heat 1, 2, 3 of an event until one goes unanswered, then the next event), about 0.67 s per request, a reply beginning about 16 ms after it. An answered request takes ~0.65 s, an unanswered one ~0.88 s. A full walk of a 99-event meet takes about four minutes; it repeats every few minutes and whenever the scoreboard operator acts.

The operator can also push a start list at any time, in the same layout. A reader should therefore find records in the stream directly rather than pair them with requests.

### Request, 8 bytes

```text
STX  E E E  H H  T  EOT
02   30 30 32  30 31  31  04      event 2, heat 1; T = request type, always 1 in the capture
```

### Reply, 502 bytes

Plain ASCII, fixed width, space padded, no checksum, no terminator: the next record begins with its own carriage return.

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 1 | CR |
| 1 | 1 | request counter, modulo 10 |
| 2 | 4 | `0120` in every record; meaning unknown |
| 8 | 28 | event name |
| 38 | 30 | round, e.g. `Timed Finals` |
| 68 | 1 | gender: `G`, `B`, `X` |
| 70 | 28 | abbreviated event name |
| 116 | 380 | ten lane slots of 38 characters |
| 496 | 3 | event number, right aligned |
| 499 | 3 | heat number, right aligned |

Each lane slot: lane digit (space when empty), swimmer as `Last, First` or relay name cut to 20 characters, 4-character team code, 13 blank characters. Text is Windows-1252.

## Which wire

The two directions are separate RS-232 conductors. A single-adapter tap sees one of them:

- **Meet Manager's transmit line** carries the 502-byte records: this is the one to tap. Every record names its own event and heat, so this wire alone recovers every start list.
- **The scoreboard computer's line** carries only 8-byte requests. Lanecast recognises these and says so ("this is the scoreboard computer's line") so the tap can be moved.

Two things are invisible from the transmit line: heats that do not exist (silence), and anything nobody asked for. A listener that starts after the walk sees nothing until the next one, which is why Lanecast keeps start lists on disk, and why Meet Manager's `.scb` export files can be loaded as a fallback.

## Start-list files

Meet Manager's scoreboard export writes one file per event, `E001.scb` …: a header `#<event> <TITLE>`, then 38-character lines (`name` padded to 20, `--`, team padded to 16), CRLF, in groups of ten per heat. `CTS.parseSCB()` reads them and `CTS.formatSCB()` writes them, so Lanecast's Save produces files Meet Manager's layout matches.

## Confidence

High: record framing and layout, event name, round, gender, lanes 1–8, teams, request framing. Unknown: lane 10's marker, the 13 blank characters, the `0120` field, results and team-score records, other request types, non-ASCII names. One real capture: 303 requests, 215 records, 214 distinct heats across 72 events, zero bytes outside any record; a later capture of the reply wire decoded every record at 65 records/min during a walk.
