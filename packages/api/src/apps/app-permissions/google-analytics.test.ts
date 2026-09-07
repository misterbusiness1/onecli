import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { hostMatches, pathMatches } from "../../lib/path-match";
import { buildCatalogJson } from "./catalog-json";
import { googleAnalyticsPermissions } from "./google-analytics";

const tool = (id: string) => {
  const match = googleAnalyticsPermissions.groups
    .flatMap((group) => group.tools)
    .find((candidate) => candidate.id === id);
  if (!match) throw new Error(`missing Google Analytics tool ${id}`);
  return match;
};

const matches = (id: string, host: string, method: string, path: string) => {
  const candidate = tool(id);
  return (
    hostMatches(host, candidate.hostPattern) &&
    method === candidate.method &&
    pathMatches(path, candidate.pathPattern)
  );
};

const grantMatches = (
  actions: string[],
  host: string,
  method: string,
  path: string,
) => actions.some((action) => matches(action, host, method, path));

describe("Google Analytics Admin permissions", () => {
  it("keeps the generated gateway catalog in sync", () => {
    const generated = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../apps/gateway/src/policy_engine/catalog.generated.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(generated[googleAnalyticsPermissions.provider]).toEqual(
      buildCatalogJson([googleAnalyticsPermissions])[
        googleAnalyticsPermissions.provider
      ],
    );
  });

  it("keeps data stream details exact and GET-only", () => {
    expect(
      matches(
        "get_data_stream_details",
        "analyticsadmin.googleapis.com",
        "GET",
        "/v1beta/properties/308097416/dataStreams/3361045752?fields=name",
      ),
    ).toBe(true);
    expect(
      matches(
        "get_data_stream_details",
        "analyticsadmin.googleapis.com",
        "GET",
        "/v1beta/properties/308097416/dataStreams/3361045752/extra",
      ),
    ).toBe(false);
    expect(
      matches(
        "get_data_stream_details",
        "analyticsadmin.googleapis.com",
        "POST",
        "/v1beta/properties/308097416/dataStreams/3361045752",
      ),
    ).toBe(false);
  });

  it("keeps existing grants with only legacy Data actions default-denied on Admin", () => {
    const legacyDataGrant = ["run_report", "batch_run_reports", "get_metadata"];

    for (const path of [
      "/v1beta/properties/308097416/dataStreams/3361045752",
      "/v1beta/properties/308097416",
    ]) {
      expect(
        grantMatches(
          legacyDataGrant,
          "analyticsadmin.googleapis.com",
          "GET",
          path,
        ),
      ).toBe(false);
    }
  });

  it("an data-stream-only grant permits only that exact Admin read", () => {
    const grant = ["get_data_stream_details"];

    expect(
      grantMatches(
        grant,
        "analyticsadmin.googleapis.com",
        "GET",
        "/v1beta/properties/308097416/dataStreams/3361045752",
      ),
    ).toBe(true);
    expect(
      grantMatches(
        grant,
        "analyticsadmin.googleapis.com",
        "GET",
        "/v1beta/properties/308097416",
      ),
    ).toBe(false);
  });

  it("allows only the authorized property resource", () => {
    const grant = ["get_property_details"];

    expect(
      grantMatches(
        grant,
        "analyticsadmin.googleapis.com",
        "GET",
        "/v1beta/properties/308097416",
      ),
    ).toBe(true);

    for (const path of [
      "/v1beta/properties",
      "/v1beta/properties/",
      "/v1beta/properties/other",
      "/v1beta/properties/308097415",
      "/v1beta/properties/308097416/",
      "/v1beta/properties/308097416/extra",
      "/v1beta/properties/308097416/accessBindings",
      "/v1beta/properties/308097416/dataStreams",
      "/v1beta/properties%2F308097416",
      "/v1beta/properties%2f308097416",
      "/v1beta/properties/308097416%2FdataStreams",
      "/v1beta/properties/308097416%2fdataStreams",
    ]) {
      expect(
        grantMatches(grant, "analyticsadmin.googleapis.com", "GET", path),
      ).toBe(false);
    }

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        grantMatches(
          grant,
          "analyticsadmin.googleapis.com",
          method,
          "/v1beta/properties/308097416",
        ),
      ).toBe(false);
    }

    for (const [host, path] of [
      ["analyticsdata.googleapis.com", "/v1beta/properties/308097416"],
      ["analytics.googleapis.com", "/v1beta/properties/308097416"],
      ["admin.googleapis.com", "/v1beta/properties/308097416"],
      ["api.github.com", "/v1beta/properties/308097416"],
      [
        "analyticsadmin.googleapis.com",
        "/v1beta/properties/308097416/dataStreams/3361045752",
      ],
    ] satisfies readonly (readonly [string, string])[]) {
      expect(grantMatches(grant, host, "GET", path)).toBe(false);
    }
  });

  it("whole-app behavior covers the two exact Analytics hosts without wildcard widening", () => {
    const providerHosts = new Set(
      googleAnalyticsPermissions.groups.flatMap((group) =>
        group.tools.map((candidate) => candidate.hostPattern),
      ),
    );

    expect(providerHosts).toEqual(
      new Set([
        "analyticsdata.googleapis.com",
        "analyticsadmin.googleapis.com",
      ]),
    );
    expect([...providerHosts].some((host) => host.includes("*"))).toBe(false);
    expect(providerHosts.has("evil.analyticsadmin.googleapis.com")).toBe(false);
    expect(providerHosts.has("analytics.googleapis.com")).toBe(false);
  });

  it("does not cross hosts or reuse the Data metadata action", () => {
    expect(
      matches(
        "get_property_details",
        "analyticsdata.googleapis.com",
        "GET",
        "/v1beta/properties/308097416",
      ),
    ).toBe(false);
    expect(
      matches(
        "get_metadata",
        "analyticsadmin.googleapis.com",
        "GET",
        "/v1beta/properties/308097416",
      ),
    ).toBe(false);
    expect(
      matches(
        "get_metadata",
        "analyticsdata.googleapis.com",
        "GET",
        "/v1beta/properties/308097416/metadata",
      ),
    ).toBe(true);
  });
});
