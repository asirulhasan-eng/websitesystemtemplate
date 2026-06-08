const net = require("node:net");
const tls = require("node:tls");
const os = require("node:os");

async function sendSmtpMail(options) {
  const client = new SmtpClient(options);
  await client.connect();
  try {
    await client.sendMail(options.message);
  } finally {
    await client.quit().catch(() => {});
  }
}

class SmtpClient {
  constructor(options) {
    this.host = options.host;
    this.port = Number(options.port || 587);
    this.secure = Boolean(options.secure);
    this.user = options.user;
    this.pass = options.pass;
    this.from = options.from || options.user;
    this.authMethod = options.authMethod || "LOGIN"; // 'LOGIN' or 'PLAIN'
    this.hostname = options.hostname || hostname();
    this.connectionTimeout = options.connectionTimeout || 30000;
    this.socket = null;
    this.buffer = "";
    this.waiters = [];
  }

  async connect() {
    this.socket = this.secure
      ? tls.connect({ host: this.host, port: this.port, servername: this.host })
      : net.connect({ host: this.host, port: this.port });

    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", (error) => this.rejectWaiter(error));

    // Connection timeout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.destroy();
        reject(new Error(`SMTP connection timeout after ${this.connectionTimeout}ms`));
      }, this.connectionTimeout);
      const event = this.secure ? "secureConnect" : "connect";
      this.socket.once(event, () => { clearTimeout(timeout); resolve(); });
      this.socket.once("error", (err) => { clearTimeout(timeout); reject(err); });
    });

    await this.readResponse(220);
    await this.command(`EHLO ${this.hostname}`, 250);

    if (!this.secure) {
      await this.command("STARTTLS", 220);
      this.socket.removeAllListeners("data");
      this.socket.removeAllListeners("error");
      this.socket = tls.connect({ socket: this.socket, servername: this.host });
      this.socket.setEncoding("utf8");
      this.socket.on("data", (chunk) => this.onData(chunk));
      this.socket.on("error", (error) => this.rejectWaiter(error));
      await this.command(`EHLO ${this.hostname}`, 250);
    }

    if (this.user && this.pass) {
      if (this.authMethod === "PLAIN") {
        const credentials = Buffer.from(`\0${this.user}\0${this.pass}`).toString("base64");
        await this.command(`AUTH PLAIN ${credentials}`, [235]);
      } else {
        await this.command("AUTH LOGIN", 334);
        await this.command(Buffer.from(this.user).toString("base64"), 334);
        await this.command(Buffer.from(this.pass).toString("base64"), 235);
      }
    }
  }

  async sendMail(message) {
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    await this.command(`MAIL FROM:<${this.from}>`, 250);
    for (const recipient of recipients.filter(Boolean)) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await this.command("DATA", 354);
    this.socket.write(`${formatMessage({ ...message, from: this.from })}\r\n.\r\n`);
    await this.readResponse(250);
  }

  async quit() {
    if (!this.socket) return;
    if (!this.socket.destroyed) await this.command("QUIT", 221).catch(() => {});
    this.socket.destroy();
  }

  command(command, expectedCodes) {
    this.socket.write(`${command}\r\n`);
    return this.readResponse(expectedCodes);
  }

  readResponse(expectedCodes) {
    const expected = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
    return new Promise((resolve, reject) => {
      this.waiters.push({ expected, resolve, reject });
      this.flushResponses();
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    this.flushResponses();
  }

  flushResponses() {
    if (!this.waiters.length) return;
    const response = takeCompleteResponse(this.buffer);
    if (!response) return;
    this.buffer = response.rest;

    const waiter = this.waiters.shift();
    const code = Number(response.text.slice(0, 3));
    if (!waiter.expected.includes(code)) {
      waiter.reject(new Error(`SMTP expected ${waiter.expected.join("/")} but got ${code}: ${response.text.trim()}`));
      return;
    }
    waiter.resolve(response.text);
  }

  rejectWaiter(error) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.reject(error);
  }
}

function takeCompleteResponse(buffer) {
  // Match the line terminator exactly so we advance the cursor by the real
  // number of bytes consumed. Assuming a fixed 2-byte "\r\n" drifts when a
  // server uses bare "\n", corrupting the SMTP state machine.
  const lineRe = /([^\r\n]*)(\r\n|\n|\r)/g;
  let match;
  let consumed = 0;
  const responseLines = [];

  while ((match = lineRe.exec(buffer)) !== null) {
    const line = match[1];
    consumed = match.index + match[0].length;
    if (!line) continue;
    responseLines.push(line);
    if (/^\d{3} /.test(line)) {
      return {
        text: `${responseLines.join("\r\n")}\r\n`,
        rest: buffer.slice(consumed),
      };
    }
  }

  return null;
}

function formatMessage(message) {
  const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
  const baseHeaders = [
    `From: ${formatAddress(message.fromName, message.from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(message.subject || "")}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];

  // When HTML is present, send multipart/alternative with a plain-text part
  // first and the HTML part second (clients render the last supported part).
  if (message.html) {
    const boundary = `=_pseo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const headers = [...baseHeaders, `Content-Type: multipart/alternative; boundary="${boundary}"`];
    const textPart = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      escapeData(String(message.text || "")),
    ].join("\r\n");
    const htmlPart = [
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      escapeData(String(message.html)),
    ].join("\r\n");
    return `${headers.join("\r\n")}\r\n\r\n${textPart}\r\n${htmlPart}\r\n--${boundary}--`;
  }

  const headers = [
    ...baseHeaders,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ];

  return `${headers.join("\r\n")}\r\n\r\n${escapeData(String(message.text || ""))}`;
}

function formatAddress(name, email) {
  if (!name) return `<${email}>`;
  return `"${String(name).replace(/"/g, '\\"')}" <${email}>`;
}

function encodeHeader(value) {
  return String(value).replace(/\r?\n/g, " ");
}

function escapeData(value) {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function hostname(override) {
  return override || os.hostname() || "localhost";
}

module.exports = {
  sendSmtpMail,
  SmtpClient,
  formatMessage,
};
