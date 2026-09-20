import { useEffect, useMemo, useState } from "react";
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
} from "recharts";
import { rhythmData } from "./data.js";

// §3's TTLs. The countdown is the honest reason to hurry: the grant really does
// stop being valid.
const TTL_BY_RISK = { low: 300, medium: 120, high: 60 };

const OPERATION_LABEL = {
  open_application: "open an application",
  prepare_context: "prepare workflow context",
  draft_response: "draft a response",
};

/**
 * One entry per GrantErrorCode the UI can receive. §5 is explicit that
 * biometry_changed needs copy of its own -- "try again" is wrong advice when the
 * key is gone -- and connector_failed must not read like a denial, because the
 * authorization succeeded and only the action failed.
 */
const GRANT_COPY = {
  presence_cancelled: { title: "Authorization cancelled", body: "Nothing ran.", retry: true },
  presence_failed: { title: "Touch ID didn't recognise you", body: "Try again.", retry: true },
  biometry_changed: {
    title: "Your fingerprint enrolment changed",
    body: "The signing key on this Mac was invalidated the moment Touch ID enrolment changed. That is deliberate. It has to be re-created before anything can be authorized.",
    retry: false,
  },
  key_missing: { title: "No signing key on this Mac", body: "2Bᵐᵉ will create one the next time the signer starts.", retry: false },
  unknown_operation: { title: "Not an approved operation", body: "This action isn't in the allowed list, so 2Bᵐᵉ won't sign it.", retry: false },
  malformed_request: { title: "2Bᵐᵉ couldn't build a valid request", body: "Nothing was authorized.", retry: false },
  signature_invalid: { title: "The authorization didn't verify", body: "Nothing ran. The broker could not confirm this came from your Mac's key.", retry: false },
  expired: { title: "That authorization expired", body: "Authorizations are deliberately short-lived. Authorize again.", retry: true },
  not_yet_valid: { title: "Clock mismatch", body: "Your Mac and the broker disagree about the time. Nothing ran.", retry: false },
  replayed: { title: "Already used", body: "Each authorization signs exactly one action.", retry: true },
  plan_mismatch: { title: "The action changed after you authorized it", body: "The broker refused it. Nothing ran.", retry: true },
  param_mismatch: { title: "The action carried details you never authorized", body: "The broker refused it. Nothing ran.", retry: true },
  call_budget_exhausted: { title: "That authorization is spent", body: "Authorize again.", retry: true },
  connector_failed: { title: "You authorized it \u2014 the action failed", body: "The authorization was valid; the action itself did not complete.", retry: true },
  broker_unavailable: { title: "The local broker isn't running", body: "Nothing ran. Start it and try again.", retry: true },
  signer_unavailable: { title: "Open the desktop app to authorize", body: "A browser preview can't reach this Mac's signing key.", retry: false },
};

function grantCopy(code) {
  // Any code the UI does not recognise still declines safely.
  return GRANT_COPY[code] || { title: "Authorization declined", body: `Nothing ran (${code}).`, retry: false };
}

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
  const [grantSeconds, setGrantSeconds] = useState(0);

  const pendingIntent = backend?.pendingIntent || null;
  const authorizing = Boolean(backend?.authorizing);
  const grantError = backend?.grantError || null;
  const receipt = backend?.lastReceipt || null;

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

        <p className="intent-footnote">
          <ShieldCheck weight="fill" aria-hidden="true" />
          Signed on this Mac by the Secure Enclave. Only these details are authorized — anything
          added afterwards is refused.
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
              <span className="session-meta"><Clock /> Local event stream</span>
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

          {pendingIntent && renderIntent()}

          {!pendingIntent && receipt?.audit_index !== undefined && (
            <div className="saved-note">
              <Check weight="bold" /> Executed · audit #{receipt.audit_index} · {String(receipt.audit_hash).slice(0, 12)}…
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
