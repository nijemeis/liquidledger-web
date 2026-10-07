import "server-only";
import nodemailer from "nodemailer";

// Outgoing mail. Configure SMTP_URL (e.g. smtps://user:pass@smtp.postmarkapp.com:465)
// and MAIL_FROM. Without SMTP_URL, mails are printed to the server log so
// development works offline.

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (!process.env.SMTP_URL) return null;
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  return transport;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  const t = getTransport();
  const from = process.env.MAIL_FROM ?? "Liquid Ledger <no-reply@liquidledger.net>";
  if (!t) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[mail] SMTP_URL not configured — mail to ${mail.to} NOT sent: ${mail.subject}`);
      return;
    }
    console.info(`\n[mail] To: ${mail.to}\n[mail] Subject: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  await t.sendMail({ from, ...mail, html: mail.html ?? textToHtml(mail.text) });
}

function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#7a1f3d">$1</a>');
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#14171f;max-width:560px">${linked.replace(/\n/g, "<br>")}</div>`;
}
