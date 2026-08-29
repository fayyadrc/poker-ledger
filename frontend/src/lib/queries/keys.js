export const queryKeys = {
  authSession: ["auth", "session"],
  me: ["me"],
  tables: ["tables"],
  table: (id) => ["tables", id],
  tableSessions: (id, sortOrder = "desc") => ["tables", id, "sessions", sortOrder],
  session: (id) => ["sessions", id],
  sessionAuditLog: (id) => ["sessions", id, "audit-log"],
  settlementHistory: (id) => ["sessions", id, "settlement-history"],
  shared: (token) => ["shared", token],
  tableShareLink: (id) => ["tables", id, "share-link"],
  tableMemberships: (id) => ["tables", id, "memberships"],
  tableRequests: (id) => ["tables", id, "requests"],
}
