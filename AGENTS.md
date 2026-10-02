# Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Multi-agent merges

Serial merges on an integration branch: one merger owns it until its push lands. See `docs/agents/multi-agent-merge.md`.

### Design uniformity

Keep UI styles consistent when editing or adding new frontend code. See `docs/agents/design-uniformity.md`.

### Production DB (ops)

Read-only lookups against production D1 (family usage) run `npx wrangler d1 execute --remote` inside `worker/`; all writes (issue/retire codes, passphrase) go through `tools/operator.mjs`. See `docs/agents/prod-db-queries.md`.