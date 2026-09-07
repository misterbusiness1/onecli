import type { AppPermissionDefinition } from "./types";

export const googleAnalyticsPermissions: AppPermissionDefinition = {
  provider: "google-analytics",
  groups: [
    {
      category: "read",
      tools: [
        {
          id: "run_report",
          name: "Run report",
          description: "Run an analytics report for a property",
          hostPattern: "analyticsdata.googleapis.com",
          pathPattern: "/v1beta/properties/*:runReport",
          method: "POST",
        },
        {
          id: "batch_run_reports",
          name: "Batch run reports",
          description: "Run multiple analytics reports in a single request",
          hostPattern: "analyticsdata.googleapis.com",
          pathPattern: "/v1beta/properties/*:batchRunReports",
          method: "POST",
        },
        {
          id: "get_metadata",
          name: "Get metadata",
          description:
            "Retrieve metadata about available dimensions and metrics",
          hostPattern: "analyticsdata.googleapis.com",
          pathPattern: "/v1beta/properties/*/metadata",
          method: "GET",
        },
        {
          id: "get_property_details",
          name: "Get property details",
          description: "Retrieve details for the authorized Analytics property",
          hostPattern: "analyticsadmin.googleapis.com",
          pathPattern: "/v1beta/properties/308097416",
          method: "GET",
        },
        {
          id: "get_data_stream_details",
          name: "Get data stream details",
          description: "Read the authorized Analytics web stream",
          hostPattern: "analyticsadmin.googleapis.com",
          pathPattern: "/v1beta/properties/308097416/dataStreams/3361045752",
          method: "GET",
        },
        {
          id: "run_realtime_report",
          name: "Run realtime report",
          description:
            "Read realtime activity for the authorized Analytics property",
          hostPattern: "analyticsdata.googleapis.com",
          pathPattern: "/v1beta/properties/308097416:runRealtimeReport",
          method: "POST",
        },
      ],
    },
  ],
};
