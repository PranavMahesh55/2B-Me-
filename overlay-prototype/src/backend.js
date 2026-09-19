import { useEffect, useSyncExternalStore } from "react";

const API_BASE = "http://127.0.0.1:8765";
const WS_BASE = "ws://127.0.0.1:8765/ws";

const initialState = {
  connected: false,
  status: "STARTING",
  metrics: null,
  metricHistory: [],
  sessions: [],
  workflows: [],
  recommendations: [],
  privacy: {},
  sessionId: null,
  taskId: null,
  lastError: null,
};

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Backend request failed (${response.status})`);
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
      const stored = window.sessionStorage.getItem("2bme-live-session");
      let activeSession = stored ? JSON.parse(stored) : null;
      if (!activeSession?.id) {
        activeSession = await request("/api/sessions/start", {
          method: "POST",
          body: JSON.stringify({
            title: "Researching authentication documentation",
            workflow_type: "research_browsing",
            device_id: "device_local",
          }),
        });
        window.sessionStorage.setItem("2bme-live-session", JSON.stringify(activeSession));
      }
      this.update({
        connected: true,
        status: status.status,
        sessionId: activeSession.id,
        taskId: activeSession.task_id,
        lastError: null,
      });
      this.openSocket();
      await this.refreshAll();
      this.track("task_marker", "start", {
        application: "2Bme",
        windowContext: "desktop_overlay",
      });
      this.flushTimer = window.setInterval(() => this.flush(), 750);
      window.addEventListener("focus", this.handleFocus);
      window.addEventListener("blur", this.handleBlur);
      document.addEventListener("visibilitychange", this.handleVisibility);
      this.removeDesktopFocusListener = window.desktopAPI?.onWindowFocus?.((focused) => {
        this.track("window_focus", focused ? "focus" : "blur", { application: "2Bme" });
      });
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
    const [metrics, metricHistory, sessions, workflows, recommendations, privacy] = await Promise.all([
      request("/api/metrics/current"),
      request("/api/metrics/history?limit=60"),
      request("/api/sessions?limit=30"),
      request("/api/workflows"),
      request("/api/recommendations"),
      request("/api/privacy"),
    ]);
    this.update({ metrics, metricHistory, sessions, workflows, recommendations, privacy });
  }

  openSocket() {
    this.socket?.close();
    this.socket = new WebSocket(WS_BASE);
    this.socket.addEventListener("open", () => this.update({ connected: true, lastError: null }));
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "behavior_update") {
        this.update({ metrics: message.payload, status: "COLLECTING" });
        this.refreshLists();
      } else if (message.type === "system_status") {
        this.update({ status: message.payload.status });
      } else if (message.type === "workflow_updated" || message.type === "recommendation_created") {
        this.refreshLists();
      }
    });
    this.socket.addEventListener("close", () => {
      this.update({ connected: false });
      if (this.started) window.setTimeout(() => this.openSocket(), 1500);
    });
  }

  async refreshLists() {
    try {
      const [metricHistory, sessions, workflows, recommendations] = await Promise.all([
        request("/api/metrics/history?limit=60"),
        request("/api/sessions?limit=30"),
        request("/api/workflows"),
        request("/api/recommendations"),
      ]);
      this.update({ metricHistory, sessions, workflows, recommendations });
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
