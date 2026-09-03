import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agentFindFirst: vi.fn(),
  secretFindFirst: vi.fn(),
  capabilityUpsert: vi.fn(),
  capabilityUpdateMany: vi.fn(async () => ({ count: 1 })),
  projectFindUnique: vi.fn(async () => ({
    id: "project-1",
    organizationId: "org-1",
  })),
}));

vi.mock("@onecli/db", () => ({
  db: {
    agent: { findFirst: mocks.agentFindFirst, create: vi.fn() },
    project: { findUnique: mocks.projectFindUnique },
    paperclipRunGatewayCapability: {
      upsert: mocks.capabilityUpsert,
      updateMany: mocks.capabilityUpdateMany,
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        paperclipRunGatewayCapability: {
          upsert: mocks.capabilityUpsert,
          updateMany: mocks.capabilityUpdateMany,
        },
      }),
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
        select: { id: true, accessToken: false },
      }),
    );
    expect(mocks.capabilityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          runId: "run-1",
          paperclipCompanyId: "company-1",
          paperclipAgentId: "paperclip-agent-1",
          agentId: "default-agent",
          projectId: "project-1",
          organizationId: "org-1",
        }),
      }),
    );
    const body = await response.json();
    expect(body.env.HTTPS_PROXY).toMatch(/^http:\/\/x:aor_[^@]+@/);
    expect(body.env.HTTPS_PROXY).not.toContain("aoc_test");
  });

  it("rejects caller mapping when the persisted project belongs to another organization", async () => {
    process.env.PAPERCLIP_ONECLI_BINDING_SECRET = "binding-secret";
    mocks.projectFindUnique.mockResolvedValueOnce({
      id: "project-1",
      organizationId: "foreign-org",
    });
    const response = await containerConfigRoutes().request(
      "/?agent=onecli-agent-1",
      {
        headers: {
          "X-Paperclip-OneCLI-Run-Binding": "not-reached",
          "X-Paperclip-Run-Id": "run-1",
          "X-Paperclip-Agent-Id": "paperclip-agent-1",
          "X-Paperclip-Company-Id": "company-1",
        },
      },
    );
    expect(response.status).toBe(403);
    expect(mocks.agentFindFirst).not.toHaveBeenCalled();
    expect(mocks.capabilityUpsert).not.toHaveBeenCalled();
  });

  it("refreshes and revokes only the exact authenticated run lease", async () => {
    process.env.PAPERCLIP_ONECLI_BINDING_SECRET = "binding-secret";
    const now = Math.floor(Date.now() / 1000);
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
        iat: now - 1,
        exp: now + 60,
      }),
    ).toString("base64url");
    const companyKey = createHmac("sha256", "binding-secret")
      .update("onecli-run-binding:company-1")
      .digest();
    const signature = createHmac("sha256", companyKey)
      .update(`${header}.${claims}`)
      .digest("base64url");
    const headers = {
      "X-Paperclip-OneCLI-Run-Binding": `${header}.${claims}.${signature}`,
      "X-Paperclip-Run-Id": "run-1",
      "X-Paperclip-Agent-Id": "paperclip-agent-1",
      "X-Paperclip-Company-Id": "company-1",
    };

    const refresh = await containerConfigRoutes().request(
      "/run-capability/refresh?agent=onecli-agent-1",
      { method: "POST", headers },
    );
    expect(refresh.status).toBe(200);
    expect(mocks.capabilityUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ runId: "run-1", revokedAt: null }),
      }),
    );

    const revoke = await containerConfigRoutes().request(
      "/run-capability/revoke?agent=onecli-agent-1",
      { method: "POST", headers },
    );
    expect(revoke.status).toBe(200);
    expect(mocks.capabilityUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
          expiresAt: expect.any(Date),
        }),
      }),
    );
  });
});
