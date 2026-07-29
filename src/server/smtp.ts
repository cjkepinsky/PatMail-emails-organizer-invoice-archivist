import tls from "node:tls";

const SMTP_TIMEOUT_MS = 30_000;

export async function sendSmtpMail(input: {
  host: string;
  port: number;
  username: string;
  password: string;
  fromEmail: string;
  toEmail: string;
  rawMessage: string;
}) {
  const socket = tls.connect({
    host: input.host,
    port: input.port,
    servername: input.host
  });
  socket.setEncoding("utf8");

  const session = new SmtpSession(socket);
  try {
    await session.waitForReady();
    await session.expect([220]);
    await session.command("EHLO localhost", [250]);
    await session.command(`AUTH PLAIN ${Buffer.from(`\0${input.username}\0${input.password}`, "utf8").toString("base64")}`, [235]);
    await session.command(`MAIL FROM:<${input.fromEmail}>`, [250]);
    await session.command(`RCPT TO:<${input.toEmail}>`, [250, 251]);
    await session.command("DATA", [354]);
    await session.data(input.rawMessage);
    await session.expect([250]);
    await session.command("QUIT", [221]);
  } finally {
    socket.destroy();
  }
}

export function smtpHostForImapHost(imapHost: string) {
  const host = imapHost.trim().toLowerCase();
  if (!host || host.includes("gmail.com")) return "smtp.gmail.com";
  if (host.startsWith("imap.")) return `smtp.${host.slice("imap.".length)}`;
  return host;
}

class SmtpSession {
  private buffer = "";
  private waiters: Array<() => void> = [];
  private error: Error | null = null;

  constructor(private readonly socket: tls.TLSSocket) {
    socket.on("data", chunk => {
      this.buffer += String(chunk);
      this.flushWaiters();
    });
    socket.on("error", error => {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.flushWaiters();
    });
  }

  waitForReady() {
    if (this.socket.readyState === "open") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout SMTP podczas łączenia.")), SMTP_TIMEOUT_MS);
      this.socket.once("secureConnect", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.once("error", error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async command(command: string, expectedCodes: number[]) {
    this.socket.write(`${command}\r\n`);
    return this.expect(expectedCodes);
  }

  async data(rawMessage: string) {
    const safeMessage = rawMessage
      .replace(/\r?\n/g, "\r\n")
      .split("\r\n")
      .map(line => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    this.socket.write(`${safeMessage}\r\n.\r\n`);
  }

  async expect(expectedCodes: number[]) {
    const response = await this.readResponse();
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`SMTP ${response.code}: ${response.text}`);
    }
    return response;
  }

  private async readResponse() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < SMTP_TIMEOUT_MS) {
      if (this.error) throw this.error;
      const response = this.extractResponse();
      if (response) return response;
      await this.waitForData();
    }
    throw new Error("Timeout SMTP podczas oczekiwania na odpowiedź serwera.");
  }

  private extractResponse() {
    const lineMatches = this.buffer.match(/.*(?:\r?\n)/g) || [];
    const finalIndex = lineMatches.findIndex(line => /^\d{3} /.test(line));
    if (finalIndex < 0) return null;

    const responseLines = lineMatches.slice(0, finalIndex + 1);
    const rawResponse = responseLines.join("");
    this.buffer = this.buffer.slice(rawResponse.length);
    return {
      code: Number(responseLines[finalIndex].slice(0, 3)),
      text: rawResponse.trim()
    };
  }

  private waitForData() {
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  private flushWaiters() {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter();
  }
}
