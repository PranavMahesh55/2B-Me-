const { randomUUID } = require("node:crypto");

function normalizedEvent({ sessionId, taskId, application, eventType, action, durationMs = 0, metadata = {} }) {
  return {
    event_id: `evt_${randomUUID()}`,
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    task_id: taskId,
    device_id: "device_local",
    application: application || "Unknown",
    window_context: null,
    event_type: eventType,
    action,
    duration_ms: Math.max(0, Math.round(durationMs)),
    metadata,
    data_origin: "live_observed",
  };
}

module.exports = { normalizedEvent };

