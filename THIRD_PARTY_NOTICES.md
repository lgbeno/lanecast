# Third-party notices

## coloradoScoreboard

The channel and digit mapping of the timing console's scoreboard output in `src/protocol/cts.js` was informed by the legacy implementation in [fabriziobertocci/coloradoScoreboard](https://github.com/fabriziobertocci/coloradoScoreboard), which is published under the MIT License, Copyright (c) Fabrizio Bertocci. No code was copied; the reference served as independent evidence for the protocol interpretation described in `docs/timer-protocol.md`.

## go2rtc

Lanecast runs [go2rtc](https://github.com/AlexxIT/go2rtc) beside itself to take camera streams and hand them to the window over WebRTC. The binary is fetched at install time by `scripts/fetch-go2rtc.js` and shipped inside the installers. go2rtc is published under the MIT License, Copyright (c) 2022 Alexey Khit.

ffmpeg is not bundled. If one is on the PATH, go2rtc uses it for the test-pattern camera and for cameras that need transcoding.

## Runtime dependencies

`electron`, `serialport` and `ws` are installed from npm under their own licences (MIT, MIT and MIT respectively). See each package's LICENSE file in `node_modules/`.
