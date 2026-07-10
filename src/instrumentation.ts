export function register() {
  // Hanzo Datastore is Hanzo's ClickHouse fork; operators configure it via DATASTORE_URL.
  // The query layer (src/lib/clickhouse.ts, src/lib/db.ts) is kept byte-identical to
  // upstream, which reads CLICKHOUSE_URL. Alias here at server bootstrap so those files
  // stay zero-fork-diff and upstream merges never conflict. Guarded (not ??=) to avoid
  // coercing an unset value to the string "undefined".
  if (!process.env.CLICKHOUSE_URL && process.env.DATASTORE_URL) {
    process.env.CLICKHOUSE_URL = process.env.DATASTORE_URL;
  }
}
