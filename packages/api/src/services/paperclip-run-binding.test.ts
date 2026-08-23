import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAuthorizedOperatorContext,
  verifyPaperclipRunBinding,
} from "./paperclip-run-binding";

const SECRET = "test-binding-secret";
const context = {
  runId: "run-1",
  agentId: "agent-1",
  companyId: "company-1",
  selector: "agent-1",
};

function mint(
  overrides: Record<string, unknown> = {},
  company = context.companyId,
): string {
  const now = 2_000_000_000;
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      run_id: context.runId,
      agent_id: context.agentId,
      company_id: context.companyId,
      onecli_identity: context.selector,
      aud: "onecli-runtime",
      iat: now - 1,
      exp: now + 60,
      ...overrides,
    }),
  ).toString("base64url");
  const key = createHmac("sha256", SECRET)
    .update(`onecli-run-binding:${company}`)
    .digest();
  const signature = createHmac("sha256", key)
    .update(`${header}.${claims}`)
    .digest("base64url");
  return `${header}.${claims}.${signature}`;
}

describe("Paperclip run binding", () => {
  beforeEach(() => {
    process.env.PAPERCLIP_ONECLI_BINDING_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.PAPERCLIP_ONECLI_BINDING_SECRET;
    delete process.env.ONECLI_OPERATOR_CONTEXT_TOKEN;
  });

  it("resolves only the identity authenticated for the exact run context", () => {
    expect(verifyPaperclipRunBinding(mint(), context, 2_000_000_000)).toEqual({
      ok: true,
      identity: "agent-1",
    });
  });

  it("self-resolves all 23 distinct OCC agent bindings without cross-resolution", () => {
    for (let index = 1; index <= 23; index += 1) {
      const own = {
        runId: `run-${index}`,
        agentId: `oxfa-${index}`,
        companyId: "occ",
        selector: `oxfa-${index}`,
      };
      const token = mint(
        {
          run_id: own.runId,
          agent_id: own.agentId,
          company_id: own.companyId,
          onecli_identity: own.selector,
        },
        own.companyId,
      );
      expect(verifyPaperclipRunBinding(token, own, 2_000_000_000)).toEqual({
        ok: true,
        identity: own.selector,
      });
      const other = { ...own, selector: `oxfa-${(index % 23) + 1}` };
      expect(
        verifyPaperclipRunBinding(token, other, 2_000_000_000),
      ).toMatchObject({ ok: false });
    }
  });

  it.each([
    ["missing", undefined, context, "RUN_BINDING_REQUIRED"],
    ["expired", mint({ exp: 1 }), context, "RUN_BINDING_EXPIRED"],
    ["audience", mint({ aud: "other" }), context, "RUN_BINDING_AUDIENCE"],
    [
      "agent",
      mint(),
      { ...context, agentId: "agent-2" },
      "RUN_BINDING_CONTEXT_MISMATCH",
    ],
    [
      "company",
      mint(),
      { ...context, companyId: "company-2" },
      "RUN_BINDING_CONTEXT_MISMATCH",
    ],
    [
      "run replay",
      mint(),
      { ...context, runId: "run-2" },
      "RUN_BINDING_CONTEXT_MISMATCH",
    ],
    [
      "selector spoof",
      mint(),
      { ...context, selector: "Default" },
      "RUN_BINDING_SELECTOR_MISMATCH",
    ],
    ["tamper", `${mint().slice(0, -1)}x`, context, "RUN_BINDING_INVALID"],
  ])("rejects %s before lookup", (_name, token, expected, code) => {
    expect(verifyPaperclipRunBinding(token, expected, 2_000_000_000)).toEqual({
      ok: false,
      code,
    });
  });

  it("allows Default only with a positively configured operator token", () => {
    process.env.ONECLI_OPERATOR_CONTEXT_TOKEN = "operator-proof";
    expect(isAuthorizedOperatorContext(undefined)).toBe(false);
    expect(isAuthorizedOperatorContext("wrong")).toBe(false);
    expect(isAuthorizedOperatorContext("operator-proof")).toBe(true);
  });
});
