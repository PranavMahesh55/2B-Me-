const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { normalizedEvent } = require("./eventNormalizer.cjs");

const execFileAsync = promisify(execFile);

const EXCLUDED_APPLICATIONS = [
  /1password/i,
  /bitwarden/i,
  /keychain/i,
  /password/i,
  /bank/i,
  /wallet/i,
];

const INPUT_COUNTER = path.join(__dirname, "..", "..", "collector", ".build", "release", "input-counter");

class CollectorManager {
  constructor({ backendUrl, queueDirectory }) {
    this.backendUrl = backendUrl;
    this.queuePath = path.join(queueDirectory, "behavior-event-queue.json");
    this.queue = [];
    this.session = null;
    this.lastWindow = null;
    this.lastTransitionAt = Date.now();
    // Monotonic input counters from the previous sample. Only differences are
    // ever recorded, so this holds a rate and never any content.
    this.lastCounts = null;
    this.privacy = {};
    this.status = "STARTING";
    this.sampleTimer = null;
    this.flushTimer = null;
    this.settingsTimer = null;
  }

  async start() {
    this.loadDiskQueue();
    await this.refreshSettings();
    this.session = await this.request("/api/sessions/start", {
      method: "POST",
      body: JSON.stringify({
        title: "Desktop work session",
        workflow_type: "deep_work",
        device_id: "device_local",
      }),
    });
    this.sampleTimer = setInterval(() => this.sample(), 2000);
    this.flushTimer = setInterval(() => this.flush(), 750);
    this.settingsTimer = setInterval(() => this.refreshSettings(), 10_000);
    await this.sample();
  }

  async request(route, options = {}) {
    const response = await fetch(`${this.backendUrl}${route}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`Collector request failed (${response.status})`);
    return response.json();
  }

  async refreshSettings() {
    try {
      const [status, privacy] = await Promise.all([
        this.request("/api/system/status"),
        this.request("/api/privacy"),
      ]);
      this.status = status.status;
      this.privacy = privacy;
    } catch {
      this.status = "ERROR";
    }
  }

  async sample() {
    if (!this.session || this.status === "PAUSED" || !this.privacy.application_activity) return;
    try {
      const application = await safeActiveApplication();
      if (!application || EXCLUDED_APPLICATIONS.some((pattern) => pattern.test(application))) return;
      const now = Date.now();
      if (!this.lastWindow) {
        this.lastWindow = application;
        this.lastTransitionAt = now;
        this.queue.push(normalizedEvent({
          sessionId: this.session.id,
          taskId: this.session.task_id,
          application,
          eventType: "window_focus",
          action: "focus",
        }));
        return;
      }
      if (application !== this.lastWindow && this.privacy.window_switching !== false) {
        this.queue.push(normalizedEvent({
          sessionId: this.session.id,
          taskId: this.session.task_id,
          application,
          eventType: "application_transition",
          action: "focus",
          durationMs: now - this.lastTransitionAt,
          metadata: { from_app: this.lastWindow, to_app: application },
        }));
        this.lastWindow = application;
        this.lastTransitionAt = now;
      } else if (now - this.lastTransitionAt >= 10_000) {
        this.queue.push(normalizedEvent({
          sessionId: this.session.id,
          taskId: this.session.task_id,
          application,
          eventType: "window_focus",
          action: "active",
          durationMs: now - this.lastTransitionAt,
        }));
        this.lastTransitionAt = now;
      }
      await this.sampleInput(now, application);
      if (this.queue.length >= 100) await this.flush();
    } catch {
      // The collector remains optional when the OS cannot report an active window.
    }
  }

  /**
   * keyboard_timing has been true in DEFAULT_PRIVACY since the beginning, but
   * nothing collected it. This reads CGEventSource counters -- totals since
   * boot, not an event tap -- so it needs no Accessibility permission and can
   * only ever produce a rate. No keycodes, no characters, no target app.
   */
  async sampleInput(now, application) {
    if (this.privacy.keyboard_timing === false) return;
    let counts;
    try {
      const { stdout } = await execFileAsync(INPUT_COUNTER, [], { timeout: 1000 });
      counts = JSON.parse(stdout);
    } catch {
      return; // The helper is optional; app tracking continues without it.
    }

    const previous = this.lastCounts;
    this.lastCounts = { ...counts, at: now };
    if (!previous) return;

    const elapsedMs = Math.max(1, now - previous.at);
    const keys = Math.max(0, counts.keys - previous.keys);
    const clicks = Math.max(0, counts.clicks - previous.clicks);
    const scrolls = Math.max(0, counts.scrolls - previous.scrolls);
    if (!keys && !clicks && !scrolls) return;

    this.queue.push(normalizedEvent({
      sessionId: this.session.id,
      taskId: this.session.task_id,
      application,
      eventType: "keyboard_activity",
      action: "input_burst",
      durationMs: elapsedMs,
      metadata: { keys, clicks, scrolls, idle_s: counts.idle_s },
    }));
  }

  async flush() {
    if (!this.queue.length || this.status === "PAUSED") return;
    const batch = this.queue.splice(0, 100);
    try {
      await this.request("/api/events/batch", {
        method: "POST",
        body: JSON.stringify({ events: batch }),
      });
      if (!this.queue.length && fs.existsSync(this.queuePath)) fs.unlinkSync(this.queuePath);
    } catch {
      this.queue = [...batch, ...this.queue].slice(-500);
      this.persistDiskQueue();
    }
  }

  loadDiskQueue() {
    try {
      this.queue = JSON.parse(fs.readFileSync(this.queuePath, "utf8")).slice(-500);
    } catch {
      this.queue = [];
    }
  }

  persistDiskQueue() {
    try {
      fs.mkdirSync(path.dirname(this.queuePath), { recursive: true });
      fs.writeFileSync(this.queuePath, JSON.stringify(this.queue.slice(-500)), "utf8");
    } catch {
      // A memory queue still provides best-effort collection if disk storage is unavailable.
    }
  }

  async stop() {
    clearInterval(this.sampleTimer);
    clearInterval(this.flushTimer);
    clearInterval(this.settingsTimer);
    await this.flush();
    if (this.session) {
      try {
        await this.request(`/api/sessions/${this.session.id}/stop`, {
          method: "POST",
          body: JSON.stringify({ reason: "application_exit" }),
        });
      } catch {
        this.persistDiskQueue();
      }
    }
  }
}

async function safeActiveApplication() {
  if (process.platform !== "darwin") return undefined;
  const front = await execFileAsync("/usr/bin/lsappinfo", ["front"], { timeout: 1000 });
  const asn = front.stdout.trim();
  if (!asn) return undefined;
  const info = await execFileAsync(
    "/usr/bin/lsappinfo",
    ["info", "-only", "name", asn],
    { timeout: 1000 },
  );
  const match = info.stdout.match(/"LSDisplayName"="([^"]+)"/);
  return match?.[1]?.trim();
}

module.exports = { CollectorManager };
