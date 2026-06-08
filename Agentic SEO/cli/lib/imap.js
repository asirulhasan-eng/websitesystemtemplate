const tls = require("node:tls");
const { createBudgetTracker } = require("./http");

const imapBudget = createBudgetTracker({ name: "imap", dailyLimit: 500, unit: "connections" });
// Limit to 500 connections per day to avoid rate limits.

class ImapClient {
  constructor(options) {
    this.host = options.host;
    this.port = Number(options.port || 993);
    this.user = options.user;
    this.pass = options.pass;
    this.connectionTimeout = options.connectionTimeout || 30000;
    this.socket = null;
    this.buffer = "";
    this.tagCounter = 1;
  }

  async connect() {
    const budget = imapBudget.consume(1);
    if (!budget.allowed) {
      throw new Error(budget.message);
    }
    this.socket = tls.connect({ host: this.host, port: this.port, servername: this.host });
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.destroy();
        reject(new Error(`IMAP connection timeout after ${this.connectionTimeout}ms`));
      }, this.connectionTimeout);
      this.socket.once("secureConnect", () => { clearTimeout(timeout); resolve(); });
      this.socket.once("error", (err) => { clearTimeout(timeout); reject(err); });
    });
    await this.waitFor(/\* OK/);
    await this.command(`LOGIN ${quote(this.user)} ${quote(this.pass)}`);
  }

  async select(mailbox = "INBOX") {
    return this.command(`SELECT ${quote(mailbox)}`);
  }

  async search(criteria = "UNSEEN") {
    const response = await this.command(`SEARCH ${criteria}`);
    const match = response.match(/\* SEARCH\s+([0-9\s]*)/i);
    if (!match || !match[1].trim()) return [];
    return match[1].trim().split(/\s+/).map(Number).filter(Boolean);
  }

  async fetchBodies(ids, markSeen = false) {
    if (!ids.length) return [];
    const item = markSeen ? "BODY[]" : "BODY.PEEK[]";
    const response = await this.command(`FETCH ${ids.join(",")} (${item})`, 120000);
    return extractFetchBodies(response);
  }

  async storeSeen(ids) {
    if (!ids.length) return "";
    return this.command(`STORE ${ids.join(",")} +FLAGS (\\Seen)`);
  }

  async logout() {
    if (!this.socket || this.socket.destroyed) return;
    await this.command("LOGOUT").catch(() => {});
    this.socket.destroy();
  }

  async disconnect() {
    return this.logout();
  }

  async command(command, timeoutMs = 30000) {
    const tag = `A${String(this.tagCounter++).padStart(4, "0")}`;
    this.socket.write(`${tag} ${command}\r\n`);
    return this.waitFor(new RegExp(`^${tag} (OK|NO|BAD)`, "m"), timeoutMs, tag);
  }

  waitFor(pattern, timeoutMs = 30000, tag = null) {
    return new Promise((resolve, reject) => {
      const startLength = tag ? this.buffer.length : 0;
      const timer = setInterval(() => {
        const slice = tag ? this.buffer.slice(startLength) : this.buffer;
        const match = slice.match(pattern);
        if (!match) return;
        clearInterval(timer);
        clearTimeout(timeout);
        if (tag && !new RegExp(`^${tag} OK`, "m").test(slice)) {
          reject(new Error(`IMAP command failed: ${slice.trim().slice(-1000)}`));
        } else {
          resolve(slice);
        }
      }, 100);
      const timeout = setTimeout(() => {
        clearInterval(timer);
        reject(new Error(`IMAP timeout waiting for ${pattern}`));
      }, timeoutMs);
    });
  }
}

function extractFetchBodies(response) {
  const bodies = [];
  let index = 0;
  while (index < response.length) {
    const marker = response.slice(index).match(/\{(\d+)\}\r\n/);
    if (!marker) break;
    const start = index + marker.index + marker[0].length;
    const length = Number(marker[1]);
    const body = response.slice(start, start + length);
    bodies.push(body);
    index = start + length;
  }
  return bodies;
}

function quote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

module.exports = {
  ImapClient,
  extractFetchBodies,
};
