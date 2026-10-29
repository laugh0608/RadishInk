/** schema 3：账号资料不再依赖本地密码，保留所有原用户 ID、凭据及文章归属。 */
export const OIDC_MIGRATION = `
CREATE TABLE account_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id), username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  admission TEXT NOT NULL CHECK(admission IN ('pending','approved'))
) STRICT;
INSERT INTO account_profiles SELECT user_id, username, role, 'approved' FROM local_accounts;
CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id), password_hash TEXT NOT NULL
) STRICT;
INSERT INTO password_credentials SELECT user_id, password_hash FROM local_accounts;
DROP TABLE local_accounts;
ALTER TABLE sessions ADD COLUMN authentication_method TEXT NOT NULL DEFAULT 'password'
  CHECK(authentication_method IN ('password','oidc'));
CREATE TABLE oidc_identities (
  issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, PRIMARY KEY(issuer, subject), UNIQUE(user_id, issuer)
) STRICT;
CREATE TABLE oidc_attempts (
  state_digest TEXT PRIMARY KEY, browser_digest TEXT NOT NULL,
  nonce TEXT NOT NULL, verifier TEXT NOT NULL, config_digest TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('login','link')),
  user_id TEXT REFERENCES users(id), session_digest TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
) STRICT;
CREATE INDEX oidc_attempt_browser ON oidc_attempts(browser_digest);
DELETE FROM sessions;
`;
