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
});
