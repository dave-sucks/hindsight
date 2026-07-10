/**
 * ntfy.sh push — a free, open-source pub/sub push channel. We POST a plain-text
 * message to a topic URL; any device subscribed to that topic (the ntfy mobile
 * app, a desktop client, or the web app) gets an instant push notification.
 *
 * Used to alert the owner the moment a trade proposal is staged for approval,
 * alongside the existing proposal-pending email — email is low-signal and easy
 * to miss, which caused real missed reviews.
 *
 * Config (both optional — with no NTFY_TOPIC this is a silent no-op, so it is
 * safe to leave unset in any environment, including local/preview):
 *   NTFY_TOPIC   — the topic name to publish to. Treat it like a password:
 *                  anyone who knows it can read your alerts, so use something
 *                  long and random (e.g. `hindsight-alerts-8f3k9d2p`). REQUIRED
 *                  to enable pushes.
 *   NTFY_SERVER  — base URL of the ntfy instance. Defaults to the public
 *                  https://ntfy.sh. Set this only if you self-host ntfy.
 *
 * Never throws — push is best-effort, exactly like the email path.
 */

export interface NtfyOptions {
  /** Bold heading shown above the message body. */
  title?: string;
  /**
   * 1 = min, 3 = default, 4 = high, 5 = max (loud + bypasses some DND). Use 4
   * for time-sensitive things like a trade awaiting approval.
   */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** Emoji shortcodes rendered before the title, e.g. ["chart_with_upwards_trend"]. */
  tags?: string[];
  /** URL opened when the notification is tapped — deep-link straight to the review. */
  clickUrl?: string;
}

/**
 * Publish a push to the configured ntfy topic. No-ops when NTFY_TOPIC is unset.
 * ntfy carries metadata in headers (Title/Priority/Tags/Click) with the message
 * as the raw body. Header values must be ASCII — our titles are (tickers +
 * plain words), so no encoding needed.
 */
export async function sendNtfy(
  message: string,
  opts: NtfyOptions = {},
): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return; // disabled — no-op

  const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/$/, "");

  try {
    const headers: Record<string, string> = { "Content-Type": "text/plain" };
    if (opts.title) headers["Title"] = opts.title;
    if (opts.priority) headers["Priority"] = String(opts.priority);
    if (opts.tags?.length) headers["Tags"] = opts.tags.join(",");
    if (opts.clickUrl) headers["Click"] = opts.clickUrl;

    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body: message,
    });

    if (!res.ok) {
      console.warn(
        "[ntfy] push rejected:",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (err) {
    console.warn("[ntfy] push threw:", err instanceof Error ? err.message : err);
  }
}
