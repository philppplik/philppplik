// Resend mailer for the portfolio newsletter. Returns null without an API key, so
// the newsletter module stays dormant until the key is provided via environment.
// Sending itself stays separately gated by the allowSend flag in the wiring.
export function createResendMailer({ apiKey, from, fetchImpl = fetch }) {
  if (!apiKey) return null;
  return {
    send: async msg => {
      const r = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers }),
      });
      if (!r.ok) throw new Error(`Resend send failed: ${r.status}`);
    },
  };
}
