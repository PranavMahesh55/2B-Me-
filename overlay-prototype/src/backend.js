import { useEffect, useSyncExternalStore } from "react";

const API_BASE = "http://127.0.0.1:8765";
const WS_BASE = "ws://127.0.0.1:8765/ws";

const initialState = {
  connected: false,
  status: "STARTING",
  metrics: null,
  metricHistory: [],
  // Windowed focus series for the rhythm chart. metricHistory cannot drive it:
  // every entry there re-aggregates the whole session, so the line is flat.
  rhythm: [],
  sessions: [],
  workflows: [],
  recommendations: [],
  privacy: {},
  sessionId: null,
  taskId: null,
  lastError: null,
  // The grant flow. `pendingIntent` is the /plan payload the backend broadcast;
  // `authorizing` is the state techspecsigner.md §9 #4 expects the UI to reach.
  pendingIntent: null,
  authorizing: false,
  grantError: null,
  lastReceipt: null,
};

export class GrantError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    // The grant routes answer with detail: { error: "<GrantErrorCode>" }, so
    // carry the code rather than stringifying an object into a message.
    const detail = payload.detail;
    if (detail && typeof detail === "object" && detail.error) {
      throw new GrantError(detail.error, detail.message);
    }
    throw new Error(typeof detail === "string" ? detail : `Backend request failed (${response.status})`);
  }
  return response.json();
}

