# Skill Atlas

Finds the skills and plugins installed on this computer and lists what each one does, in the terminal or in a browser.

[한국어](README.md)

- Nothing to install. It needs Node.js 18 or later and has no dependencies or build step.
- No separate server or database. It only reads folders on the machine it runs on.
- Works on macOS, Windows and Linux.

## Run it

```bash
npx github:<account>/skill-atlas
```

```bash
npx github:<account>/skill-atlas serve
```

Or clone the repository:

```bash
git clone https://github.com/<account>/skill-atlas.git
cd skill-atlas
node bin/cli.js serve
```

## Commands

| Command | What it does |
|---|---|
| `skill-atlas` or `skill-atlas list` | Print the whole list in the terminal |
| `skill-atlas show <name>` | Full details for one entry (original description, location, version, contents) |
| `skill-atlas serve` | Open the list in a browser (`http://127.0.0.1:4317`) |
| `skill-atlas summarize` | Write short plain-language summaries with Claude (optional) |
| `skill-atlas where` | Show which folders were checked |

Common options:

```bash
skill-atlas list --kind plugin            # plugins only
skill-atlas list --source user            # only skills you made
skill-atlas list --search figma           # search names and descriptions
skill-atlas list --json                   # JSON output
skill-atlas list --project ~/work/my-app  # also check that project's .claude folder
skill-atlas serve --port 5000 --no-open
skill-atlas --lang en                     # English (the default is Korean)
```

Output is in Korean by default. To always get English, set the `SKILL_ATLAS_LANG=en` environment variable. Run `skill-atlas --help` for everything.

## In the browser

- Search by name or description (press `/` to jump to the search box)
- Filter by kind (skill, plugin, agent, command) and by where it was found
- Open an entry to see its original description, version and location
- Switch between Korean and English, and between system, light and dark themes (your choice is saved in the browser)

## Where it looks

| Label | Location |
|---|---|
| My skills folder | `~/.claude/skills`, `~/.claude/agents`, `~/.claude/commands` |
| Claude Code plugins | Plugins registered in `~/.claude/plugins/installed_plugins.json` |
| Claude app | `~/.claude/skills/synced`, `~/.claude/plugins/synced`, the desktop app's data folder |
| Project | `.claude` in the current folder and in folders given with `--project` |
| Shared folder | `~/.agents/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.gemini/skills` |

An entry found in several places is shown once, with every place listed. If you use the `CLAUDE_CONFIG_DIR` environment variable, that folder is checked instead of `~/.claude`.

## Plain summaries (optional)

By default each entry shows the description it ships with. If those are long or hard to read, Claude can rewrite each as one line.

```bash
skill-atlas summarize
```

- Only the **name and description** of each entry are sent to Claude. Summaries are written in Korean and English.
- If the Claude Code CLI (`claude`) is installed and logged in, that login is used. **No API key is needed.**
- Without the CLI, the `ANTHROPIC_API_KEY` environment variable is used. Set it in your shell, not in a file.
- Results are cached outside the repository (`~/.cache/skill-atlas/summaries.json`, or `%LOCALAPPDATA%\skill-atlas` on Windows). Only entries whose description changed are redone.
- With neither, `list`, `show` and `serve` still work with the original descriptions.

## Privacy and security

- Read-only. It never changes skills or settings.
- From `settings.json` it reads only which plugins are turned on (`enabledPlugins`). From MCP configuration it keeps server names and discards environment variables and tokens. It never opens `.env` files.
- Paths in the output show the home folder as `~`.
- The web page is served on `127.0.0.1` only, and requests coming from other sites are refused.
- Nothing leaves the machine unless you run `summarize`.

## Development

```bash
npm test
```

The tests build a fake home folder in a temporary directory, so your real configuration is never touched.
