import { createHmac, timingSafeEqual } from "node:crypto";

export interface PaperclipRunContext {
  runId: string;
  agentId: string;
  companyId: string;
  selector: string;
  projectId: string;
  organizationId: string;
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

let bindingSecret: string | null = null;
let operatorContextToken: string | null = null;
let tenantMapping: Record<
  string,
  { projectId: string; organizationId: string }
> | null = null;

function consumeManagedValue(
  key: "PAPERCLIP_ONECLI_BINDING_SECRET" | "ONECLI_OPERATOR_CONTEXT_TOKEN",
) {
  const configured = process.env[key]?.trim();
  if (configured) {
    if (key === "PAPERCLIP_ONECLI_BINDING_SECRET") bindingSecret = configured;
    else operatorContextToken = configured;
  }
  delete process.env[key];
  return key === "PAPERCLIP_ONECLI_BINDING_SECRET"
    ? bindingSecret
    : operatorContextToken;
}

export function resetPaperclipRunBindingForTests(): void {
  bindingSecret = null;
  operatorContextToken = null;
  tenantMapping = null;
}

function consumeTenantMapping(): Record<
  string,
  { projectId: string; organizationId: string }
> {
  if (tenantMapping) return tenantMapping;
  const raw = process.env.PAPERCLIP_ONECLI_TENANT_MAPPING?.trim();
  delete process.env.PAPERCLIP_ONECLI_TENANT_MAPPING;
  if (!raw) return (tenantMapping = {});
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    tenantMapping = Object.fromEntries(
      Object.entries(parsed).flatMap(([companyId, value]) => {
        if (!value || typeof value !== "object") return [];
        const entry = value as Record<string, unknown>;
        return typeof entry.projectId === "string" &&
          typeof entry.organizationId === "string" &&
          entry.projectId.length > 0 &&
          entry.organizationId.length > 0
          ? [
              [
                companyId,
                {
                  projectId: entry.projectId,
                  organizationId: entry.organizationId,
                },
              ],
            ]
          : [];
      }),
    );
    return tenantMapping;
  } catch {
    return (tenantMapping = {});
  }
}

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
  const secret = consumeManagedValue("PAPERCLIP_ONECLI_BINDING_SECRET");
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
  const mappedTenant = consumeTenantMapping()[expected.companyId];
  if (!mappedTenant) return { ok: false, code: "RUN_TENANT_UNMAPPED" };
  if (
    mappedTenant.projectId !== expected.projectId ||
    mappedTenant.organizationId !== expected.organizationId
  ) {
    return { ok: false, code: "RUN_TENANT_MISMATCH" };
  }
  return { ok: true, identity: expected.selector };
}

export function isAuthorizedOperatorContext(
  value: string | undefined,
): boolean {
  const configured = consumeManagedValue("ONECLI_OPERATOR_CONTEXT_TOKEN");
  return Boolean(configured && value && equal(value, configured));
}
