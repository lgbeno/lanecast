# For AI agents

Documents written for an AI agent asked to work on Lanecast. They are meant to be read top to bottom by something that will then do the work, so they say what to do, in order, and how to check it.

| Document | Read it when |
| --- | --- |
| [Making a theme](making-a-theme.md) | You were asked to make or change how a stream looks. **Start here.** |
| [Theme requirements](theme-requirements.md) | Before building: you need to write down what the theme should be, or to build from what someone wrote down |
| [Theme messages](theme-messages.md) | You need to know exactly what a theme is told: every field, every event, a whole heat played out |
| [Theme cookbook](theme-cookbook.md) | You want working code for a results board, picture-in-picture, camera cues, a control panel, saved settings |
| [Themes reference](../themes.md) | You need the whole `Lanecast` interface in one table |
| [AGENTS.md](../../AGENTS.md) | You were asked to change the app itself |

To see a theme react to a race without the app or a meet, open [`themes/preview.html`](../../themes/preview.html) in a browser, with the theme's folder name: `themes/preview.html?theme=template`.

In this repository there is also a skill for Claude Code, [`.claude/skills/lanecast-theme/SKILL.md`](../../.claude/skills/lanecast-theme/SKILL.md), which is the short form of the same.
