import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(async () => ({ count: 1 })),
}));

vi.mock("@onecli/db", () => ({
  db: {
    paperclipRunGatewayCapability: { updateMany: mocks.updateMany },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        paperclipRunGatewayCapability: {
          upsert: mocks.upsert,
          updateMany: mocks.updateMany,
        },
      }),
  },
}));

import {
  mintPaperclipRunGatewayCapability,
  refreshPaperclipRunGatewayCapability,
  revokePaperclipRunGatewayCapability,
} from "./paperclip-run-gateway-capability";

const scope = {
  runId: "run-1",
  companyId: "company-1",
  paperclipAgentId: "paperclip-agent-1",
  agentId: "onecli-agent-id",
  projectId: "project-1",
  organizationId: "org-1",
};

describe("Paperclip run gateway capability lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mints a hashed five-minute lease and revokes sibling leases for the run", async () => {
    const now = new Date("2026-08-23T20:00:00.000Z");
    const minted = await mintPaperclipRunGatewayCapability(scope, now);

    expect(minted.token).toMatch(/^aor_/);
    expect(minted.expiresAt.getTime() - now.getTime()).toBe(300_000);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        runId: "run-1",
        paperclipCompanyId: "company-1",
        paperclipAgentId: "paperclip-agent-1",
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    const stored = mocks.upsert.mock.calls[0]![0].create;
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).not.toContain(minted.token);
    expect(stored).toMatchObject({
      agentId: "onecli-agent-id",
      projectId: "project-1",
      organizationId: "org-1",
    });
  });

  it("refreshes only an active exact-scope lease", async () => {
    const now = new Date("2026-08-23T20:00:00.000Z");
    await refreshPaperclipRunGatewayCapability(
      { ...scope, selector: "onecli-agent-1" },
      now,
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        runId: "run-1",
        paperclipCompanyId: "company-1",
        paperclipAgentId: "paperclip-agent-1",
        projectId: "project-1",
        organizationId: "org-1",
        agent: { identifier: "onecli-agent-1" },
        revokedAt: null,
        expiresAt: { gt: now },
      }),
      data: { expiresAt: new Date("2026-08-23T20:05:00.000Z") },
    });
  });

  it("revokes and expires the exact run scope immediately", async () => {
    const now = new Date("2026-08-23T20:00:00.000Z");
    await revokePaperclipRunGatewayCapability(
      { ...scope, selector: "onecli-agent-1" },
      now,
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        runId: "run-1",
        projectId: "project-1",
        organizationId: "org-1",
        agent: { identifier: "onecli-agent-1" },
        revokedAt: null,
      }),
      data: { revokedAt: now, expiresAt: now },
    });
  });
});
