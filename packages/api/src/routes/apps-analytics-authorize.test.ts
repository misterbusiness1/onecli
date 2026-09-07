import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context, Hono, Next } from "hono";
import type { ApiEnv } from "../types";

// Real Hono authorize route, Google provider definition, authorization-URL
// builder and signed state. Only local auth/config/DB edges are fixtures;
// the redirect is inspected, never followed or exchanged for credentials.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_EDITION = "onprem-slim";
  process.env.SECRET_ENCRYPTION_KEY = "synthetic-analytics-authorize-state";
  process.env.OAUTH_STATE_SECRET = "synthetic-analytics-authorize-state";
  process.env.APP_URL = "https://onecli.example.invalid";
});

vi.mock("@onecli/db", () => ({ Prisma: {}, db: {} }));
vi.mock("../middleware/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/auth")>();
  const authenticated = async (c: Context<ApiEnv>, next: Next) => {
    c.set("auth", {
      userId: "synthetic-user",
      userEmail: "operator@example.invalid",
      organizationId: "synthetic-org",
      projectId: "synthetic-project",
    });
    await next();
  };
  return {
    ...original,
    auth: () => authenticated,
    authMiddleware: authenticated,
  };
});
vi.mock("../apps/registry", async () => {
  const { googleAnalytics } = await import("../apps/google-analytics");
  return {
    getApp: (id: string) =>
      id === googleAnalytics.id ? googleAnalytics : undefined,
    getApps: () => [googleAnalytics],
  };
});
vi.mock("../apps/resolve-credentials", () => ({
  resolveAppCredentials: async () => ({
    values: {
      clientId: "synthetic-client",
      clientSecret: "synthetic-unused-secret",
    },
  }),
}));

import { createApiApp } from "../app";
import { verifyOAuthState } from "../lib/oauth-state";
import { googleAnalytics } from "../apps/google-analytics";

const EXPECTED_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/analytics",
  "https://www.googleapis.com/auth/analytics.readonly",
].sort();
const CONNECTION = "existing-synthetic-analytics-connection";

describe("Google Analytics same-connection read-only consent", () => {
  let app: Hono<ApiEnv>;
  beforeAll(() => {
    app = createApiApp(
      { getSession: async () => null },
      { selfUrl: "https://onecli.example.invalid" },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  async function authorize(query: string) {
    const network = vi.fn(() => {
      throw new Error("Authorization must only return a redirect");
    });
    vi.stubGlobal("fetch", network);
    const res = await app.request(
      `/v1/apps/google-analytics/authorize${query}`,
    );
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(target.origin).toBe("https://accounts.google.com");
    expect(target.pathname).toBe("/o/oauth2/v2/auth");
    expect(network).not.toHaveBeenCalled();
    return { res, target };
  }

  it("requests the required read scope while preserving every existing scope", async () => {
    const { target } = await authorize(`?connectionId=${CONNECTION}`);
    expect(target.searchParams.get("scope")!.split(" ").sort()).toEqual(
      EXPECTED_SCOPES,
    );
    expect(target.searchParams.get("scope")).not.toContain("analytics.edit");
    expect(target.searchParams.get("client_id")).toBe("synthetic-client");
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://onecli.example.invalid/v1/apps/google-analytics/callback",
    );
    expect(target.searchParams.get("response_type")).toBe("code");
    expect(target.searchParams.get("access_type")).toBe("offline");
    expect(target.searchParams.get("prompt")).toBe("consent");
  });

  it("signs the existing connection and project into reauthorization state", async () => {
    const { res, target } = await authorize(`?connectionId=${CONNECTION}`);
    const state = target.searchParams.get("state")!;
    expect(verifyOAuthState(state)).toMatchObject({
      connectionId: CONNECTION,
      projectId: "synthetic-project",
      provider: "google-analytics",
    });
    expect(res.headers.get("set-cookie")).toContain(`oauth_state=${state}`);
  });

  it("does not invent a reconnect target for a new connection", async () => {
    const { target } = await authorize("");
    expect(
      verifyOAuthState(target.searchParams.get("state")!),
    ).not.toHaveProperty("connectionId");
  });

  it("does not accept a query-string write-scope expansion", async () => {
    const { target } = await authorize(
      `?connectionId=${CONNECTION}&scope=https://www.googleapis.com/auth/analytics.edit`,
    );
    expect(target.searchParams.get("scope")!.split(" ").sort()).toEqual(
      EXPECTED_SCOPES,
    );
  });

  it("declares only the new permission as read and retains the legacy permission", () => {
    expect(googleAnalytics.connectionMethod.type).toBe("oauth");
    if (googleAnalytics.connectionMethod.type !== "oauth")
      throw new Error("OAuth expected");
    const permissions = googleAnalytics.connectionMethod.permissions;
    expect(permissions).toContainEqual(
      expect.objectContaining({
        scope: "https://www.googleapis.com/auth/analytics.readonly",
        access: "read",
      }),
    );
    expect(permissions).toContainEqual(
      expect.objectContaining({
        scope: "https://www.googleapis.com/auth/analytics",
        access: "write",
      }),
    );
  });
});
