import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  CaretUp,
  Check,
  Clock,
  DotsSixVertical,
  DotsThree,
  EyeSlash,
  Fingerprint,
  Gauge,
  Gear,
  Microphone,
  NotePencil,
  Pause,
  Play,
  ShieldCheck,
  Sparkle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { rhythmData } from "./data.js";
import { grantCopy } from "./grantCopy.js";

// §3's TTLs. The countdown is the honest reason to hurry: the grant really does
// stop being valid.
const TTL_BY_RISK = { low: 300, medium: 120, high: 60 };

const OPERATION_LABEL = {
  open_application: "open an application",
  prepare_context: "prepare workflow context",
  draft_response: "draft a response",
  summarize_clipboard: "send the copied section to ChatGPT",
};


function Brand({ compact = false }) {
  return (
    <div className={compact ? "brand brand--compact" : "brand"} aria-label="2B me">
      <span>2B</span><sup>me</sup>
    </div>
  );
}

const SCANNER_TRAIL = [
  { begin: "0s", r: 3.6, opacity: 0.95 },
  { begin: "-0.16s", r: 2.9, opacity: 0.5 },
  { begin: "-0.32s", r: 2.3, opacity: 0.32 },
  { begin: "-0.5s", r: 1.8, opacity: 0.2 },
  { begin: "-0.7s", r: 1.3, opacity: 0.12 },
];

