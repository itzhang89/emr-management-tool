/** Auto-generated / default Glue-Hive table parameters omitted from Copy DDL and locked in the UI. */
const EXACT_SYSTEM_PARAMETER_KEYS = new Set([
  "external",
  "comment",
  "transient_lastddltime",
  "createdby",
  "numfiles",
  "numpartitions",
  "numrows",
  "totalsize",
  "rawdatasize",
  "averagerecordsize",
  "objectcount",
  "recordcount",
  "sizekey",
  "crawlerschemadeserializerversion",
  "crawlerschemaserializerversion",
  "updated_by_crawler",
  "updatedbyjobrun",
  "last_modified_by",
  "last_modified_time",
  "lastupdatestatus"
]);

const SYSTEM_PARAMETER_PREFIXES = ["spark.sql"];

export function isSystemTableParameterKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  if (EXACT_SYSTEM_PARAMETER_KEYS.has(normalized)) return true;
  return SYSTEM_PARAMETER_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}.`)
  );
}

export function filterUserTableParameters(parameters: Record<string, string>) {
  return Object.entries(parameters).filter(
    ([key, value]) => Boolean(key.trim()) && value != null && !isSystemTableParameterKey(key)
  );
}

export function partitionTableParameters(parameters: Record<string, string>) {
  const user: Array<[string, string]> = [];
  const system: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(parameters)) {
    if (isSystemTableParameterKey(key)) {
      system.push([key, value]);
    } else {
      user.push([key, value]);
    }
  }
  return { user, system };
}
