import { createHmac, timingSafeEqual } from "node:crypto";

export interface PaperclipRunContext {
  runId: string;
  agentId: string;
  companyId: string;
  selector: string;
}

type Claims = {
  run_id?: unknown;
  agent_id?: unknown;
  company_id?: unknown;
  onecli_identity?: unknown;
  aud?: unknown;
  iat?: unknown;
  exp?: unknown;
};

const equal = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function verifyPaperclipRunBinding(
  token: string | undefined,
  expected: PaperclipRunContext,
  nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true; identity: string } | { ok: false; code: string } {
  if (!token) return { ok: false, code: "RUN_BINDING_REQUIRED" };
  if (
    !expected.runId ||
    !expected.agentId ||
    !expected.companyId ||
    !expected.selector
  ) {
    return { ok: false, code: "RUN_CONTEXT_REQUIRED" };
  }
  const secret = process.env.PAPERCLIP_ONECLI_BINDING_SECRET?.trim();
  if (!secret) return { ok: false, code: "RUN_BINDING_UNAVAILABLE" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, code: "RUN_BINDING_INVALID" };
  const headerPart = parts[0]!;
  const claimsPart = parts[1]!;
  const signature = parts[2]!;
  let header: { alg?: unknown };
  let claims: Claims;
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(claimsPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "RUN_BINDING_INVALID" };
  }
  if (header.alg !== "HS256") return { ok: false, code: "RUN_BINDING_INVALID" };
  if (claims.aud !== "onecli-runtime")
    return { ok: false, code: "RUN_BINDING_AUDIENCE" };
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds) {
    return { ok: false, code: "RUN_BINDING_EXPIRED" };
  }
  if (typeof claims.iat !== "number" || claims.iat > nowSeconds + 30) {
    return { ok: false, code: "RUN_BINDING_INVALID" };
  }
  if (
    claims.run_id !== expected.runId ||
    claims.agent_id !== expected.agentId ||
    claims.company_id !== expected.companyId
  ) {
    return { ok: false, code: "RUN_BINDING_CONTEXT_MISMATCH" };
  }
  if (claims.onecli_identity !== expected.selector) {
    return { ok: false, code: "RUN_BINDING_SELECTOR_MISMATCH" };
  }
  const companyKey = createHmac("sha256", secret)
    .update(`onecli-run-binding:${expected.companyId}`)
    .digest();
  const wanted = createHmac("sha256", companyKey)
    .update(`${headerPart}.${claimsPart}`)
    .digest("base64url");
  if (!equal(signature, wanted))
    return { ok: false, code: "RUN_BINDING_INVALID" };
  return { ok: true, identity: expected.selector };
}

export function isAuthorizedOperatorContext(
  value: string | undefined,
): boolean {
  const configured = process.env.ONECLI_OPERATOR_CONTEXT_TOKEN?.trim();
  return Boolean(configured && value && equal(value, configured));
}
