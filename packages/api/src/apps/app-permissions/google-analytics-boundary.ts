/** Matches the gateway's fixed Analytics Admin read-only provider boundary. */
export const analyticsAdminRequestAllowed = (
  host: string,
  method: string,
  path: string,
): boolean => {
  if (host.toLowerCase() !== "analyticsadmin.googleapis.com") return true;
  if (method !== "GET" || path.includes("#")) return false;
  const separator = path.indexOf("?");
  const resource = separator === -1 ? path : path.slice(0, separator);
  if (
    resource !== "/v1beta/properties/308097416" &&
    resource !== "/v1beta/properties/308097416/dataStreams/3361045752"
  )
    return false;
  const allowed = new Set([
    "alt",
    "$alt",
    "fields",
    "$fields",
    "prettyPrint",
    "$prettyPrint",
    "$.xgafv",
  ]);
  return [
    ...new URLSearchParams(
      separator === -1 ? "" : path.slice(separator + 1),
    ).keys(),
  ].every((key) => allowed.has(key));
};
