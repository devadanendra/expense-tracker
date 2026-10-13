const ts = (r) => r.updatedAt || 0;

// By id; incoming wins only with a strictly greater updatedAt. Never drops a record.
// `changed` = incoming records that were added or won (final winner per id).
export function mergeRecords(local, incoming) {
  const byId = new Map();
  for (const r of local) {
    const cur = byId.get(r.id);
    if (!cur || ts(r) > ts(cur)) byId.set(r.id, r);
  }
  const changed = new Map();
  for (const r of incoming) {
    const cur = byId.get(r.id);
    if (!cur || ts(r) > ts(cur)) {
      byId.set(r.id, r);
      changed.set(r.id, r);
    }
  }
  return { merged: [...byId.values()], changed: [...changed.values()] };
}
