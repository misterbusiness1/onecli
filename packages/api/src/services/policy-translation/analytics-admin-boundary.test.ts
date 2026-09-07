import { describe, expect, it } from "vitest";
import { evaluateNew, evaluatePolicyOutcome } from "./evaluator";
import type { NewRule, PolicyRequest } from "./types";

const admin = "analyticsadmin.googleapis.com";
const property = "/v1beta/properties/308097416";
const stream = `${property}/dataStreams/3361045752`;
const request = (over: Partial<PolicyRequest> = {}): PolicyRequest => ({
  host: admin,
  path: property,
  method: "GET",
  agentId: "synthetic-agent",
  hasInjections: true,
  isLlmHost: false,
  ...over,
});
const rule = (over: Partial<NewRule> = {}): NewRule => ({
  scope: "project",
  priority: 0,
  isDefault: false,
  source: "custom",
  name: "synthetic rule",
  identities: [],
  targets: [
    {
      kind: "app",
      provider: "google-analytics",
      connectionScope: null,
      tools: [],
    },
  ],
  action: "allow",
  requireApproval: false,
  rateLimit: null,
  rateLimitWindow: null,
  conditions: null,
  ...over,
});
const denyDefault = rule({ isDefault: true, action: "block", targets: [] });
const scoped = (tools: string[]) => [
  rule({
    targets: [
      {
        kind: "app",
        provider: "google-analytics",
        connectionScope: null,
        tools,
      },
    ],
  }),
  denyDefault,
];

describe("Analytics Admin provider boundary at the real evaluator", () => {
  it("rejects writes even with a whole-app grant", () => {
    for (const method of [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]) {
      expect(evaluateNew([rule()], request({ method })).action).toBe("block");
    }
  });
  it("rejects uncataloged and differently scoped Admin resources", () => {
    for (const path of [
      "/v1beta/accountSummaries",
      "/v1beta/properties",
      property + "/",
      property + "/accessBindings",
      property + "/dataStreams",
      stream + "/extra",
      property.replace("308097416", "308097415"),
      stream.replace("3361045752", "3361045753"),
      "/v1alpha/properties/308097416",
      "/v1beta/properties%2F308097416",
      property + "%2FaccessBindings",
    ]) {
      expect(evaluateNew([rule()], request({ path })).action).toBe("block");
    }
  });
  it("applies before wildcard/secret/connection rules and permissive defaults", () => {
    const bypassRules: NewRule[][] = [
      [],
      [rule({ isDefault: true })],
      [
        rule({
          targets: [
            {
              kind: "network",
              hostPattern: "*",
              pathPattern: "*",
              method: null,
            },
          ],
        }),
      ],
      [rule({ targets: [{ kind: "secret", hostPatterns: [admin] }] })],
      [
        rule({
          targets: [
            {
              kind: "connection",
              connectionId: "synthetic",
              provider: "google-analytics",
              tools: [],
            },
          ],
        }),
      ],
    ];
    for (const rules of bypassRules) {
      expect(
        evaluateNew(
          rules,
          request({
            method: "DELETE",
            winningConnectionId: "synthetic",
            hasInjections: false,
          }),
        ).action,
      ).toBe("block");
    }
  });
  it("keeps legacy custom grants denied and new exact reads independent", () => {
    const legacy = ["run_report", "batch_run_reports", "get_metadata"];
    for (const path of [property, stream])
      expect(evaluateNew(scoped(legacy), request({ path })).action).toBe(
        "block",
      );
    expect(
      evaluateNew(scoped(["get_property_details"]), request()).action,
    ).toBe("allow");
    expect(
      evaluateNew(scoped(["get_property_details"]), request({ path: stream }))
        .action,
    ).toBe("block");
    expect(
      evaluateNew(
        scoped(["get_data_stream_details"]),
        request({ path: stream }),
      ).action,
    ).toBe("allow");
    expect(
      evaluateNew(scoped(["get_data_stream_details"]), request()).action,
    ).toBe("block");
  });
  it("allows only safe SDK query options on the two reads", () => {
    for (const path of [
      property + "?%24alt=json%3Benum-encoding%3Dint",
      stream + "?fields=name%2Ctype&prettyPrint=false",
    ])
      expect(evaluateNew([rule()], request({ path })).action).toBe("allow");
    for (const path of [
      property + "?_method=DELETE",
      property + "?httpMethod=POST",
      property + "?unknown=1",
      property + "#fragment",
    ])
      expect(evaluateNew([rule()], request({ path })).action).toBe("block");
  });
  it("preserves Data and unrelated provider decisions", () => {
    const host = "analyticsdata.googleapis.com";
    expect(
      evaluateNew(
        scoped(["get_metadata"]),
        request({ host, path: property + "/metadata" }),
      ).action,
    ).toBe("allow");
    expect(
      evaluateNew(
        scoped(["run_realtime_report"]),
        request({
          host,
          path: property + ":runRealtimeReport",
          method: "POST",
        }),
      ).action,
    ).toBe("allow");
    expect(
      evaluateNew(
        scoped(["run_realtime_report"]),
        request({
          host,
          path: "/v1beta/properties/308097415:runRealtimeReport",
          method: "POST",
        }),
      ).action,
    ).toBe("block");
    expect(
      evaluateNew(
        [rule()],
        request({
          host,
          path: "/previously-uncataloged-data-flow",
          method: "POST",
        }),
      ).action,
    ).toBe("allow");
    expect(
      evaluateNew(
        [
          rule({
            targets: [
              {
                kind: "network",
                hostPattern: "api.github.com",
                pathPattern: "*",
                method: null,
              },
            ],
          }),
        ],
        request({
          host: "api.github.com",
          path: "/repos/synthetic/synthetic",
          method: "GET",
        }),
      ).action,
    ).toBe("allow");
  });
  it("reports a provider boundary without inventing a policy row", () => {
    expect(
      evaluatePolicyOutcome([rule()], request({ method: "DELETE" })),
    ).toEqual({ kind: "providerBoundary", provider: "google-analytics" });
  });
});
