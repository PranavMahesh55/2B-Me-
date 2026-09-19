import { useEffect, useMemo, useState } from "react";
import {
  ArrowSquareOut,
  CaretUp,
  Check,
  Clock,
  DotsSixVertical,
  DotsThree,
  EyeSlash,
  Gauge,
  Gear,
  Microphone,
  NotePencil,
  Pause,
  Play,
  ShieldCheck,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
} from "recharts";
import { rhythmData } from "./data.js";

function Brand({ compact = false }) {
  return (
    <div className={compact ? "brand brand--compact" : "brand"} aria-label="2B me">
      <span>2B</span><sup>me</sup>
    </div>
  );
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function Overlay({ expanded, onExpandedChange, onOpenDashboard, onHide, backend }) {
  const [tracking, setTracking] = useState(true);
  const [focusActive, setFocusActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [seconds, setSeconds] = useState(0);

  const liveMetrics = backend?.metrics?.has_live_data ? backend.metrics : null;
  const focusScore = liveMetrics ? Math.round(liveMetrics.focus * 100) : 0;
  const activityTitle = liveMetrics?.session_title || "Waiting for observed activity";
  const appSwitches = Number(liveMetrics?.evidence?.app_switches_per_min || 0);
  const rhythm = backend?.metricHistory?.length > 1
    ? backend.metricHistory.slice(-8).map((item, index) => ({
        time: index === backend.metricHistory.slice(-8).length - 1 ? "Now" : `${index + 1}`,
        value: Math.round(item.focus * 100),
      }))
    : rhythmData;

  useEffect(() => {
    if (!tracking) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tracking]);

  useEffect(() => {
    if (liveMetrics?.duration_s != null) setSeconds(Math.max(0, Math.round(liveMetrics.duration_s)));
  }, [liveMetrics?.duration_s]);

  useEffect(() => {
    if (backend?.status === "PAUSED") setTracking(false);
    if (backend?.status === "COLLECTING") setTracking(true);
  }, [backend?.status]);

  const stateLabel = useMemo(() => {
    if (!backend?.connected) return "Backend reconnecting";
    if (!tracking) return "Tracking paused";
    if (focusActive) return "Focus protected";
    if (!liveMetrics) return "Building baseline";
    return liveMetrics.behavior_label === "high_friction" ? "Friction detected" : "Good momentum";
  }, [backend?.connected, focusActive, liveMetrics, tracking]);

  const insight = useMemo(() => {
    if (!liveMetrics) return {
      title: "2Bᵐᵉ is building your local baseline.",
      body: "Only privacy-safe interaction metadata is used, and it stays on this device.",
    };
    if (liveMetrics.friction >= 0.44) return {
      title: "A repeated loop is creating friction.",
      body: `${appSwitches.toFixed(1)} application switches per minute are raising this task's friction score.`,
    };
    if (liveMetrics.focus >= 0.70) return {
      title: "Your work rhythm is steady right now.",
      body: "Low idle fragmentation and fewer context changes are supporting this session.",
    };
    return {
      title: "Your focus is stabilizing.",
      body: "2Bᵐᵉ is comparing this live task with the configured bootstrap baseline.",
    };
  }, [appSwitches, liveMetrics]);

  async function toggleTracking() {
    const next = !tracking;
    setTracking(next);
    try {
      await backend?.client.setTracking(next);
    } catch {
      setTracking(!next);
    }
  }

  function toggleExpanded() {
    setMenuOpen(false);
    setPrivacyOpen(false);
    onExpandedChange(!expanded);
  }

  function saveNote(event) {
    event.preventDefault();
    if (!note.trim()) return;
    setSavedNote(note.trim());
    backend?.client.track("task_marker", "note_saved", { metadata: { character_count: note.trim().length } });
    setNote("");
    setNoteOpen(false);
  }

  return (
    <section className={expanded ? "overlay-shell is-expanded" : "overlay-shell"} aria-label="2B me desktop overlay">
      <div className="overlay-capsule drag-region">
        <div className="capsule-brand">
          <Brand compact />
        </div>
        <div className={tracking ? "live-orb" : "live-orb is-paused"} aria-hidden="true" />
        <div className="capsule-activity">
          <strong>{activityTitle}</strong>
          <span>{stateLabel} · {formatDuration(seconds)}</span>
        </div>
        <div className="capsule-divider" />
        <button
          className="status-button no-drag"
          type="button"
          onClick={() => setPrivacyOpen((value) => !value)}
          aria-expanded={privacyOpen}
        >
          <Microphone weight="fill" aria-hidden="true" />
          <span>{tracking ? "Active" : "Paused"}</span>
        </button>
        <button
          className="icon-button no-drag"
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          aria-label="Overlay controls"
          aria-expanded={menuOpen}
        >
          <DotsThree weight="bold" />
        </button>
        <button
          className="collapse-button no-drag"
          type="button"
          onClick={toggleExpanded}
          aria-label={expanded ? "Collapse overlay" : "Expand overlay"}
        >
          <CaretUp className={expanded ? "" : "is-flipped"} weight="bold" />
        </button>

        {menuOpen && (
          <div className="overlay-menu no-drag" role="menu">
            <button type="button" onClick={() => { toggleTracking(); setMenuOpen(false); }}>
              {tracking ? <Pause /> : <Play />}
              <span>{tracking ? "Pause tracking" : "Resume tracking"}</span>
            </button>
            <button type="button" onClick={() => { setPrivacyOpen(true); setMenuOpen(false); }}>
              <ShieldCheck />
              <span>Privacy controls</span>
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); onOpenDashboard(); }}>
              <ArrowSquareOut />
              <span>Open dashboard</span>
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); onHide(); }}>
              <EyeSlash />
              <span>Hide overlay</span>
            </button>
          </div>
        )}

        {privacyOpen && (
          <div className="privacy-popover no-drag">
            <div className="popover-heading">
              <div>
                <span className="eyebrow">Tracking status</span>
                <strong>{tracking ? "Tracking active" : "Tracking paused"}</strong>
              </div>
              <button type="button" aria-label="Close privacy controls" onClick={() => setPrivacyOpen(false)}><X /></button>
            </div>
            <p>Apps, window changes, browser tabs, and keyboard timing are enabled. Screen content and clipboard contents are off.</p>
            <button className="text-link" type="button" onClick={onOpenDashboard}>Review privacy settings <ArrowSquareOut /></button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="overlay-panel">
          <div className="panel-summary">
            <div className="momentum-block">
              <span className="eyebrow eyebrow--lime">Current session</span>
              <div className="metric-line">
                <strong>{focusScore}</strong>
                <span>/100</span>
              </div>
              <div className="metric-badge"><Gauge weight="fill" /> Steady momentum</div>
            </div>
            <div className="insight-block">
              <div className="insight-label"><Sparkle weight="fill" /> Contextual insight</div>
              <h2>{insight.title}</h2>
              <p>{insight.body}</p>
              <button type="button" className="why-button" onClick={() => setEvidenceOpen((value) => !value)}>
                {evidenceOpen ? "Hide evidence" : "Why this?"}
              </button>
            </div>
          </div>

          {evidenceOpen && (
            <div className="evidence-strip">
              <Check weight="bold" />
              <span>{appSwitches.toFixed(1)} app switches/min · {Math.round((liveMetrics?.confidence || 0) * 100)}% model confidence · {liveMetrics?.model_version || "waiting for model"}</span>
            </div>
          )}

          <div className="rhythm-section">
            <div className="rhythm-heading">
              <div>
                <span className="eyebrow">60-minute rhythm</span>
                <strong>{activityTitle}</strong>
              </div>
              <span className="session-meta"><Clock /> Chrome + VS Code</span>
            </div>
            <div className="rhythm-chart" aria-label="Focus rhythm over the last 60 minutes">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rhythm} margin={{ top: 12, right: 3, left: 3, bottom: 0 }}>
                  <CartesianGrid vertical stroke="rgba(222,247,238,0.17)" horizontal={false} strokeDasharray="3 5" />
                  <XAxis dataKey="time" axisLine={{ stroke: "rgba(222,247,238,0.22)" }} tickLine={false} tick={{ fill: "rgba(231,245,241,0.5)", fontSize: 10 }} interval={1} />
                  <Area type="monotone" dataKey="value" stroke="#c7f36b" strokeWidth={3} fill="rgba(199,243,107,0.14)" dot={false} activeDot={{ r: 5, fill: "#102d2c", stroke: "#c7f36b", strokeWidth: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {noteOpen && (
            <form className="quick-note" onSubmit={saveNote}>
              <label htmlFor="overlay-note">Capture a thought without leaving your work</label>
              <div>
                <input id="overlay-note" autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should future you remember?" />
                <button type="submit">Save</button>
              </div>
            </form>
          )}

          {savedNote && !noteOpen && (
            <div className="saved-note"><Check weight="bold" /> Note saved: “{savedNote}”</div>
          )}

          <div className="panel-actions">
            <button
              className={focusActive ? "primary-action is-active" : "primary-action"}
              type="button"
              onClick={() => {
                const next = !focusActive;
                setFocusActive(next);
                backend?.client.track("task_marker", next ? "focus_started" : "focus_paused");
              }}
            >
              {focusActive ? <Pause weight="fill" /> : <Play weight="fill" />}
              {focusActive ? "Pause focus" : "Start focus"}
            </button>
            <button className="secondary-action" type="button" onClick={() => setNoteOpen((value) => !value)}>
              <NotePencil weight="fill" />
              {noteOpen ? "Close note" : "Capture note"}
            </button>
          </div>

          <footer className="panel-footer">
            <span className="drag-copy drag-region"><DotsSixVertical /> Drag to reposition</span>
            <button type="button" onClick={toggleTracking}>
              {tracking ? <Microphone weight="fill" /> : <Microphone />}
              {tracking ? "Tracking active" : "Tracking paused"}
              <span className={tracking ? "tiny-status" : "tiny-status is-paused"} />
            </button>
            <button type="button" aria-label="Open settings" onClick={onOpenDashboard}><Gear /></button>
          </footer>
        </div>
      )}
    </section>
  );
}

export { Brand };
