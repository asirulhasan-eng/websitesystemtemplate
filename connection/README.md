# Server Connection Guide

This directory contains SSH keys and convenience scripts to connect to the remote server.

## Quick Start

### Step 1 — Create your `server.cfg`
```
copy server.cfg.example server.cfg
```
Then open `server.cfg` and set your values:
```ini
SERVER_HOST=your.server.ip.address
SERVER_USER=root
```

> **`server.cfg` is gitignored** — your server IP is never committed to the repo.

---

### Step 2 — Connect

**Standard SSH (recommended):**
Double-click `connect-ssh.bat` or run from terminal:
```
connection\connect-ssh.bat
```

**PuTTY:**
Double-click `connect-putty.bat` or run:
```
connection\connect-putty.bat
```

---

## Files

| File | Purpose |
|---|---|
| `server.cfg` | Your live server settings — **gitignored, never commit** |
| `server.cfg.example` | Template to copy from |
| `connect-ssh.bat` | Connects via OpenSSH (reads `server.cfg`) |
| `connect-putty.bat` | Connects via PuTTY/plink (reads `server.cfg`) |
| `id_rsa` | OpenSSH private key — **gitignored** |
| `key.ppk` | PuTTY private key format — **gitignored** |

---

## VS Code / Remote-SSH Extension

Add an entry to your `~/.ssh/config` (use your actual values from `server.cfg`):

```text
Host my-seo-server
    HostName YOUR_SERVER_IP
    User root
    IdentityFile d:/Projects/Website Autopilot System/connection/id_rsa
```

Then in VS Code: **Remote-SSH: Connect to Host** → `my-seo-server`.

---

## Changing the Server

1. Edit `server.cfg` — update `SERVER_HOST` (and `SERVER_USER` if needed).
2. The `.bat` scripts pick up the change automatically on next run.
3. Do **not** edit the `.bat` files to change the IP.
