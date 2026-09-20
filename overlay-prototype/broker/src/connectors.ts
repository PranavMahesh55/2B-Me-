/**
 * §9 step 7: a stub connector. "Do not add a real connector until #8 is green."
 *
 * The result shape is copied verbatim from the prototype's existing
 * `execute_plan` (backend/app/automation/service.py), so the FastAPI contract and
 * `test_api.py`'s `result["mode"] == "preview_only"` assertion keep holding once
 * execution moves behind a grant.
 */
import { isRegisteredPair } from "./contract.ts";
import type { GrantClaims, Plan } from "./contract.ts";

export type ConnectorResult = Record<string, unknown>;
export type ConnectorFn = (plan: Plan, claims: GrantClaims) => Promise<ConnectorResult>;

export class ConnectorFailed extends Error {}

const previewOnly: ConnectorFn = async () => ({
  mode: "preview_only",
  prepared: true,
  message: "A response draft and workflow context were prepared for user review.",
});

export const REGISTRY = new Map<string, ConnectorFn>([
  ["mail:draft_response", previewOnly],
  ["workflow:prepare_context", previewOnly],
  ["desktop:open_application", previewOnly],
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
