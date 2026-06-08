---
name: obsidian-cli
description: Interact with Obsidian vaults using the Obsidian CLI to read, create, search, and manage notes, tasks, properties, and more. Also supports plugin and theme development with commands to reload plugins, run JavaScript, capture errors, take screenshots, and inspect the DOM. Use when the user asks to interact with their Obsidian vault, manage notes, search vault content, perform vault operations from the command line, or develop and debug Obsidian plugins and themes.
---

# Obsidian CLI

Use the `obsidian` CLI to interact with a running Obsidian instance. Requires Obsidian to be open.

## Setup / installation checks

Before using Obsidian commands on a server, verify both the app and vault state:

```bash
command -v obsidian || true
dpkg-query -W -f='${Package} ${Version} ${Architecture}\n' obsidian 2>/dev/null || true
[ -d /opt/client-obsidian ] && echo "vault exists" || echo "vault missing"
```

If the desktop app is missing on Ubuntu/Debian amd64, install the official `.deb` from the latest GitHub release:

```bash
release_json=$(curl -fsSL https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest)
deb_url=$(printf '%s' "$release_json" | jq -r '.assets[] | select(.name|test("amd64.*\\.deb$")) | .browser_download_url' | head -n1)
curl -fL "$deb_url" -o /tmp/obsidian-latest-amd64.deb
apt-get update -qq
apt-get install -y /tmp/obsidian-latest-amd64.deb
```

Verify after install:

```bash
command -v obsidian
readlink -f "$(command -v obsidian)"
dpkg-query -W -f='${Package} ${Version} ${Architecture}\n' obsidian
```

On headless/root servers, Electron/Obsidian may need a virtual display and no sandbox for smoke tests:

```bash
xvfb-run -a obsidian --no-sandbox --disable-gpu
```

Do not record transient launch failures as durable constraints; capture the setup command or flag that fixes them.

## Command reference

Run `obsidian help` to see all available commands. This is always up to date. Full docs: https://help.obsidian.md/cli

## Installing Obsidian desktop on Linux

If the Obsidian app is missing and the user asks to install it, prefer the official GitHub release `.deb` on Debian/Ubuntu:

```bash
release_json=$(curl -fsSL https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest)
deb_url=$(printf '%s' "$release_json" | jq -r '.assets[] | select(.name|test("amd64.*\\.deb$")) | .browser_download_url' | head -n1)
curl -fL "$deb_url" -o /tmp/obsidian-latest-amd64.deb
apt-get update -qq
apt-get install -y /tmp/obsidian-latest-amd64.deb
command -v obsidian
dpkg-query -W -f='${Package} ${Version} ${Architecture}\n' obsidian
```

On headless/root servers, GUI launch smoke tests generally need Electron flags and a virtual display:

```bash
xvfb-run -a obsidian --no-sandbox --disable-gpu
```

Do not confuse the installed desktop binary with the Obsidian command interface: many `obsidian <command>` CLI operations require an already-running Obsidian instance.

## Syntax

**Parameters** take a value with `=`. Quote values with spaces:

```bash
obsidian create name="My Note" content="Hello world"
```

**Flags** are boolean switches with no value:

```bash
obsidian create name="My Note" silent overwrite
```

For multiline content use `\n` for newline and `\t` for tab.

## File targeting

Many commands accept `file` or `path` to target a file. Without either, the active file is used.

- `file=<name>` â€” resolves like a wikilink (name only, no path or extension needed)
- `path=<path>` â€” exact path from vault root, e.g. `folder/note.md`

## Vault targeting

Commands target the most recently focused vault by default. Use `vault=<name>` as the first parameter to target a specific vault:

```bash
obsidian vault="My Vault" search query="test"
```

## Common patterns

```bash
obsidian read file="My Note"
obsidian create name="New Note" content="# Hello" template="Template" silent
obsidian append file="My Note" content="New line"
obsidian search query="search term" limit=10
obsidian daily:read
obsidian daily:append content="- [ ] New task"
obsidian property:set name="status" value="done" file="My Note"
obsidian tasks daily todo
obsidian tags sort=count counts
obsidian backlinks file="My Note"
```

Use `--copy` on any command to copy output to clipboard. Use `silent` to prevent files from opening. Use `total` on list commands to get a count.

## Plugin development

### Develop/test cycle

After making code changes to a plugin or theme, follow this workflow:

1. **Reload** the plugin to pick up changes:
   ```bash
   obsidian plugin:reload id=my-plugin
   ```
2. **Check for errors** â€” if errors appear, fix and repeat from step 1:
   ```bash
   obsidian dev:errors
   ```
3. **Verify visually** with a screenshot or DOM inspection:
   ```bash
   obsidian dev:screenshot path=screenshot.png
   obsidian dev:dom selector=".workspace-leaf" text
   ```
4. **Check console output** for warnings or unexpected logs:
   ```bash
   obsidian dev:console level=error
   ```

### Additional developer commands

Run JavaScript in the app context:

```bash
obsidian eval code="app.vault.getFiles().length"
```

Inspect CSS values:

```bash
obsidian dev:css selector=".workspace-leaf" prop=background-color
```

Toggle mobile emulation:

```bash
obsidian dev:mobile on
```

Run `obsidian help` to see additional developer commands including CDP and debugger controls.
