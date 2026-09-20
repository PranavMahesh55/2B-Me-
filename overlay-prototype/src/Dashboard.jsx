import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  ArrowLeft,
  ArrowRight,
  Brain,
  ChartLineUp,
  ChatCircleDots,
  Check,
  Clock,
  FlowArrow,
  Gear,
  Lightbulb,
  List,
  MagicWand,
  MagnifyingGlass,
  Pause,
  Play,
  Repeat,
  ShieldCheck,
  Sparkle,
  SquaresFour,
  Plus,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Brand } from "./Overlay.jsx";
import { trackingSources } from "./data.js";

const navigation = [
  ["Overview", SquaresFour],
  ["Activity", ActivityIcon],
  ["Workflows", FlowArrow],
  ["Insights", Lightbulb],
  ["AI Assistant", ChatCircleDots],
  ["Settings", Gear],
];

const privacyKeys = {
  "Application activity": "application_activity",
  "Window switching": "window_switching",
  "Window titles": "window_titles",
  "Browser tab activity": "browser_context",
  "Keyboard timing": "keyboard_timing",
  "Clipboard events": "clipboard_metadata",
  "Screen content": "visual_interpretation",
  "AI analysis": "ai_analysis",
};

function durationLabel(seconds = 0) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (!minutes) return `${safe}s`;
  return `${minutes}m`;
}

