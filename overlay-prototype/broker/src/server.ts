/**
 * §1: binds loopback explicitly, never 0.0.0.0, and rejects any request whose
 * Origin is not the overlay's.
 * §10: every error path returns an enumerated code. A 500 with a stack trace is
 * a bug, so nothing here can throw out to Node's default handler.
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { AuditChain } from "./audit.ts";
import { executeGrant } from "./execute.ts";
import type { BrokerConfig } from "./config.ts";
import type { SpentStore } from "./verify.ts";

export interface ServerDeps {
  config: BrokerConfig;
  spent: SpentStore;
  chain: AuditChain;
  now?: () => number;
  log?: (line: string) => void;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(payload.length),
    // Never echo Access-Control-Allow-Origin: a rejected caller learns nothing.
    "cache-control": "no-store",
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | "too_large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) return "too_large";
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createBrokerServer(deps: ServerDeps): Server {
  const { config } = deps;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const log = deps.log ?? (() => {});

  return createServer((request, response) => {
    void (async () => {
      try {
        // Transport checks come first: nothing is parsed and no work is done for
        // a caller that is not the overlay.
        const origin = request.headers.origin;
        if (typeof origin !== "string" || !config.allowedOrigins.includes(origin)) {
          // Deliberately outside GrantErrorCode. A rejected origin is not the UI
          // by construction, so handing it a grant code would only tell an
          // unknown caller how far it got.
          log(`origin rejected: ${origin ?? "<absent>"}`);
          return send(response, 403, { error: "origin_rejected" });
        }
        if (config.launchSecret) {
          const presented = request.headers["x-2bme-launch-secret"];
          if (presented !== config.launchSecret) {
            return send(response, 403, { error: "origin_rejected" });
          }
        }

        if (request.method === "GET" && request.url?.startsWith("/audit/chain")) {
          const verification = await deps.chain.verify();
          return send(response, 200, { entries: deps.chain.rows(), verification });
        }

        if (request.method !== "POST" || !request.url?.startsWith("/execute")) {
          return send(response, 404, { error: "not_found" });
        }

        const raw = await readBody(request, config.maxBodyBytes);
        if (raw === "too_large") {
          return send(response, 413, { error: "malformed_request", message: "body too large" });
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
        } catch {
          return send(response, 400, { error: "malformed_request", message: "body is not JSON" });
        }
        if (typeof parsed !== "object" || parsed === null || !("token" in parsed) || !("plan" in parsed)) {
          return send(response, 400, { error: "malformed_request", message: "token and plan are required" });
        }

        const outcome = await executeGrant(parsed.token, parsed.plan, parsed.__tamper, {
          now,
          publicKey: config.publicKey,
          expectedIssuer: config.expectedIssuer,
          spent: deps.spent,
          chain: deps.chain,
          maxCallsHardCap: config.maxCallsHardCap,
          onCanonical: config.debugCanonical
            ? (label, canonical, digest) => log(`canonical[${label}] sha256=${digest} ${canonical}`)
            : undefined,
        });
        return send(response, outcome.status, outcome.body);
      } catch (error) {
        // §10: a 500 with a stack trace is a bug. Log it, answer with a code.
        log(`unhandled: ${(error as Error).stack ?? String(error)}`);
        return send(response, 403, { error: "signature_invalid" });
      }
    })();
  });
}

export function listen(server: Server, config: BrokerConfig): Promise<void> {
  return new Promise((resolve) => {
    // §1: explicitly loopback.
    server.listen(config.port, config.host, () => resolve());
  });
}
