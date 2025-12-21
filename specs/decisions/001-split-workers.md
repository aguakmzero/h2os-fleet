# ADR-001: Split Monolithic Worker into Three

## Status

Accepted

## Date

2025-12-21

## Context

The H2OS Fleet system was built as a single Cloudflare Worker (`worker/worker.js`) that handles:
- Device setup script generation (~500 lines)
- REST API for device/preference management (~400 lines)
- Dashboard web UI (~2000 lines)

This single file grew to ~2600 lines, mixing HTML, CSS, JavaScript, Python, and bash.

### Problems

1. **Code organization**: Single 2600-line file is hard to navigate
2. **Unnecessary loading**: API calls load dashboard HTML/CSS; setup requests load everything
3. **Deployment coupling**: Dashboard changes require deploying setup script too
4. **Testing difficulty**: Can't test workers in isolation

### Questions Considered

- Can multiple workers share D1 database? **Yes**
- Can they share CF Access auth? **Yes** (route-level)
- Cost impact? **None** (well under free tier limits)
- Complexity? **Low** (same domain, different routes)

## Decision

Split into three workers:

| Worker | Route | Lines | Purpose |
|--------|-------|-------|---------|
| setup-worker | `/setup` | ~300 | Device provisioning |
| api-worker | `/api/*` | ~400 | REST API |
| dashboard-worker | `/dashboard` | ~2000 | Web UI |

## Consequences

### Positive

- Clear separation of concerns
- Smaller, focused codebases
- Independent deployments
- Faster cold starts (smaller workers)
- Easier testing and debugging

### Negative

- More files to manage
- Need to coordinate shared types/constants
- Slightly more complex wrangler.toml

### Neutral

- Same D1 database binding
- Same authentication
- Same deployment command (`npx wrangler deploy`)

## Implementation

1. Create `workers/` directory with three subdirectories
2. Extract code into separate workers
3. Update wrangler.toml with route mappings
4. Test locally with `wrangler dev`
5. Deploy all three
