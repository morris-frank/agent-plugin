# Agent plugin marketplace template

Canonical template for a **cross-platform plugin marketplace** targeting [Claude Code](https://code.claude.com/docs/en/plugin-marketplaces), [Codex](https://developers.openai.com/codex/plugins/build), and [Cursor](https://cursor.com/docs/plugins).

The repository root is both the marketplace and the plugin. Shared files use relative symlinks where platforms require different paths for the same content.

## Repository layout

```text
.
├── marketplace.json                   # canonical marketplace manifest
├── .agents/plugins/marketplace.json   # → ../../marketplace.json
├── .claude-plugin/
│   ├── marketplace.json               # → ../marketplace.json
│   └── plugin.json                    # canonical Claude/Cursor manifest
├── .cursor-plugin/
│   ├── marketplace.json               # → ../marketplace.json
│   └── plugin.json                    # → ../.claude-plugin/plugin.json
├── .codex-plugin/
│   └── plugin.json                    # Codex manifest (+ interface block)
├── .mcp.json                          # canonical MCP config
├── mcp.json                           # → .mcp.json
├── skills/<name>/SKILL.md
├── agents/
├── commands/
├── hooks/hooks.json
├── rules/                             # Cursor only
├── scripts/                           # validate.mjs + hook scripts
└── assets/
```

Only `plugin.json` belongs inside each `.xxx-plugin/` directory. All component folders live at the repository root.

## Quick start

1. Fork or clone this repo.
2. Set marketplace `owner` and plugin `author` in `marketplace.json` and plugin manifests.
3. Customize skills, agents, commands, rules, hooks, and MCP at the repo root.
4. Validate and install:

```bash
node scripts/validate.mjs
```

## Cross-platform schema

The **maximal common subset** works on all three platforms without extensions. Unrecognized fields are ignored at runtime (Claude documents this explicitly).

### Marketplace

```json
{
  "name": "my-marketplace",
  "owner": { "name": "Your Org", "email": "plugins@example.com" },
  "description": "Optional — used by Claude",
  "metadata": {
    "description": "Optional — used by Cursor",
    "version": "0.1.0"
  },
  "interface": {
    "displayName": "My Marketplace"
  },
  "plugins": [
    {
      "name": "my-plugin",
      "source": "./",
      "description": "Optional blurb",
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

Edit `marketplace.json` only. Platform marketplace paths symlink to it.

| Field | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| `name` | required | required | required |
| `owner.name` | required | ignored | required |
| `description` | optional | ignored | optional |
| `metadata.description` | optional | ignored | optional |
| `interface.displayName` | ignored | optional | ignored |
| `plugins[].source` | `./` for root plugin | `./` for root plugin | `./` for root plugin |
| `plugins[].policy` / `category` | ignored | required | ignored |

### Plugin manifest

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "What this plugin does",
  "author": { "name": "Your Org", "email": "plugins@example.com" },
  "license": "MIT",
  "keywords": ["skills", "agents"],
  "skills": "./skills/",
  "agents": "./agents/",
  "commands": "./commands/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

Claude and Cursor share one manifest (`.claude-plugin/plugin.json`; Cursor symlinks to it). Codex adds an `interface` block in `.codex-plugin/plugin.json` for install-surface metadata.

| Component | Platforms | Location |
| --- | --- | --- |
| Skills | all | `skills/<name>/SKILL.md` — frontmatter: `name`, `description` |
| Agents | Claude, Cursor | `agents/<name>.md` — frontmatter: `name`, `description` |
| Commands | Claude, Cursor | `commands/<name>.md` |
| Rules | Cursor only | `rules/<name>.mdc` — frontmatter: `description` |
| MCP | all | `.mcp.json` canonical; `mcp.json` symlink for Cursor filename |
| Hooks | Claude, Codex | `hooks/hooks.json` — `PostToolUse`, `SessionEnd`, etc. |

Claude/Codex namespace skills as `/plugin-name:skill-name`. Cursor exposes them without the namespace prefix.

**Hooks are not portable.** Cursor uses different event names (`afterFileEdit`, `beforeShellExecution`, …). This template ships Claude/Codex hooks; swap `hooks/hooks.json` if Cursor hooks are your primary target.

**Version pinning:** set `version` in `plugin.json` to release on demand. Omit it only when every git commit should count as a new version (Claude/Codex).

## Install and test

### Claude Code

```text
/plugin marketplace add /path/to/agent-plugin
/plugin install my-plugin@agent-plugin-marketplace
```

Development:

```bash
claude --plugin-dir .
claude plugin validate .
```

### Codex

```bash
codex plugin marketplace add /path/to/agent-plugin
codex plugin marketplace list
```

Codex also reads `.claude-plugin/marketplace.json` as a legacy path and picks up `.agents/plugins/marketplace.json` from the repo root after restart.

### Cursor

Local test:

```bash
ln -s /path/to/agent-plugin ~/.cursor/plugins/local/my-plugin
```

Restart Cursor or run **Developer: Reload Window**.

Team marketplace: Dashboard → Settings → Plugins → Team Marketplaces → import this repo.

## Customize

1. **Metadata** — update all three `plugin.json` files. Keep Claude/Cursor aligned; add Codex `interface` fields only in `.codex-plugin/plugin.json`.
2. **Skills** — add `skills/<name>/SKILL.md` with YAML frontmatter.
3. **Agents / commands** — add markdown files under `agents/` or `commands/`.
4. **Rules** — add `.mdc` files under `rules/` (Cursor only).
5. **MCP** — edit `.mcp.json` only; `mcp.json` stays symlinked.
6. **Hooks** — edit `scripts/*.sh` and `hooks/hooks.json` (Claude/Codex schema).
7. Re-run `node scripts/validate.mjs`.

### Multi-plugin marketplace

To add more plugins, create sibling directories (e.g. `other-plugin/`) and add entries to `marketplace.json` with `"source": "./other-plugin"`. This template defaults to a single root plugin via `"source": "./"`.

## Pitfalls

- Plugin `name` must be lowercase kebab-case and match across marketplace entry and all manifests.
- Edit `marketplace.json` for catalog changes — do not replace platform symlinks with separate files.
- `source` paths must start with `./` and stay inside the repo root.
- Never put `skills/`, `hooks/`, or other components inside `.xxx-plugin/`.
- Edit `.mcp.json` for MCP changes — do not replace the `mcp.json` symlink with a separate file.
- Keep `.cursor-plugin/plugin.json` symlinked to `.claude-plugin/plugin.json` while manifests stay aligned.

## License

MIT — customize `license` fields in manifests for your org.
