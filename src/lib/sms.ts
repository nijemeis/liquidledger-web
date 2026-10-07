import "server-only";

// SMS is a fallback second factor only. Configure Twilio with TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN and TWILIO_FROM. Without them SMS is unavailable in
// production; in development the code is printed to the server log.

export function smsAvailable(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) ||
    process.env.NODE_ENV !== "production";
}

export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("SMS provider not configured");
    console.info(`[sms] To: ${to}: ${body}`);
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`SMS failed: ${res.status}`);
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\s/g, "");
  if (digits.length < 6) return "•••";
  const head = digits.slice(0, digits.startsWith("+") ? 3 : 2);
  const tail = digits.slice(-4);
  return `${head} •• •• ${tail.slice(0, 2)} ${tail.slice(2)}`;
}
