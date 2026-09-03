import { createHash, randomBytes } from "node:crypto";
import { db } from "@onecli/db";

export const PAPERCLIP_RUN_CAPABILITY_TTL_SECONDS = 300;

export interface PaperclipRunCapabilityScope {
  runId: string;
  companyId: string;
  paperclipAgentId: string;
  agentId: string;
  projectId: string;
  organizationId: string;
}

const tokenHash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

const expiresAt = (now = new Date()) =>
  new Date(now.getTime() + PAPERCLIP_RUN_CAPABILITY_TTL_SECONDS * 1000);

export async function mintPaperclipRunGatewayCapability(
  scope: PaperclipRunCapabilityScope,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = `aor_${randomBytes(32).toString("base64url")}`;
  const expiry = expiresAt(now);
  await db.$transaction(async (tx) => {
    await tx.paperclipRunGatewayCapability.updateMany({
      where: {
        runId: scope.runId,
        paperclipCompanyId: scope.companyId,
        paperclipAgentId: scope.paperclipAgentId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    await tx.paperclipRunGatewayCapability.upsert({
      where: {
        runId_paperclipCompanyId_paperclipAgentId_agentId: {
          runId: scope.runId,
          paperclipCompanyId: scope.companyId,
          paperclipAgentId: scope.paperclipAgentId,
          agentId: scope.agentId,
        },
      },
      create: {
        tokenHash: tokenHash(token),
        runId: scope.runId,
        paperclipCompanyId: scope.companyId,
        paperclipAgentId: scope.paperclipAgentId,
        agentId: scope.agentId,
        projectId: scope.projectId,
        organizationId: scope.organizationId,
        expiresAt: expiry,
      },
      update: {
        tokenHash: tokenHash(token),
        projectId: scope.projectId,
        organizationId: scope.organizationId,
        expiresAt: expiry,
        revokedAt: null,
      },
    });
  });
  return { token, expiresAt: expiry };
}

export async function refreshPaperclipRunGatewayCapability(
  scope: Omit<PaperclipRunCapabilityScope, "agentId"> & { selector: string },
  now = new Date(),
): Promise<Date | null> {
  const expiry = expiresAt(now);
  const updated = await db.paperclipRunGatewayCapability.updateMany({
    where: {
      runId: scope.runId,
      paperclipCompanyId: scope.companyId,
      paperclipAgentId: scope.paperclipAgentId,
      projectId: scope.projectId,
      organizationId: scope.organizationId,
      agent: { identifier: scope.selector },
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { expiresAt: expiry },
  });
  return updated.count === 1 ? expiry : null;
}

export async function revokePaperclipRunGatewayCapability(
  scope: Omit<PaperclipRunCapabilityScope, "agentId"> & { selector: string },
  now = new Date(),
): Promise<boolean> {
  const updated = await db.paperclipRunGatewayCapability.updateMany({
    where: {
      runId: scope.runId,
      paperclipCompanyId: scope.companyId,
      paperclipAgentId: scope.paperclipAgentId,
      projectId: scope.projectId,
      organizationId: scope.organizationId,
      agent: { identifier: scope.selector },
      revokedAt: null,
    },
    data: { revokedAt: now, expiresAt: now },
  });
  return updated.count > 0;
}