function NowDot({ cx, cy, index, pointCount }) {
  if (cx == null || cy == null || index !== pointCount - 1) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r="9" fill="#c7f36b" opacity="0.16" />
      <circle cx={cx} cy={cy} r="3.5" fill="#c7f36b" />
      <circle cx={cx} cy={cy} r="3.5" fill="none" stroke="#c7f36b" strokeWidth="1.5">
        <animate attributeName="r" values="3.5;14" dur="2.1s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.75;0" dur="2.1s" repeatCount="indefinite" />
      </circle>
    </g>
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
  const [grantSeconds, setGrantSeconds] = useState(0);

  const pendingIntent = backend?.pendingIntent || null;
  const authorizing = Boolean(backend?.authorizing);
  const grantError = backend?.grantError || null;
  const receipt = backend?.lastReceipt || null;

  const liveMetrics = backend?.metrics?.has_live_data ? backend.metrics : null;

  // The headline number is "current session", so it has to mean current.
  // backend.metrics.focus re-aggregates the whole session, which after half an
  // hour barely moves however hard you are working -- typing for a minute
  // cannot shift a thirty-minute average. The newest windowed point is the same
  // scorer over a trailing window, so it responds.
  const latestWindow = backend?.rhythm?.length ? backend.rhythm[backend.rhythm.length - 1] : null;
  const focusScore = latestWindow
    ? Math.round(latestWindow.focus * 100)
    : liveMetrics
      ? Math.round(liveMetrics.focus * 100)
      : 0;
  const keysPerMin = Number(
    latestWindow?.keystrokes_per_min ?? liveMetrics?.evidence?.keystrokes_per_min ?? 0,
  );
  const activityTitle = liveMetrics?.session_title || "Waiting for observed activity";
  const appSwitches = Number(liveMetrics?.evidence?.app_switches_per_min || 0);
  // Up to 36 points rather than 8: the curve was flat because there was barely
  // anything to draw, not because the session was steady.
  // /api/metrics/rhythm, not metricHistory: every entry in the latter is the
  // whole session re-aggregated, so consecutive points are identical and the
  // line is flat by construction. This one scores a trailing window at each
  // step, so it reflects when the work actually happened.
  const rhythm = useMemo(() => {
    const points = backend?.rhythm || [];
    if (points.length < 2) {
      return rhythmData.map((item) => ({ ...item, friction: null }));
    }
    return points.map((point, index) => {
      // Only the newest point is "Now". Testing minutes_ago < 1 labelled every
      // tick "Now" on a session younger than a minute.
      const isLatest = index === points.length - 1;
      const minutes = point.minutes_ago;
      return {
        time: isLatest
          ? "Now"
          : minutes >= 1
            ? `-${Math.round(minutes)}m`
            : `-${Math.max(1, Math.round(minutes * 60))}s`,
        value: Math.round(point.focus * 100),
        friction: Math.round(point.friction * 100),
      };
    });
  }, [backend?.rhythm]);

  const chartRef = useRef(null);
  const [track, setTrack] = useState(null);

  // Recharts owns the scaling, so the scanner follows the path it actually
  // drew. Re-read whenever the series changes or the panel resizes.
  useEffect(() => {
    const node = chartRef.current;
    if (!node) return undefined;

    const read = () => {
      const curve = node.querySelector(".recharts-area-curve");
      const surface = node.querySelector("svg.recharts-surface");
      const d = curve?.getAttribute("d");
      if (!d || !surface) return;
      const width = surface.width?.baseVal?.value || node.clientWidth;
      const height = surface.height?.baseVal?.value || node.clientHeight;
      setTrack((current) => (current?.d === d && current?.width === width ? current : { d, width, height }));
    };

    // The area animates into place on data change; read after it settles.
    const settle = window.setTimeout(read, 1000);
    const frame = window.requestAnimationFrame(read);
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => {
      window.clearTimeout(settle);
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rhythm]);

  // Chosen explicitly so the newest point is always labelled. A numeric
  // interval takes every Nth tick and can skip the final one, which leaves the
  // axis ending on "-1s" instead of "Now".
  const xTicks = useMemo(() => {
    if (rhythm.length <= 5) return rhythm.map((point) => point.time);
    const step = (rhythm.length - 1) / 4;
    const picked = [0, 1, 2, 3, 4].map((slot) => rhythm[Math.round(slot * step)].time);
    return [...new Set(picked)];
  }, [rhythm]);

  const focusRange = useMemo(() => {
    const values = rhythm.map((point) => point.value).filter((value) => Number.isFinite(value));
    if (!values.length) return { low: 0, high: 100, min: 0, max: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(2, (max - min) * 0.45);
    return { low: Math.max(0, min - pad), high: Math.min(100, max + pad), min, max };
  }, [rhythm]);

  useEffect(() => {
    if (!tracking) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [tracking]);

  useEffect(() => {
    if (liveMetrics?.duration_s != null) setSeconds(Math.max(0, Math.round(liveMetrics.duration_s)));
  }, [liveMetrics?.duration_s]);

  useEffect(() => {
    if (!pendingIntent) return undefined;
    setGrantSeconds(TTL_BY_RISK[pendingIntent.risk] ?? 120);
    const timer = window.setInterval(() => setGrantSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [pendingIntent]);

  useEffect(() => {
    if (backend?.status === "PAUSED") setTracking(false);
    if (backend?.status === "COLLECTING") setTracking(true);
  }, [backend?.status]);

  const stateLabel = useMemo(() => {
    if (!backend?.connected) return "Backend reconnecting";
    // §9 #4: the UI has to reach an observable `authorizing` state.
    if (authorizing) return "Waiting for Touch ID";
    if (pendingIntent) return "Authorization required";
    if (!tracking) return "Tracking paused";
    if (focusActive) return "Focus protected";
    if (!liveMetrics) return "Building baseline";
    return liveMetrics.behavior_label === "high_friction" ? "Friction detected" : "Good momentum";
  }, [authorizing, backend?.connected, focusActive, liveMetrics, pendingIntent, tracking]);

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
      body: "2Bᵐᵉ is comparing this task against your recent sessions.",
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

  async function authorize() {
    try {
      await backend?.client.authorizeAndExecute(pendingIntent.id);
    } catch {
      // The error is already in backend.grantError; the card renders it.
    }
  }

  function renderIntent() {
    const intent = pendingIntent.intent || {};
    const paramKeys = Object.keys(intent.params || {});
    const copy = grantError ? grantCopy(grantError.code) : null;
    const risk = pendingIntent.risk || "high";

    return (
      <div className="intent-card no-drag" role="group" aria-label="Authorization required">
        <div className="intent-heading">
          <span className="eyebrow eyebrow--lime">Authorization required</span>
          <span className={`risk-pill risk-pill--${risk}`}>
            {risk[0].toUpperCase() + risk.slice(1)} risk · expires in {formatDuration(grantSeconds)}
          </span>
        </div>

        <h3>2Bᵐᵉ wants to {OPERATION_LABEL[intent.operation] || intent.operation}</h3>

        <dl className="intent-rows">
          <div><dt>Connector</dt><dd>{intent.connector}</dd></div>
          <div><dt>Operation</dt><dd>{intent.operation}</dd></div>
          <div><dt>Resource</dt><dd>{intent.resource}</dd></div>
          <div><dt>Bound details</dt><dd>{paramKeys.length ? paramKeys.join(", ") : "none"}</dd></div>
        </dl>

        {/* This operation sends the copied section off the device, so the card
            has to show the section rather than just name the parameter. */}
        {intent.params?.excerpt && (
          <div className="intent-excerpt">
            <span className="eyebrow">
              Leaves this Mac · {intent.params.characters} characters
            </span>
            <blockquote>“{intent.params.excerpt}…”</blockquote>
          </div>
        )}

        <p className="intent-footnote">
          <ShieldCheck weight="fill" aria-hidden="true" />
          {intent.params?.excerpt
            ? "Signed on this Mac by the Secure Enclave. This exact text is bound to the authorization — if you copy something else before it runs, it is refused."
            : "Signed on this Mac by the Secure Enclave. Only these details are authorized — anything added afterwards is refused."}
        </p>

        {copy && (
          <div className="intent-alert" role="alert">
            <WarningCircle weight="fill" aria-hidden="true" />
            <div><strong>{copy.title}</strong><span>{copy.body}</span></div>
          </div>
        )}

        <div className="intent-actions">
          <button
            className="primary-action"
            type="button"
            onClick={authorize}
            disabled={authorizing || grantSeconds === 0 || (grantError && !grantCopy(grantError.code).retry)}
            aria-busy={authorizing}
          >
            <Fingerprint weight="fill" />
            {authorizing ? "Waiting for Touch ID…" : grantError ? "Try again" : "Authorize with Touch ID"}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => backend?.client.dismissIntent()}
            disabled={authorizing}
          >
            Not now
          </button>
        </div>
      </div>
    );
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
      <div className={pendingIntent ? "overlay-capsule overlay-capsule--intent drag-region" : "overlay-capsule drag-region"}>
        <div className="capsule-brand">
          <Brand compact />
        </div>
        <div className={tracking ? "live-orb" : "live-orb is-paused"} aria-hidden="true" />
        <div className="capsule-activity">
          <strong>{activityTitle}</strong>
          <span>{stateLabel} · {formatDuration(seconds)}</span>
        </div>
        {pendingIntent && (
          <button
            className="capsule-intent no-drag"
            type="button"
            onClick={() => onExpandedChange(true)}
            title="An action is waiting for your authorization"
          >
            <ShieldCheck weight="fill" aria-hidden="true" />
            <span>{authorizing ? "Touch ID…" : "Authorize"}</span>
          </button>
        )}
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
              <div className="metric-badge">
                <Gauge weight="fill" />
                {focusScore >= 75 ? "Strong momentum" : focusScore >= 55 ? "Steady momentum" : "Fragmented"}
              </div>
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
              <span>{keysPerMin.toFixed(0)} keystrokes/min · {appSwitches.toFixed(1)} app switches/min · {Math.round((liveMetrics?.confidence || 0) * 100)}% model confidence</span>
            </div>
          )}

          <div className="rhythm-section">
            <div className="rhythm-heading">
              <div>
                <span className="eyebrow">60-minute rhythm</span>
                <strong>{activityTitle}</strong>
              </div>
              <span className="session-meta">
                <Clock /> {focusRange.min === focusRange.max
                  ? `focus ${focusRange.min}`
                  : `focus ${focusRange.min}–${focusRange.max}`}
              </span>
            </div>
            <div className="rhythm-chart is-live" ref={chartRef} aria-label="Focus rhythm over the last 60 minutes">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rhythm} margin={{ top: 14, right: 6, left: 3, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rhythmFocusFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c7f36b" stopOpacity="0.52" />
                      <stop offset="55%" stopColor="#c7f36b" stopOpacity="0.14" />
                      <stop offset="100%" stopColor="#c7f36b" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="rhythmFocusStroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#7fbf4a" />
                      <stop offset="60%" stopColor="#c7f36b" />
                      <stop offset="100%" stopColor="#eaffb0" />
                    </linearGradient>
                    <filter id="rhythmGlow" x="-40%" y="-60%" width="180%" height="260%">
                      <feGaussianBlur stdDeviation="3.2" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid vertical stroke="rgba(222,247,238,0.17)" horizontal={false} strokeDasharray="3 5" />
                  <XAxis
                    dataKey="time"
                    axisLine={{ stroke: "rgba(222,247,238,0.22)" }}
                    tickLine={false}
                    tick={{ fill: "rgba(231,245,241,0.5)", fontSize: 10 }}
                    ticks={xTicks}
                    interval={0}
                  />
                  {/* Scaled to the actual spread; the heading prints the span. */}
                  <YAxis hide domain={[focusRange.low, focusRange.high]} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="url(#rhythmFocusStroke)"
                    strokeWidth={3}
                    fill="url(#rhythmFocusFill)"
                    filter="url(#rhythmGlow)"
                    dot={<NowDot pointCount={rhythm.length} />}
                    activeDot={{ r: 5, fill: "#102d2c", stroke: "#c7f36b", strokeWidth: 3 }}
                    isAnimationActive
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              </ResponsiveContainer>

              {track && (
                <svg
                  className="rhythm-scanner"
                  width={track.width}
                  height={track.height}
                  viewBox={`0 0 ${track.width} ${track.height}`}
                  aria-hidden="true"
                >
                  <defs>
                    <path id="rhythmTrack" d={track.d} fill="none" />
                    <filter id="scannerGlow" x="-300%" y="-300%" width="700%" height="700%">
                      <feGaussianBlur stdDeviation="2.4" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {SCANNER_TRAIL.map((ghost, index) => (
                    <circle
                      key={ghost.begin}
                      r={ghost.r}
                      fill="#eaffb0"
                      opacity={ghost.opacity}
                      filter={index === 0 ? "url(#scannerGlow)" : undefined}
                    >
                      <animateMotion
                        dur="7s"
                        begin={ghost.begin}
                        repeatCount="indefinite"
                        calcMode="linear"
                        keyPoints="0;1"
                        keyTimes="0;1"
                      >
                        <mpath href="#rhythmTrack" />
                      </animateMotion>
                    </circle>
                  ))}
                </svg>
              )}
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

          {pendingIntent && renderIntent()}

          {!pendingIntent && receipt?.audit_index !== undefined && (
            <div className="saved-note">
              <Check weight="bold" />
              {/* Say what it did. "Executed - audit #3" is unreadable when the
                  applications were already running, because bringing them
                  forward looks like nothing happening at all. */}
              {receipt.result?.message || "Executed"} · audit #{receipt.audit_index}
            </div>
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
