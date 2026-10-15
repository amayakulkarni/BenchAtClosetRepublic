// Guardrails for Reddit's API: a sliding one-minute window capped well under Reddit's limit,
// plus whatever Reddit's own X-Ratelimit-* headers say, plus exponential backoff on 429/5xx.
export class RateLimiter {
  constructor({ perMinute, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.perMinute = perMinute;
    this.stamps = [];
    this.pausedUntil = 0;
    this.now = now;
    this.sleep = sleep;
  }

  async take() {
    for (;;) {
      const t = this.now();
      this.stamps = this.stamps.filter((s) => t - s < 60_000);
      const waitPause = this.pausedUntil - t;
      const waitWindow = this.stamps.length >= this.perMinute ? 60_000 - (t - this.stamps[0]) + 5 : 0;
      const wait = Math.max(waitPause, waitWindow, 0);
      if (wait === 0) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(wait);
    }
  }

  // Reddit sends X-Ratelimit-Remaining (requests left) and X-Ratelimit-Reset (seconds left
  // in the window). Keep a reserve of 5 so other tools using the same app never get starved.
  observe(headers) {
    const remaining = Number(headers.get?.('x-ratelimit-remaining'));
    const reset = Number(headers.get?.('x-ratelimit-reset'));
    if (Number.isFinite(remaining) && Number.isFinite(reset) && remaining < 5) {
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + reset * 1000 + 1000);
    }
  }

  backoff(attempt, retryAfterSeconds) {
    const ms = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Math.min(2 ** attempt * 2000, 5 * 60_000);
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }
}
