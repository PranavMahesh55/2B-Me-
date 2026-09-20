/**
 * The first connector with a real side effect (§9 step 7 says not to add one
 * until the __tamper path is green, which it is).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureConnectors, execute, isRegistered } from "../src/connectors.ts";
import type { GrantClaims, Plan } from "../src/contract.ts";

const claims = {} as GrantClaims;

function desktopPlan(applications: unknown): Plan {
  return {
    connector: "desktop",
    operation: "open_application",
    resource: "workflow:wf_test",
    params: { destination: "preview_only", applications },
  } as unknown as Plan;
}

test("desktop actions are off by default, so a grant stays preview-only", async () => {
  configureConnectors({ desktopActions: false });
  const result = await execute(desktopPlan(["Preview", "TextEdit"]), claims);
  assert.equal(result.mode, "preview_only");
  assert.deepEqual(result.steps, ["Preview", "TextEdit"]);
});

test("bound application names are filtered to plausible names", async () => {
  configureConnectors({ desktopActions: false });
  const result = await execute(
    desktopPlan([
      "TextEdit",
      "/Applications/Evil.app",   // a path, not an application name
      "Mail; rm -rf ~",           // would only matter if a shell were involved
      "Bad\u0000Name",            // control characters
      "x".repeat(200),            // absurd length
      42,
      null,
    ]),
    claims,
  );

  // Paths, control characters, over-long strings and non-strings are dropped.
  // The shell metacharacters survive, and that is fine: execFile takes an
  // argument array, so `open -a "Mail; rm -rf ~"` looks for an application with
  // that name and fails to find one. Nothing is ever handed to a shell.
  assert.deepEqual(result.steps, ["TextEdit", "Mail; rm -rf ~"]);
});

test("the mail connector drafts and never sends", async () => {
  configureConnectors({ desktopActions: false });
  const result = await execute(
    {
      connector: "mail",
      operation: "draft_response",
      resource: "workflow:wf_test",
      params: { to: "pi@university.edu", subject: "Draft" },
    } as unknown as Plan,
    claims,
  );
  assert.equal(result.mode, "preview_only");
  assert.notEqual(result.sent, true);
});

test("the registry and the contract agree on every pair", () => {
  assert.equal(isRegistered("desktop", "open_application"), true);
  assert.equal(isRegistered("mail", "draft_response"), true);
  assert.equal(isRegistered("workflow", "prepare_context"), true);
  // A pair the contract does not register must not be runnable.
  assert.equal(isRegistered("desktop", "wire_transfer"), false);
  assert.equal(isRegistered("mail", "open_application"), false);
});
