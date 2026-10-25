/** 独立增量迁移；不得改写已经发布的 schema 1 SQL / 摘要。 */
export const AUTH_MIGRATION = `
CREATE TABLE local_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id), username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user'))
) STRICT;
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE login_limits (
  key TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
`;
