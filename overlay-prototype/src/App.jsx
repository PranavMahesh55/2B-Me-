import { useEffect, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { Dashboard } from "./Dashboard.jsx";
import { Overlay } from "./Overlay.jsx";
import { useBehaviorBackend } from "./backend.js";

const isNative = new URLSearchParams(window.location.search).get("native") === "1";

export function App() {
  const backend = useBehaviorBackend();
  const [mode, setMode] = useState("overlay");
  const [expanded, setExpanded] = useState(true);
  const [notice, setNotice] = useState("");

  // An authorization prompt the user cannot see is a dark pattern, and in the
  // desktop app the window has to be resized to show it at all.
  useEffect(() => {
    if (!backend.pendingIntent) return;
    setMode("overlay");
    setExpanded(true);
    window.desktopAPI?.setMode("authorizing");
  }, [backend.pendingIntent]);

  // Back to the normal height once nothing is waiting.
  useEffect(() => {
    if (backend.pendingIntent || mode !== "overlay") return;
    window.desktopAPI?.setMode(expanded ? "expanded" : "collapsed");
  }, [backend.pendingIntent, expanded, mode]);

  function notify(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  }

  function changeExpanded(nextExpanded) {
    setExpanded(nextExpanded);
    backend.client.track("click", nextExpanded ? "expand_overlay" : "collapse_overlay");
    window.desktopAPI?.setMode(nextExpanded ? "expanded" : "collapsed");
  }

  function openDashboard() {
    setMode("dashboard");
    backend.client.track("navigation", "open_dashboard", { windowContext: "dashboard" });
    window.desktopAPI?.setMode("dashboard");
  }

  function returnToOverlay() {
    setMode("overlay");
    setExpanded(true);
    backend.client.track("navigation", "return_to_overlay", { windowContext: "desktop_overlay" });
    window.desktopAPI?.setMode("expanded");
  }

  function hideOverlay() {
    backend.client.track("click", "hide_overlay");
    if (isNative) window.desktopAPI?.hide();
    else notify("Overlay hidden in the desktop app");
  }

  return (
    <div className={isNative ? `app app--native app--${mode}` : `app app--preview app--${mode}`}>
      {!isNative && <div className="desktop-backdrop" aria-hidden="true" />}
      <div className={mode === "overlay" ? "prototype-stage prototype-stage--overlay" : "prototype-stage prototype-stage--dashboard"}>
        {mode === "overlay" ? (
          <Overlay
            expanded={expanded}
            onExpandedChange={changeExpanded}
            onOpenDashboard={openDashboard}
            onHide={hideOverlay}
            backend={backend}
          />
        ) : (
          <Dashboard onBack={returnToOverlay} backend={backend} />
        )}
      </div>
      {notice && <div className="toast" role="status"><CheckCircle weight="fill" /> {notice}</div>}
      {!isNative && mode === "overlay" && (
        <div className="preview-caption">
          <span>Desktop overlay prototype</span>
          <small>The application underneath remains interactive in the native build.</small>
        </div>
      )}
    </div>
  );
}
