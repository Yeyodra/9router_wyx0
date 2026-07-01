# Decisions — kiro-dot-trick

## Architecture Decisions

### Gmail OAuth Storage
- Store in SQLite via new `kiroGmailCredentials` + `kiroGmailTokens` tables
- NOT in external JSON file (replaces qwencloud-generator/gmail_tokens.json entirely)
- Credentials = GCP client_secret.json content (user provides their own)
- Tokens = per-email OAuth2 tokens with auto-refresh

### Callback Server
- `localhost:8085/callback` — Node.js `http.createServer()` spawned temporarily
- Same URI already registered in GCP (matches authorize.py)

### Job Persistence
- JSON files in `DATA_DIR/kiro-dot-trick/` (same as kiro-bulk-import pattern)
- NOT in SQLite

### Mode Options
- `merge` (default): register new accounts AND login
- `register-only`: just register, output accounts.json
- `login-only`: read accounts.json input, just login

### accounts.json Format
```json
{
  "version": 1,
  "createdAt": "ISO",
  "mode": "register-only",
  "jobId": "uuid",
  "stats": {...},
  "accounts": [{"email","password","displayName","reg_status","suspended","registeredAt"}]
}
```

### Security
- `getCredentials()` MUST NOT expose `clientSecret` — only `getCredentialById()` returns it
- clientSecret stored in DB but never returned in list endpoints
