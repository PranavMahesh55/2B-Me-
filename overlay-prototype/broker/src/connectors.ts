/**
 * §9 step 7: a stub connector. "Do not add a real connector until #8 is green."
 *
 * The result shape is copied verbatim from the prototype's existing
 * `execute_plan` (backend/app/automation/service.py), so the FastAPI contract and
 * `test_api.py`'s `result["mode"] == "preview_only"` assertion keep holding once
 * execution moves behind a grant.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { base64url, isRegisteredPair, sha256 } from "./contract.ts";
import type { GrantClaims, Plan } from "./contract.ts";

const run = promisify(execFile);

/**
 * Real desktop actions are off by default.
 *
 * techspecsigner.md §9 says not to add a real connector until the __tamper path
 * is green, which it is. Even so, "preview only" is a promise the UI makes, so
 * actually launching applications is opt-in per deployment rather than a silent
 * change in what an existing grant does.
 */
let desktopActionsEnabled = false;

/**
 * Separate from desktopActions on purpose. Opening an application changes
 * nothing outside this machine; sending the clipboard to a website is egress of
 * personal content, and the two should not share one switch.
 */
let contentActionsEnabled = false;

export function configureConnectors(
  { desktopActions, contentActions }: { desktopActions: boolean; contentActions?: boolean },
): void {
  desktopActionsEnabled = desktopActions;
  contentActionsEnabled = contentActions ?? false;
}

/** `open -a` takes an application name, not a path or a shell fragment. */
function isSafeApplicationName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[/\\:"'\u0000-\u001f]/.test(value)
  );
}

export type ConnectorResult = Record<string, unknown>;
export type ConnectorFn = (plan: Plan, claims: GrantClaims) => Promise<ConnectorResult>;

export class ConnectorFailed extends Error {}

const previewOnly: ConnectorFn = async () => ({
  mode: "preview_only",
  prepared: true,
  message: "A response draft and workflow context were prepared for user review.",
});

/**
 * Reproduces the observed steps by bringing each application forward in order.
 *
 * The application list is a bound param, so §7 step 8 has already checked it
 * against the grant: the broker can only open what the user saw on the consent
 * card. execFile with an argument array runs no shell, so a name cannot become
 * a command.
 */