class BehaviorBackendClient {
  constructor() {
    this.state = initialState;
    this.listeners = new Set();
    this.queue = [];
    this.started = false;
    this.tracking = true;
    this.flushTimer = null;
    this.retryTimer = null;
    this.socket = null;
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      const status = await request("/api/system/status");
      let activeSession = await window.desktopAPI?.getSession?.();
      if (!activeSession?.id) {
        activeSession = await request(
          "/api/sessions/active?device_id=device_local&workflow_type=deep_work",
        ).catch(() => null);
      }
      if (!activeSession?.id) {
        activeSession = await request("/api/sessions/start", {
          method: "POST",
          body: JSON.stringify({
            title: "Desktop work session",
            workflow_type: "deep_work",
            device_id: "device_local",
          }),
        });
      }
      window.sessionStorage.removeItem("2bme-live-session");
      this.update({
        connected: true,
        status: status.status,
        sessionId: activeSession.id,
        taskId: activeSession.task_id,
        lastError: null,
      });
      this.openSocket();
      await this.refreshAll();
      if (window.desktopAPI) {
        this.track("task_marker", "start", {
          application: "2Bme",
          windowContext: "desktop_overlay",
        });
      }
      this.flushTimer = window.setInterval(() => this.flush(), 750);
      if (window.desktopAPI) {
        window.addEventListener("focus", this.handleFocus);
        window.addEventListener("blur", this.handleBlur);
        document.addEventListener("visibilitychange", this.handleVisibility);
        this.removeDesktopFocusListener = window.desktopAPI.onWindowFocus?.((focused) => {
          this.track("window_focus", focused ? "focus" : "blur", { application: "2Bme" });
        });
      }
    } catch (error) {
      this.update({ connected: false, status: "OFFLINE", lastError: error.message });
      this.started = false;
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => this.start(), 2000);
    }
  }

  handleFocus = () => this.track("window_focus", "focus", { application: "2Bme" });
  handleBlur = () => this.track("window_focus", "blur", { application: "2Bme" });
  handleVisibility = () => this.track("window_focus", document.visibilityState, { application: "2Bme" });

  async refreshAll() {
    const sessionQuery = this.state.sessionId
      ? `?session_id=${encodeURIComponent(this.state.sessionId)}`
      : "";
    const historyQuery = this.state.sessionId
      ? `?limit=60&session_id=${encodeURIComponent(this.state.sessionId)}`
      : "?limit=60";
    const rhythmQuery = this.state.sessionId
      ? `?points=36&session_id=${encodeURIComponent(this.state.sessionId)}`
      : "?points=36";
    const [metrics, metricHistory, rhythm, sessions, workflows, recommendations, privacy] = await Promise.all([
      request(`/api/metrics/current${sessionQuery}`),
      request(`/api/metrics/history${historyQuery}`),
      request(`/api/metrics/rhythm${rhythmQuery}`),
      request("/api/sessions?limit=30"),
      request("/api/workflows"),
      request("/api/recommendations"),
      request("/api/privacy"),
    ]);
    this.update({ metrics, metricHistory, rhythm: rhythm.points || [], sessions, workflows, recommendations, privacy });
  }

  openSocket() {
    this.socket?.close();
    this.socket = new WebSocket(WS_BASE);
    this.socket.addEventListener("open", () => this.update({ connected: true, lastError: null }));
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "behavior_update") {
        if (message.payload.session_id !== this.state.sessionId) return;
        this.update({ metrics: message.payload, status: "COLLECTING" });
        this.refreshLists();
      } else if (message.type === "system_status") {
        this.update({ status: message.payload.status });
      } else if (message.type === "workflow_updated" || message.type === "recommendation_created") {
        this.refreshLists();
      } else if (message.type === "permission_request") {
        // This branch did not exist: the backend has always broadcast
        // permission_request from POST /api/automation/{id}/plan, and the client
        // dropped it, so the approval flow dead-ended.
        this.update({ pendingIntent: message.payload, grantError: null, authorizing: false });
      } else if (message.type === "automation_status") {
        if (message.payload.status === "denied") {
          this.update({ authorizing: false, grantError: { code: message.payload.error } });
        } else {
          this.update({
            authorizing: false,
            pendingIntent: null,
            grantError: null,
            lastReceipt: message.payload,
          });
          this.refreshLists();
        }
      }
    });
    this.socket.addEventListener("close", () => {
      this.update({ connected: false });
      if (this.started) window.setTimeout(() => this.openSocket(), 1500);
    });
  }

  async refreshLists() {
    try {
      const historyQuery = this.state.sessionId
        ? `?limit=60&session_id=${encodeURIComponent(this.state.sessionId)}`
        : "?limit=60";
      const rhythmQuery = this.state.sessionId
        ? `?points=36&session_id=${encodeURIComponent(this.state.sessionId)}`
        : "?points=36";
      const [metricHistory, rhythm, sessions, workflows, recommendations] = await Promise.all([
        request(`/api/metrics/history${historyQuery}`),
        request(`/api/metrics/rhythm${rhythmQuery}`),
        request("/api/sessions?limit=30"),
        request("/api/workflows"),
        request("/api/recommendations"),
      ]);
      this.update({ metricHistory, rhythm: rhythm.points || [], sessions, workflows, recommendations });
    } catch (error) {
      this.update({ lastError: error.message });
    }
  }

  track(eventType, action, options = {}) {
    if (!this.tracking || !this.state.sessionId || this.state.status === "PAUSED") return;
    this.queue.push({
      event_id: `evt_${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      session_id: this.state.sessionId,
      task_id: this.state.taskId,
      device_id: "device_local",
      application: options.application || "2Bme",
      window_context: options.windowContext || "desktop_overlay",
      event_type: eventType,
      action,
      duration_ms: options.durationMs || 0,
      metadata: options.metadata || {},
      data_origin: "live_observed",
    });
    if (this.queue.length >= 100) this.flush();
  }

  async flush() {
    if (!this.queue.length || !this.state.connected) return;
    const batch = this.queue.splice(0, 100);
    try {
      const metrics = await request("/api/events/batch", {
        method: "POST",
        body: JSON.stringify({ events: batch }),
      });
      if (metrics.has_live_data) this.update({ metrics });
    } catch (error) {
      this.queue = [...batch, ...this.queue].slice(0, 500);
      this.update({ connected: false, lastError: error.message });
    }
  }

  async setTracking(enabled) {
    this.tracking = enabled;
    const payload = await request(`/api/system/${enabled ? "resume" : "pause"}`, { method: "POST" });
    this.update({ status: payload.status });
    if (enabled) this.track("task_marker", "resume_tracking");
  }

  async updatePrivacy(key, enabled) {
    const result = await request(`/api/privacy/${key}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    this.update({ privacy: { ...this.state.privacy, [key]: result.enabled } });
    return result;
  }

  async createAutomation(workflowId) {
    return request(`/api/automation/${workflowId}/plan`, { method: "POST" });
  }

  /** Raises the Touch ID prompt through the Electron main process. */
  async requestGrant(intent, risk) {
    if (!window.desktopAPI?.requestGrant) {
      throw new GrantError("signer_unavailable", "Open the desktop app to authorize.");
    }
    const result = await window.desktopAPI.requestGrant({ plan: intent, risk });
    if (!result.ok) throw new GrantError(result.error, result.message);
    return result.token;
  }

  /**
   * The whole consent path: sign, then execute. The plan sent for execution is
   * the same object that was signed, so the broker's §7 step 6 check compares
   * like with like.
   */
  async authorizeAndExecute(planId, { tamper = null } = {}) {
    const pending = this.state.pendingIntent;
    if (!pending) throw new GrantError("malformed_request", "Nothing is awaiting authorization.");

    this.update({ authorizing: true, grantError: null });
    this.track("task_marker", "grant_requested", { metadata: { plan_id: planId, risk: pending.risk } });
    try {
      const token = await this.requestGrant(pending.intent, pending.risk);
      const receipt = await request(`/api/automation/${planId}/execute`, {
        method: "POST",
        body: JSON.stringify({ token, plan: pending.intent, tamper }),
      });
      this.update({ authorizing: false, pendingIntent: null, grantError: null, lastReceipt: receipt });
      await this.refreshLists();
      return receipt;
    } catch (error) {
      // Only report signer_unavailable when that is genuinely what happened.
      // Defaulting every unexpected error to it tells the user to open the
      // desktop app while they are already in it.
      this.update({
        authorizing: false,
        grantError: { code: error.code || "malformed_request", message: error.message },
      });
      throw error;
    }
  }

  dismissIntent() {
    this.update({ pendingIntent: null, grantError: null, authorizing: false });
  }

  async createWorkflow(name, steps) {
    return request("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ name, workflow_type: "custom", steps }),
    });
  }

  async updateWorkflow(workflowId, name, steps) {
    return request(`/api/workflows/${workflowId}`, {
      method: "PATCH",
      body: JSON.stringify({ name, steps }),
    });
  }

  // approveAutomation() and a token-less executeAutomation() were removed in the
  // merge rather than kept. /approve no longer exists -- it recorded an approval
  // boolean this process set for itself -- and /execute now requires a signed
  // grant. authorizeAndExecute() above is the replacement: it raises Touch ID,
  // gets an Enclave signature, and lets the broker verify before anything runs.

  /**
   * The assistant answers on the backend, where the sanitizer runs. Composing a
   * reply here out of raw `state.metrics` would sidestep that boundary, so the
   * privacy guarantee would only hold on a path nobody uses.
   */
  async askAssistant(question) {
    return request("/api/assistant/ask", {
      method: "POST",
      body: JSON.stringify({ question, session_id: this.state.sessionId }),
    });
  }

  async getVoiceBriefing(length = "standard") {
    return request("/api/voice/briefing", {
      method: "POST",
      body: JSON.stringify({ length, session_id: this.state.sessionId }),
    });
  }

  async sendFeedback(recommendationId, feedback, reason = null) {
    const result = await request(`/api/recommendations/${recommendationId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ feedback, reason }),
    });
    await this.refreshLists();
    return result;
  }
}

export const behaviorBackend = new BehaviorBackendClient();

export function useBehaviorBackend() {
  const state = useSyncExternalStore(behaviorBackend.subscribe, behaviorBackend.getSnapshot);
  useEffect(() => {
    behaviorBackend.start();
  }, []);
  return { ...state, client: behaviorBackend };
}