function friendlyAction(action = "") {
  return action.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function WorkflowBuilder({ workflow, backend, onClose }) {
  const [stage, setStage] = useState("review");
  const [name, setName] = useState(workflow?.name || "My workflow");
  const [steps, setSteps] = useState(
    workflow?.steps?.length
      ? workflow.steps.map((step) => ({ ...step }))
      : [{ application: "", action: "" }, { application: "", action: "" }],
  );
  const [savedWorkflow, setSavedWorkflow] = useState(workflow || null);
  const [plan, setPlan] = useState(null);
  const [approvedPermissions, setApprovedPermissions] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isValid = name.trim().length >= 2
    && steps.length >= 2
    && steps.every((step) => step.application.trim() && step.action.trim());

  function updateStep(index, key, value) {
    setSteps((items) => items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: value } : item
    )));
  }

  async function preparePlan() {
    if (!isValid) return;
    setBusy(true);
    setError("");
    try {
      const cleanedSteps = steps.map((step) => ({
        application: step.application.trim(),
        action: step.action.trim().toLowerCase().replaceAll(" ", "_"),
      }));
      const saved = savedWorkflow?.id
        ? await backend.client.updateWorkflow(savedWorkflow.id, name.trim(), cleanedSteps)
        : await backend.client.createWorkflow(name.trim(), cleanedSteps);
      const nextPlan = await backend.client.createAutomation(saved.id);
      setSavedWorkflow(saved);
      setPlan(nextPlan);
      setApprovedPermissions(nextPlan.required_permissions);
      setStage("permissions");
      await backend.client.refreshAll();
    } catch (caught) {
      setError(caught.message || "The workflow could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  function togglePermission(permission) {
    setApprovedPermissions((items) => (
      items.includes(permission)
        ? items.filter((item) => item !== permission)
        : [...items, permission]
    ));
  }

  async function runPreview() {
    if (!plan || approvedPermissions.length !== plan.required_permissions.length) return;
    setBusy(true);
    setError("");
    try {
      // preparePlan() already broadcast permission_request, so the overlay's
      // consent card is showing the same pending grant. This routes through it:
      // Touch ID, a Secure Enclave signature, then the broker verifies before
      // anything runs. Ticking the boxes above is an acknowledgement, not the
      // authorization -- that was the unattested boolean this replaced.
      const preview = await backend.client.authorizeAndExecute(plan.id);
      setResult(preview);
      setStage("test");
    } catch (caught) {
      setError(caught.message || "The preview could not run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workflow-builder-backdrop" role="presentation">
      <section className="workflow-builder" role="dialog" aria-modal="true" aria-labelledby="workflow-builder-title">
        <header className="workflow-builder__header">
          <div>
            <span className="section-label">Create workflow</span>
            <h2 id="workflow-builder-title">Turn observed work into a safe preview</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close workflow builder"><X /></button>
        </header>

        <div className="workflow-builder__progress" aria-label="Workflow creation progress">
          {["review", "permissions", "test"].map((item, index) => (
            <div className={stage === item ? "is-current" : (["review", "permissions", "test"].indexOf(stage) > index ? "is-complete" : "")} key={item}>
              <span>{index + 1}</span>{friendlyAction(item)}
            </div>
          ))}
        </div>

        {stage === "review" && (
          <div className="workflow-builder__body">
            <div className="builder-evidence">
              <strong>{workflow ? "Review the detected evidence" : "Define the workflow manually"}</strong>
              <span>{workflow ? `${workflow.repeat_count} observations · ${durationLabel(workflow.average_duration_s)} average · ${Math.round(workflow.confidence * 100)}% detection confidence` : "Add meaningful application and action names. Passive activity signals are excluded."}</span>
            </div>
            <label className="builder-field">
              <span>Workflow name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Research and summarize a topic" />
            </label>
            <div className="builder-step-heading"><span>Steps</span><small>Review, rename, or remove anything inaccurate.</small></div>
            <div className="builder-steps">
              {steps.map((step, index) => (
                <div className="builder-step" key={`${index}-${step.application}`}>
                  <span className="step-number">{index + 1}</span>
                  <label><span>Application</span><input value={step.application} onChange={(event) => updateStep(index, "application", event.target.value)} placeholder="Chrome" /></label>
                  <label><span>Action</span><input value={friendlyAction(step.action)} onChange={(event) => updateStep(index, "action", event.target.value)} placeholder="Open documentation" /></label>
                  <button type="button" onClick={() => setSteps((items) => items.filter((_, itemIndex) => itemIndex !== index))} disabled={steps.length <= 2} aria-label={`Remove step ${index + 1}`}><Trash /></button>
                </div>
              ))}
            </div>
            <button className="builder-add-step" type="button" onClick={() => setSteps((items) => [...items, { application: "", action: "" }])}><Plus /> Add step</button>
          </div>
        )}

        {stage === "permissions" && plan && (
          <div className="workflow-builder__body">
            <div className="builder-evidence builder-evidence--safe"><ShieldCheck weight="fill" /><div><strong>Preview only</strong><span>No messages are sent and no external data is changed during this test.</span></div></div>
            <div className="builder-plan-grid">
              <div><span className="section-label">Planned actions</span>{plan.actions.map((action, index) => <p key={`${action.type}-${index}`}><Check /> {friendlyAction(action.type)}{action.application ? ` — ${action.application}` : ""}</p>)}</div>
              <div><span className="section-label">Permissions</span>{plan.required_permissions.map((permission) => <label className="permission-row" key={permission}><input type="checkbox" checked={approvedPermissions.includes(permission)} onChange={() => togglePermission(permission)} /><span><strong>{friendlyAction(permission)}</strong><small>Required for this preview only</small></span></label>)}</div>
            </div>
          </div>
        )}

        {stage === "test" && result && (
          <div className="workflow-builder__body builder-result">
            <div className="builder-result__icon"><Check weight="bold" /></div>
            <span className="section-label">Preview completed</span>
            <h3>{savedWorkflow.name} is ready</h3>
            <p>{result.result?.message || "The workflow preview completed successfully."}</p>
            <div><strong>Mode</strong><span>{friendlyAction(result.result?.mode || "preview_only")}</span></div>
          </div>
        )}

        {error && <div className="builder-error" role="alert"><WarningCircle weight="fill" /> {error}</div>}
        <footer className="workflow-builder__footer">
          {stage === "permissions" && <button className="secondary-small" type="button" onClick={() => setStage("review")}>Back</button>}
          <span />
          {stage === "review" && <button className="primary-small" type="button" disabled={!isValid || busy} onClick={preparePlan}>{busy ? "Preparing…" : "Review permissions"}</button>}
          {stage === "permissions" && <button className="primary-small" type="button" disabled={busy || approvedPermissions.length !== plan.required_permissions.length} onClick={runPreview}>{busy ? "Waiting for Touch ID…" : "Authorize with Touch ID"}</button>}
          {stage === "test" && <button className="primary-small" type="button" onClick={onClose}>Done</button>}
        </footer>
      </section>
    </div>
  );
}

function Header({ title, description, onBack, backend }) {
  return (
    <header className="dashboard-header drag-region">
      <div className="dashboard-title-wrap">
        <button className="back-button no-drag" type="button" onClick={onBack} aria-label="Return to overlay"><ArrowLeft /></button>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="header-actions no-drag">
        <div className="tracking-chip"><span /> {backend.connected ? (backend.status === "PAUSED" ? "Tracking paused" : "Backend connected") : "Backend reconnecting"}</div>
        <button type="button" className="icon-button icon-button--light" aria-label="Search"><MagnifyingGlass /></button>
        <div className="avatar">PM</div>
      </div>
    </header>
  );
}

function Overview({ backend }) {
  const metrics = backend.metrics;
  const workflow = backend.workflows[0];
  const recommendation = backend.recommendations[0];
  const [builderOpen, setBuilderOpen] = useState(false);
  const switches = metrics?.has_live_data
    ? Math.round((metrics.evidence?.app_switches_per_min || 0) * Math.max(metrics.duration_s / 60, 1))
    : 0;
  const metricCards = [
    { label: "Observed work", value: durationLabel(metrics?.duration_s), detail: metrics?.has_live_data ? "Current local session" : "Waiting for live activity", icon: Clock, tone: "lime" },
    { label: "Context switches", value: String(switches), detail: `${Number(metrics?.evidence?.app_switches_per_min || 0).toFixed(1)} per minute`, icon: Repeat, tone: "blue" },
    { label: "Friction score", value: `${Math.round((metrics?.friction || 0) * 100)}`, detail: metrics?.behavior_label?.replaceAll("_", " ") || "Collecting baseline", icon: WarningCircle, tone: "orange" },
    { label: "Workflows found", value: String(backend.workflows.length), detail: `${backend.workflows.filter((item) => item.automation_potential >= 0.68).length} automation-ready`, icon: FlowArrow, tone: "violet" },
  ];

  return (
    <div className="dashboard-page">
      <section className="metrics-row" aria-label="Today’s behavioral summary">
        {metricCards.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <div className={`metric-icon metric-icon--${metric.tone}`}><metric.icon weight="fill" /></div>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="overview-grid">
        <article className="dashboard-card current-session-card">
          <div className="card-heading">
            <div>
              <span className="section-label">Current session</span>
              <h2>{metrics?.session_title || "Waiting for observed activity"}</h2>
            </div>
            <span className="live-label"><span /> Live</span>
          </div>
          <div className="session-statline">
            <div><span>Duration</span><strong>{durationLabel(metrics?.duration_s)}</strong></div>
            <div><span>Source</span><strong>{metrics?.data_origin === "live_observed" ? "Live local events" : "Awaiting events"}</strong></div>
            <div><span>Workflow</span><strong>{metrics?.workflow_type?.replaceAll("_", " ") || "Learning"}</strong></div>
            <div><span>State</span><strong className="positive-copy">{metrics?.behavior_label?.replaceAll("_", " ") || "Starting"}</strong></div>
          </div>
          <div className="session-track" aria-label="Session focus stability">
            <span className="session-track__focus" />
            <span className="session-track__switch" />
            <span className="session-track__focus session-track__focus--long" />
          </div>
          <div className="track-legend"><span>{backend.sessions[0] ? new Date(backend.sessions[0].started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Start"}</span><span>{switches} app switches</span><span>Now</span></div>
        </article>

        <article className="dashboard-card important-insight-card">
          <div className="insight-symbol"><Sparkle weight="fill" /></div>
          <span className="section-label">Important insight</span>
          <h2>{metrics?.has_live_data ? (metrics.friction >= 0.44 ? "This task has elevated friction." : "Your current work rhythm is stabilizing.") : "Waiting for enough local evidence."}</h2>
          <p>{metrics?.has_live_data ? `The live focus score is ${Math.round(metrics.focus * 100)} with ${Number(metrics.evidence?.app_switches_per_min || 0).toFixed(1)} app switches per minute.` : "2Bᵐᵉ will surface an evidence-backed insight after the first local event batch."}</p>
          <button type="button" className="inline-action">See supporting evidence <ArrowRight /></button>
        </article>

        <article className="dashboard-card workflow-card">
          <div className="card-heading">
            <div>
              <span className="section-label">Detected workflow</span>
              <h2>{workflow?.name || "Learning repeated sequences"}</h2>
            </div>
            <span className="confidence-chip">{Math.round((workflow?.confidence || metrics?.confidence || 0) * 100)}% confidence</span>
          </div>
          <div className="workflow-mini-sequence">
            {(workflow?.steps || [{ application: "Observe", action: "Collect a complete trace" }, { application: "Compare", action: "Find a repeated sequence" }, { application: "Review", action: "Confirm the steps" }]).map((step, index, all) => (
              <div key={`${step.application}-${step.action}-${index}`}>
                <span><strong>{friendlyAction(step.action)}</strong><small>{step.application}</small></span>
                {index < all.length - 1 && <ArrowRight />}
              </div>
            ))}
          </div>
          <p className="muted-copy">{workflow ? `Detected ${workflow.repeat_count} times · ${durationLabel(workflow.average_duration_s)} average duration` : "No personal workflow history has been inferred yet"}</p>
        </article>

        <article className="dashboard-card recommendation-card">
          <div className="recommendation-icon"><MagicWand weight="fill" /></div>
          <div>
            <span className="section-label">Suggested improvement</span>
            <h2>{recommendation?.title || "No recommendation yet"}</h2>
            <p>{recommendation?.recommendation || "Recommendations appear only after the confidence gate and evidence rules pass."}</p>
            <div className="recommendation-meta"><strong>{workflow ? "Ready for your review" : "No reliable sequence yet"}</strong><span>{Math.round((recommendation?.confidence || 0) * 100)}% confidence</span></div>
          </div>
          <button className="primary-small" type="button" onClick={() => setBuilderOpen(true)}>{workflow ? "Create workflow" : "Build manually"}</button>
        </article>
      </section>
      {builderOpen && <WorkflowBuilder workflow={workflow} backend={backend} onClose={() => setBuilderOpen(false)} />}
    </div>
  );
}

function ActivityPage({ backend }) {
  const [range, setRange] = useState("Today");
  const observedSessions = backend.sessions.map((session) => ({
    time: new Date(session.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    duration: durationLabel(session.duration_s),
    title: session.title,
    category: session.workflow_type.replaceAll("_", " "),
    apps: `${session.event_count} privacy-safe events`,
    state: session.status === "active" ? "Live" : "Completed",
  }));
  return (
    <div className="dashboard-page narrow-page">
      <div className="page-toolbar">
        <div className="segmented-control" aria-label="Activity range">
          {["Today", "Yesterday", "Week"].map((item) => <button key={item} type="button" className={range === item ? "is-selected" : ""} onClick={() => setRange(item)}>{item}</button>)}
        </div>
        <span className="illustrative-label">Live local activity</span>
      </div>
      <section className="dashboard-card timeline-card">
        <div className="card-heading">
          <div><span className="section-label">Interpreted activity</span><h2>Your work, grouped into meaningful tasks</h2></div>
          <List />
        </div>
        <div className="activity-list">
          {observedSessions.map((session, index) => (
            <article key={session.title} className="activity-row">
              <div className="timeline-rail"><span>{index + 1}</span></div>
              <div className="activity-time"><strong>{session.time}</strong><span>{session.duration}</span></div>
              <div className="activity-copy"><h3>{session.title}</h3><p>{session.category} · {session.apps}</p></div>
              <span className={session.state === "High friction" ? "state-chip state-chip--warn" : "state-chip"}>{session.state}</span>
              <button type="button" aria-label={`Open ${session.title}`}><ArrowRight /></button>
            </article>
          ))}
          {!observedSessions.length && <p className="muted-copy">No personal activity has been observed yet.</p>}
        </div>
      </section>
    </div>
  );
}

function WorkflowsPage({ backend }) {
  const workflows = backend.workflows;
  const [selectedId, setSelectedId] = useState(workflows[0]?.id || null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const selected = workflows.find((workflow) => workflow.id === selectedId) || workflows[0];

  useEffect(() => {
    if (!selectedId && workflows[0]) setSelectedId(workflows[0].id);
  }, [selectedId, workflows]);

  return (
    <div className="dashboard-page workflow-page">
      <aside className="workflow-list-panel">
        <span className="section-label">Recurring workflows</span>
        <h2>{workflows.length} detected</h2>
        {workflows.map((item) => (
          <button key={item.id} className={selected?.id === item.id ? "workflow-list-item is-active" : "workflow-list-item"} type="button" onClick={() => setSelectedId(item.id)}>
            <span>{item.name}</span><small>{item.repeat_count}× observed</small>
          </button>
        ))}
        {!workflows.length && <><p className="muted-copy">No reliable repeated sequences yet. Passive heartbeat signals are excluded.</p><button className="secondary-small workflow-manual-button" type="button" onClick={() => setBuilderOpen(true)}>Create manually</button></>}
      </aside>
      <section className="dashboard-card workflow-detail-card">
        <div className="card-heading">
          <div><span className="section-label">Workflow detail</span><h2>{selected?.name || "No workflow selected"}</h2><p className="muted-copy">{selected ? `${selected.repeat_count} observations · ${durationLabel(selected.average_duration_s)} average · ${Math.round(selected.confidence * 100)}% confidence` : "2Bᵐᵉ needs at least two repeated three-step sequences"}</p></div>
          <button className="secondary-small" type="button" disabled={!selected} onClick={() => setBuilderOpen(true)}>Review and edit</button>
        </div>
        <div className="workflow-steps">
          {(selected?.steps || []).map((step, index) => (
            <div className="workflow-step" key={`${step.action}-${index}`}>
              <div className="step-number">{index + 1}</div>
              <div><strong>{step.action}</strong><span>{step.application}</span></div>
              <span className="repeat-tag"><Repeat /> Repeated</span>
            </div>
          ))}
        </div>
        <div className="workflow-opportunity">
          <MagicWand weight="fill" />
          <div><strong>{selected ? "Automation opportunity" : "Build a workflow manually"}</strong><p>{selected ? "Review the evidence, correct the steps, approve scoped permissions, and run a safe preview." : "Define the steps yourself while 2Bᵐᵉ continues learning reliable repeated sequences."}</p></div>
          <button className="primary-small" type="button" onClick={() => setBuilderOpen(true)}>{selected ? "Create workflow" : "Create manually"}</button>
        </div>
      </section>
      {builderOpen && <WorkflowBuilder workflow={selected} backend={backend} onClose={() => setBuilderOpen(false)} />}
    </div>
  );
}

function InsightsPage({ backend }) {
  const liveInsights = useMemo(() => {
    if (backend.recommendations.length) {
      return backend.recommendations.map((item) => ({
        id: item.id,
        kind: item.class.replaceAll("_", " "),
        title: item.title,
        body: item.observation,
        evidence: item.reason,
        priority: `${Math.round(item.confidence * 100)}% confidence`,
      }));
    }
    if (backend.metrics?.has_live_data) {
      return [{
        id: "current-score",
        kind: "Current behavior",
        title: "The confidence gate is still collecting evidence",
        body: `Focus is ${Math.round(backend.metrics.focus * 100)} and friction is ${Math.round(backend.metrics.friction * 100)} for this live task.`,
        evidence: `${Number(backend.metrics.evidence?.app_switches_per_min || 0).toFixed(1)} switches/min · ${Math.round(backend.metrics.confidence * 100)}% confidence`,
        priority: "Monitoring",
      }];
    }
    return [{
      id: "waiting",
      kind: "Local intelligence",
      title: "Waiting for observed activity",
      body: "Insights will appear after privacy-safe events are scored locally.",
      evidence: "No personal history is being simulated.",
      priority: "Starting",
    }];
  }, [backend.metrics, backend.recommendations]);

  return (
    <div className="dashboard-page narrow-page">
      <div className="insights-grid">
        {liveInsights.map((insight) => (
          <article className="dashboard-card insight-card" key={insight.id}>
            <div className="card-heading"><span className="section-label">{insight.kind}</span><span className="priority-chip">{insight.priority}</span></div>
            <h2>{insight.title}</h2>
            <p>{insight.body}</p>
            <div className="evidence-box"><strong>Why 2Bᵐᵉ thinks this</strong><span>{insight.evidence}</span></div>
            <button type="button" className="inline-action">Explore insight <ArrowRight /></button>
          </article>
        ))}
      </div>
    </div>
  );
}

function AssistantPage({ backend }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Ask me about your work patterns, friction, repeated workflows, or what to automate." },
  ]);

  function ask(event) {
    event.preventDefault();
    if (!question.trim()) return;
    const userQuestion = question.trim();
    const metrics = backend.metrics;
    const workflow = backend.workflows[0];
    const answer = !metrics?.has_live_data
      ? "I’m waiting for the first local activity window. I won’t invent personal history while the backend is still collecting evidence."
      : userQuestion.toLowerCase().includes("automat")
        ? workflow
          ? `${workflow.name} is the strongest current candidate. It has repeated ${workflow.repeat_count} times with ${Math.round(workflow.confidence * 100)}% confidence.`
          : "No repeated sequence has crossed the workflow threshold yet."
        : userQuestion.toLowerCase().includes("slow")
          ? `Current friction is ${Math.round(metrics.friction * 100)}. The strongest evidence is ${Number(metrics.evidence?.app_switches_per_min || 0).toFixed(1)} app switches per minute.`
          : `Current focus is ${Math.round(metrics.focus * 100)} with ${Math.round(metrics.confidence * 100)}% model confidence. This explanation uses scored local events, not raw content.`;
    backend.client.track("navigation", "assistant_question", { windowContext: "ai_assistant", metadata: { category: userQuestion.toLowerCase().includes("automat") ? "automation" : userQuestion.toLowerCase().includes("slow") ? "friction" : "behavior" } });
    setMessages((items) => [...items, { role: "user", text: userQuestion }, { role: "assistant", text: answer }]);
    setQuestion("");
  }

  return (
    <div className="dashboard-page assistant-page">
      <section className="assistant-thread">
        <div className="assistant-intro"><Brain weight="fill" /><div><span className="section-label">Behavioral AI assistant</span><h2>Grounded in your activity—not guesses.</h2></div></div>
        <div className="message-list">
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`message message--${message.role}`}>{message.text}</div>)}
        </div>
        <div className="prompt-suggestions">
          {["What slowed me down today?", "What should I automate?", "When was I most focused?"].map((prompt) => <button key={prompt} type="button" onClick={() => setQuestion(prompt)}>{prompt}</button>)}
        </div>
        <form className="assistant-input" onSubmit={ask}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your behavior…" /><button type="submit"><ArrowRight /></button></form>
      </section>
    </div>
  );
}

function SettingsPage({ backend }) {
  const [sources, setSources] = useState(Object.fromEntries(trackingSources));

  useEffect(() => {
    if (!Object.keys(backend.privacy).length) return;
    setSources(Object.fromEntries(trackingSources.map(([label]) => [label, Boolean(backend.privacy[privacyKeys[label]])])));
  }, [backend.privacy]);

  async function toggleSource(label) {
    const next = !sources[label];
    setSources((items) => ({ ...items, [label]: next }));
    try {
      await backend.client.updatePrivacy(privacyKeys[label], next);
    } catch {
      setSources((items) => ({ ...items, [label]: !next }));
    }
  }
  return (
    <div className="dashboard-page settings-page">
      <section className="dashboard-card settings-card">
        <div className="settings-heading"><ShieldCheck weight="fill" /><div><span className="section-label">Privacy and tracking</span><h2>You control what 2Bᵐᵉ can observe.</h2><p>Each source can be changed independently. Screen content and clipboard contents are off by default.</p></div></div>
        <div className="settings-list">
          {trackingSources.map(([label]) => (
            <div className="setting-row" key={label}><div><strong>{label}</strong><span>{sources[label] ? "Included in behavioral analysis" : "Not collected"}</span></div><button type="button" role="switch" aria-checked={sources[label]} className={sources[label] ? "toggle is-on" : "toggle"} onClick={() => toggleSource(label)}><span /></button></div>
          ))}
        </div>
      </section>
      <section className="dashboard-card exclusions-card"><div><span className="section-label">Application exclusions</span><h2>Always private</h2><p>Password Manager, Banking, Personal Messages, and private browser windows are excluded.</p></div><button className="secondary-small" type="button">Manage exclusions</button></section>
    </div>
  );
}

const pageDescriptions = {
  Overview: "What happened during your work today.",
  Activity: "A task-level history of the work that mattered.",
  Workflows: "Recurring sequences, friction, and automation opportunities.",
  Insights: "A few useful observations, ranked by significance.",
  "AI Assistant": "Ask natural-language questions about your behavioral history.",
  Settings: "Tracking, privacy, exclusions, and overlay behavior.",
};

export function Dashboard({ onBack, backend }) {
  const [activePage, setActivePage] = useState("Overview");

  return (
    <section className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand"><Brand /><span>Behavioral OS</span></div>
        <nav aria-label="Dashboard navigation">
          {navigation.map(([label, Icon]) => <button key={label} aria-label={label} className={activePage === label ? "is-active" : ""} type="button" onClick={() => { setActivePage(label); backend.client.track("navigation", `open_${label.toLowerCase().replaceAll(" ", "_")}`, { windowContext: "dashboard" }); }}><Icon weight={activePage === label ? "fill" : "regular"} /><span>{label}</span></button>)}
        </nav>
        <div className="privacy-summary"><ShieldCheck weight="fill" /><div><strong>Privacy protected</strong><span>{Object.values(backend.privacy).filter((enabled) => !enabled).length} sources disabled</span></div></div>
        <button className="pause-tracking-button" type="button" onClick={() => backend.client.setTracking(backend.status === "PAUSED")}><Pause weight="fill" /> {backend.status === "PAUSED" ? "Resume tracking" : "Pause tracking"}</button>
      </aside>
      <main className="dashboard-main">
        <Header title={activePage} description={pageDescriptions[activePage]} onBack={onBack} backend={backend} />
        <div className="dashboard-scroll">
          {activePage === "Overview" && <Overview backend={backend} />}
          {activePage === "Activity" && <ActivityPage backend={backend} />}
          {activePage === "Workflows" && <WorkflowsPage backend={backend} />}
          {activePage === "Insights" && <InsightsPage backend={backend} />}
          {activePage === "AI Assistant" && <AssistantPage backend={backend} />}
          {activePage === "Settings" && <SettingsPage backend={backend} />}
        </div>
      </main>
    </section>
  );
}
