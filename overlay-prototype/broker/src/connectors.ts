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

import { isRegisteredPair } from "./contract.ts";
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

export function configureConnectors({ desktopActions }: { desktopActions: boolean }): void {
  desktopActionsEnabled = desktopActions;
}

/** `open -a` takes an application name, not a path or a shell fragment. */
function isSafeApplicationName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[/\\:\u0000-\u001f]/.test(value)
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
  for (const application of applications) {
    try {
      await run("/usr/bin/open", ["-a", application]);
      opened.push(application);
    } catch {
      // A missing application is not a reason to abandon the rest of the run.
    }
  }
  if (!opened.length) throw new ConnectorFailed("none of the bound applications could be opened");
  return {
    mode: "reproduced",
    prepared: true,
    steps: opened,
    message: `Reopened ${opened.join(" -> ")} in the observed order.`,
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

export const REGISTRY = new Map<string, ConnectorFn>([
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
