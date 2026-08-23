import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentFindFirst: vi.fn(),
  secretFindFirst: vi.fn(),
}));

vi.mock("@onecli/db", () => ({
  db: {
    agent: { findFirst: mocks.agentFindFirst, create: vi.fn() },
    secret: { findFirst: mocks.secretFindFirst },
    onboardingSurvey: { findUnique: vi.fn(async () => null), update: vi.fn() },
  },
}));
vi.mock("../middleware/auth", () => ({
  authMiddleware: async (
    c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("auth", { projectId: "project-1", organizationId: "org-1" });
    await next();
  },
  requireProjectId: () => "project-1",
}));
vi.mock("../lib/gateway-ca", () => ({ loadCaCertificate: () => "test-ca" }));
vi.mock("../services/policy-simulate/principal-set", () => ({
  resolvePrincipalSet: vi.fn(async () => []),
}));
vi.mock("../services/policy-simulate/load-rules", () => ({
  loadInjectionRules: vi.fn(async () => []),
}));

import { containerConfigRoutes } from "./container-config";
import { resetPaperclipRunBindingForTests } from "../services/paperclip-run-binding";

describe("GET /container-config authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPaperclipRunBindingForTests();
    process.env.ONECLI_OPERATOR_CONTEXT_TOKEN = "operator-proof";
    process.env.PAPERCLIP_ONECLI_TENANT_MAPPING = JSON.stringify({
      "company-1": { projectId: "project-1", organizationId: "org-1" },
    });
    mocks.agentFindFirst.mockResolvedValue({
      id: "default-agent",
      accessToken: "aoc_test",
    });
    mocks.secretFindFirst.mockResolvedValue(null);
  });

  it.each([
    ["no context", {}],
    ["partial run context", { "X-Paperclip-Run-Id": "run-1" }],
    ["unbound selector", { "X-Paperclip-Agent-Id": "agent-1" }],
  ])("rejects %s before any agent lookup", async (_name, headers) => {
    const response = await containerConfigRoutes().request("/", { headers });
    expect(response.status).toBe(403);
    expect(mocks.agentFindFirst).not.toHaveBeenCalled();
  });

  it("allows Default resolution only for a positively authorized external operator", async () => {
    const response = await containerConfigRoutes().request("/", {
      headers: { "X-OneCLI-Operator-Context": "operator-proof" },
    });

    expect(response.status).toBe(200);
    expect(mocks.agentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", isDefault: true },
      }),
    );
  });

  it("authenticates a complete Paperclip run without a management Authorization header", async () => {
    process.env.PAPERCLIP_ONECLI_BINDING_SECRET = "binding-secret";
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({
        run_id: "run-1",
        agent_id: "paperclip-agent-1",
        company_id: "company-1",
        onecli_identity: "onecli-agent-1",
        aud: "onecli-runtime",
        iat: Math.floor(Date.now() / 1000) - 1,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    const companyKey = createHmac("sha256", "binding-secret")
      .update("onecli-run-binding:company-1")
      .digest();
    const signature = createHmac("sha256", companyKey)
      .update(`${header}.${claims}`)
      .digest("base64url");

    const response = await containerConfigRoutes().request(
      "/?agent=onecli-agent-1",
      {
        headers: {
          "X-Paperclip-OneCLI-Run-Binding": `${header}.${claims}.${signature}`,
          "X-Paperclip-Run-Id": "run-1",
          "X-Paperclip-Agent-Id": "paperclip-agent-1",
          "X-Paperclip-Company-Id": "company-1",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.agentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", identifier: "onecli-agent-1" },
      }),
    );
  });
});