/** LaunchServices, so it matches how `open -a` resolves the same name. */
async function isRunning(application: string): Promise<boolean> {
  try {
    const { stdout } = await run("/usr/bin/osascript", [
      "-e",
      `application "${application}" is running`,
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

const openApplications: ConnectorFn = async (plan) => {
  const requested = (plan.params as Record<string, unknown>)?.applications;
  const applications = Array.isArray(requested) ? requested.filter(isSafeApplicationName) : [];

  if (!desktopActionsEnabled) {
    return {
      mode: "preview_only",
      prepared: true,
      steps: applications,
      message: `Prepared ${applications.length} steps for review. Desktop actions are disabled.`,
    };
  }
  if (!applications.length) throw new ConnectorFailed("no valid application names were bound");

  const opened: string[] = [];
  const launched: string[] = [];
  const raised: string[] = [];
  for (const application of applications) {
    // Checked before opening: reproducing a workflow whose applications are
    // already open looks like nothing happening at all, so the receipt has to
    // distinguish the two or the user cannot tell it ran.
    const wasRunning = await isRunning(application);
    try {
      await run("/usr/bin/open", ["-a", application]);
      opened.push(application);
      (wasRunning ? raised : launched).push(application);
    } catch {
      // A missing application is not a reason to abandon the rest of the run.
    }
  }
  if (!opened.length) throw new ConnectorFailed("none of the bound applications could be opened");

  const parts = [];
  if (launched.length) parts.push(`launched ${launched.join(", ")}`);
  if (raised.length) parts.push(`brought ${raised.join(", ")} forward`);
  return {
    mode: "reproduced",
    prepared: true,
    steps: opened,
    launched,
    raised,
    message: `Reproduced ${opened.length} steps: ${parts.join("; ")}.`,
  };
};

/**
 * Opens a addressed draft. It never sends: `mailto:` composes a message and
 * leaves it for the user, which is what "no messages are sent" has to mean if
 * the connector is real.
 */
const draftResponse: ConnectorFn = async (plan) => {
  const params = (plan.params ?? {}) as Record<string, unknown>;
  const to = typeof params.to === "string" ? params.to : "";
  const subject = typeof params.subject === "string" ? params.subject : "";

  if (!desktopActionsEnabled || !to) {
    return {
      mode: "preview_only",
      prepared: true,
      message: "A response draft and workflow context were prepared for user review.",
    };
  }
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}`;
  try {
    await run("/usr/bin/open", [url]);
  } catch (error) {
    throw new ConnectorFailed(`could not open a draft: ${String(error)}`);
  }
  return {
    mode: "drafted",
    prepared: true,
    sent: false,
    message: `Opened an unsent draft to ${to}.`,
  };
};

/**
 * Reproduces the "copy a section, ask for a summary" step.
 *
 * The section is whatever is on the clipboard. It is bound into the grant by
 * SHA-256 at plan time, so this re-reads the clipboard and refuses if it no
 * longer matches: consenting to summarize one passage must not authorize
 * sending whatever you happened to copy afterwards.
 *
 * The composed text is also placed on the clipboard, so the step still works by
 * hand if the prefilled prompt does not survive the deep link.
 */
const summarizeClipboard: ConnectorFn = async (plan) => {
  const params = (plan.params ?? {}) as Record<string, unknown>;
  const prompt = typeof params.prompt === "string" ? params.prompt : "Summarize this.";
  const boundDigest = typeof params.content_sha256 === "string" ? params.content_sha256 : "";

  let clipboard = "";
  try {
    const { stdout } = await run("/usr/bin/pbpaste", []);
    clipboard = stdout;
  } catch {
    throw new ConnectorFailed("could not read the clipboard");
  }
  if (!clipboard.trim()) throw new ConnectorFailed("the clipboard is empty");

  const digest = base64url(await sha256(new TextEncoder().encode(clipboard)));
  if (boundDigest && digest !== boundDigest) {
    // Not param_mismatch: the plan is intact, the world moved underneath it.
    throw new ConnectorFailed("the clipboard changed after you authorized this");
  }

  if (!contentActionsEnabled) {
    return {
      mode: "preview_only",
      prepared: true,
      sent: false,
      characters: clipboard.length,
      message: `Prepared a ${clipboard.length}-character summary request. Content actions are disabled, so nothing left this device.`,
    };
  }

  const composed = `${prompt}\n\n${clipboard}`;
  try {
    // pbcopy reads stdin, so the promisified execFile is no use here.
    await new Promise<void>((resolve, reject) => {
      const child = execFile("/usr/bin/pbcopy", [], (error) => (error ? reject(error) : resolve()));
      child.stdin?.end(composed);
    });
  } catch {
    throw new ConnectorFailed("could not stage the summary request on the clipboard");
  }

  // ChatGPT.app claims https, so this opens in the app rather than a browser.
  const url = `https://chatgpt.com/?q=${encodeURIComponent(composed.slice(0, 1800))}`;
  try {
    await run("/usr/bin/open", ["-a", "ChatGPT", url]);
  } catch {
    throw new ConnectorFailed("could not open ChatGPT");
  }

  return {
    mode: "summarized",
    prepared: true,
    sent: true,
    characters: clipboard.length,
    message: `Sent a ${clipboard.length}-character section to ChatGPT with your prompt. It is also on the clipboard.`,
  };
};

export const REGISTRY = new Map<string, ConnectorFn>([
  ["chatgpt:summarize_clipboard", summarizeClipboard],
  ["mail:draft_response", draftResponse],
  ["workflow:prepare_context", previewOnly],
  ["desktop:open_application", openApplications],
]);

export function isRegistered(connector: string, operation: string): boolean {
  // The contract's registry and the connector table must agree, or a plan could
  // pass §7 step 7 and then find nothing to execute.
  return isRegisteredPair(connector, operation) && REGISTRY.has(`${connector}:${operation}`);
}

const CONNECTOR_TIMEOUT_MS = 10_000;

export async function execute(plan: Plan, claims: GrantClaims): Promise<ConnectorResult> {
  const fn = REGISTRY.get(`${plan.connector}:${plan.operation}`);
  if (!fn) throw new ConnectorFailed(`no connector for ${plan.connector}:${plan.operation}`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(plan, claims),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ConnectorFailed("connector timed out")), CONNECTOR_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    throw error instanceof ConnectorFailed ? error : new ConnectorFailed(String(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
