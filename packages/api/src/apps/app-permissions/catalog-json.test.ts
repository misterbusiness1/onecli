import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getAppPermissionDefinitions } from "./index";
import { buildCatalogJson, serializeCatalogJson } from "./catalog-json";

const gatewayCatalog = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../../apps/gateway/src/policy_engine/catalog.generated.json",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("gateway catalog JSON", () => {
  it("matches every registered TypeScript permission definition", () => {
    expect(gatewayCatalog).toBe(
      serializeCatalogJson(buildCatalogJson(getAppPermissionDefinitions())),
    );
  });
});
