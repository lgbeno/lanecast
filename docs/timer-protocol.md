# Timing console scoreboard output

What Lanecast reads from a Colorado Time Systems console (System 6 class) on its **scoreboard** serial output. This is the legacy numeric scoreboard feed, not the meet-management results port and not the Gen7 protocol. Reconstructed from captures and consistent with the MIT-licensed [coloradoScoreboard](https://github.com/fabriziobertocci/coloradoScoreboard) reference (see `THIRD_PARTY_NOTICES.md`); it is not a manufacturer specification. Implementation: `src/protocol/cts.js`.

## Line settings

9600 baud, 8 data bits, even parity, 1 stop bit ("FAST"; the console's "SLOW" setting is 2400 8E1). Lanecast reads only; nothing is ever sent to the console. A capture taken at the right settings steps the clock one tenth at a time; one taken at the wrong parity jumps about, which `CTS.clockSteps()` measures.

Observed on a live line: 873 bytes/s, the line saturated; clock blocks every 100 ms with no gaps or orphan bytes over several minutes. Any stutter in a displayed clock is downstream of the wire.

## What the stream is

Updates to a numeric display: channels and digit positions, with separate readout data (the digits) and format data (dots and attributes). Lanecast keeps that display state and reads selected channels as swimming information. Updates to different channels are not one atomic packet: event, clock and lane data arrive at different moments, and a serial read can end partway through a block.

## Control bytes

A byte with the high bit set starts a block:

```text
channel = ((byte >> 1) & 0x1F) XOR 0x1F
bit 0 = 0: readout data; 1: format data
bit 6: universal running-clock mode (lane modules show the common clock)
```

| Byte | Channel | Block |
| --- | --- | --- |
| `BE` | 0 | running clock readout |
| `A6` | 12 | event and heat readout |
| `A7` | 12 | event and heat format |
| `B6` | 4 | lane 4 readout |

A block ends when the next control byte arrives. Lanecast commits a block only then, never at a read boundary, so a half-received block is never shown.

## Data bytes

High bit clear. Upper nibble is the digit position 0–7; lower nibble the value:

| Low nibble | Meaning |
| --- | --- |
| `0` | blank |
| `6`–`F` | digits 9 down to 0 (`digit = 15 − value`) |
| `1`–`5` | special glyphs; not digits (vsCTS reports `5` as lane/place 10, unverified here) |

Example event block: `A6 00 18 2C 30 40 50 60 7E` → positions `_ 7 3 _ _ _ _ 1` → event 73, heat 1.

## Channel mapping

| Channel | Positions | Meaning | Confidence |
| --- | --- | --- | --- |
| 0 | 2–6 | running clock `MMSSd` | high |
| 1–10 | 0 | displayed lane digit | high for 1–9 |
| 1–10 | 1 | displayed place | high as a digit; its meaning as final rank unverified |
| 1–10 | 2–7 | lane time `MMSSdd` | high |
| 12 | 0–2 | event number | high |
| 12 | 5–7 | heat number | moderate |

Clock digits arrive in descending position order (`BE 70 67 5D 4E 30 20` → 0:12.8); the decoder uses explicit positions, so order does not matter.

## Timer state

The feed has no explicit "running" flag. Lanecast infers:

| Condition | State |
| --- | --- |
| successive clock values increase | `running` |
| first observation, or clock decreases or goes invalid | `unknown` |
| no clock advance for 1.5 s | `unknown` |
| clock at 0:00.0 and, within 500 ms, a lane format block with nibble `D` at position 0 | `reset` (inferred) |

A stationary clock never proves idle. The 500 ms and 1.5 s thresholds are application choices.

## Splits and finishes

A lane time with a place beside it may be a ranked split or a finish; the feed does not say which. Lanecast passes the displayed time and place through as they are and leaves that judgement to the overlay. A new event/heat hides the previous lanes' results until fresh readouts arrive. Lane 10, DQ displays, recalls and corrections are not yet interpreted.

## Confidence

High: byte framing, channel and digit decoding, the running clock, event number, lane times. Moderate: heat numbers beyond 1, universal-mode transitions, running detection under recalls and manual edits. Low: reset inference, split-versus-finish, lane 10. Confidence came from one ten-minute capture of a real meet (events 73–79, 556 KB, every clock step +0.1 s), a later clean live capture, and the reference implementation; it would improve with labelled captures of controlled console operations (reset, start, splits, finishes, recall, next heat).
