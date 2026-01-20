# Stepcat Productionization Plan

This document outlines the work needed to make Stepcat production-ready for broader adoption.

## Executive Summary

Stepcat is currently a working prototype tied to a specific workflow (justfile-based projects on GitHub.com). To make it widely useful, we need to address:

1. **Flexibility** - Support more build systems, git hosts, and workflows
2. **Configuration** - Add config file support and more CLI options
3. **Robustness** - Better validation, error messages, and recovery
4. **Documentation** - Comprehensive guides for installation, usage, and troubleshooting
5. **Distribution** - Proper packaging, versioning, and platform testing

---

## Phase 1: Critical Blockers

These issues prevent many users from adopting Stepcat at all.

### 1.1 Support Alternative Build Systems

**Current State**: Hardcoded requirement for `justfile` with `build`, `lint`, `test` commands.

**Required Changes**:
- Add `--build-command`, `--lint-command`, `--test-command` CLI options
- Support common alternatives out of the box:
  - `npm run build/lint/test`
  - `make build lint test`
  - `yarn build/lint/test`
  - Custom commands
- Update prompts in `backend/prompts.ts` to use configured commands
- Auto-detect build system if not specified (check for justfile, Makefile, package.json)

**Files to modify**:
- `backend/cli.ts` - Add CLI options
- `backend/prompts.ts` - Parameterize build commands
- `backend/orchestrator.ts` - Pass build config to prompts
- `backend/models.ts` - Add BuildConfig type

### 1.2 Support GitHub Enterprise and Alternative Git Hosts

**Current State**: Hardcoded `github.com` in URL parsing.

**Required Changes**:
- Add `--github-host` CLI option (default: `github.com`)
- Support GitHub Enterprise: `--github-host ghe.company.com`
- Update Octokit initialization with `baseUrl` parameter
- Consider future GitLab/Gitea support (lower priority)

**Files to modify**:
- `backend/cli.ts` - Add `--github-host` option
- `backend/github-checker.ts` - Parameterize host in URL parsing and Octokit config
- `backend/models.ts` - Add GitConfig type

### 1.3 Pin Dependency Versions

**Current State**: `@openai/codex` uses wildcard `*` version.

**Required Changes**:
- Pin `@openai/codex` to specific tested version
- Add `package-lock.json` to repository
- Document minimum tested versions in README
- Set up Dependabot for security updates

**Files to modify**:
- `package.json` - Pin versions
- Add `package-lock.json`

### 1.4 Pre-flight Validation

**Current State**: Validation happens late, causing confusing errors.

**Required Changes**:
- Add startup validation that checks:
  - Plan file exists and is valid markdown format
  - Work directory is a git repository
  - Git remote points to supported host
  - GitHub token is provided (and optionally valid)
  - Agent binaries are available in node_modules
  - Build system is detected/configured
- Provide clear, actionable error messages for each check
- Add `--dry-run` flag to run validation without execution

**Files to modify**:
- `backend/cli.ts` - Add validation before orchestrator starts
- `backend/validation.ts` - New file for validation logic
- `backend/errors.ts` - New file for custom error types with recovery hints

---

## Phase 2: Configuration & Flexibility

Make Stepcat adaptable to different workflows.

### 2.1 Configuration File Support

**Current State**: All configuration via CLI flags only.

**Required Changes**:
- Support `.stepcatrc.json` or `stepcat.config.js` in project root
- Support global config at `~/.config/stepcat/config.json`
- Configuration hierarchy: CLI flags > project config > global config > defaults
- Include all current CLI options plus new ones

**Example config**:
```json
{
  "buildCommand": "npm run build",
  "lintCommand": "npm run lint",
  "testCommand": "npm test",
  "githubHost": "github.com",
  "buildTimeout": 30,
  "agentTimeout": 30,
  "maxIterations": 3,
  "implementationAgent": "claude",
  "reviewAgent": "codex",
  "webUI": {
    "port": 3742,
    "autoOpen": true
  }
}
```

**Files to modify**:
- `backend/config.ts` - New file for config loading/merging
- `backend/cli.ts` - Integrate config file loading
- Add JSON schema for config validation

### 2.2 Customizable Prompts

**Current State**: Prompts hardcoded in `backend/prompts.ts`.

**Required Changes**:
- Support prompt templates in config file
- Support prompt template files (e.g., `.stepcat/prompts/implementation.md`)
- Template variables: `{{stepNumber}}`, `{{stepTitle}}`, `{{planContent}}`, `{{buildErrors}}`, etc.
- Keep sensible defaults that work out of the box

**Files to modify**:
- `backend/prompts.ts` - Add template loading and variable substitution
- `backend/config.ts` - Add prompt configuration

### 2.3 Configurable Polling and Timeouts

**Current State**: GitHub polling interval hardcoded at 30 seconds.

**Required Changes**:
- Add `--poll-interval` CLI option (default: 30s)
- Add to config file support
- Consider exponential backoff option for rate-limited APIs

**Files to modify**:
- `backend/cli.ts` - Add option
- `backend/github-checker.ts` - Use configured interval

### 2.4 Database Location Configuration

**Current State**: Always `.stepcat/executions.db` in work directory.

**Required Changes**:
- Add `--db-path` CLI option
- Support `STEPCAT_DB_PATH` environment variable
- Document in README

**Files to modify**:
- `backend/cli.ts` - Add option
- `backend/database.ts` - Accept path parameter

---

## Phase 3: Error Handling & Recovery

Improve experience when things go wrong.

### 3.1 Improved Error Messages

**Current State**: Many errors are technical without recovery suggestions.

**Required Changes**:
- Create error catalog with codes (e.g., `STEPCAT_E001`)
- Each error includes:
  - Clear description of what went wrong
  - Why it might have happened
  - How to fix it
  - Link to documentation
- Structured error output for automation (JSON option)

**Example**:
```
Error STEPCAT_E003: GitHub API authentication failed

The provided GitHub token was rejected by the API.

Possible causes:
  - Token has expired
  - Token lacks required scopes (repo, workflow)
  - Token was revoked

To fix:
  1. Create a new token at https://github.com/settings/tokens
  2. Enable scopes: repo, workflow
  3. Run: export GITHUB_TOKEN=<new_token>

Documentation: https://github.com/user/stepcat/docs/github-setup.md
```

**Files to modify**:
- `backend/errors.ts` - New file with error catalog
- All files that throw errors - Use new error types

### 3.2 Recovery and Retry Mechanisms

**Current State**: Limited retry logic, no manual intervention support.

**Required Changes**:
- Add `--retry-step <n>` to retry a specific failed step
- Add `--skip-step <n>` to skip a problematic step
- Add `--manual-fix` mode that pauses for manual intervention
- Save partial progress even on failures
- Add `stepcat status --execution-id <id>` to check execution state

**Files to modify**:
- `backend/cli.ts` - Add new commands
- `backend/orchestrator.ts` - Add recovery modes

### 3.3 Graceful Degradation

**Current State**: Missing frontend serves 404, missing agents crash late.

**Required Changes**:
- Check for frontend build at startup, warn if missing
- Check for agent binaries at startup
- Provide clear instructions if optional components missing
- Allow running without web UI if frontend not built

**Files to modify**:
- `backend/cli.ts` - Add component checks
- `backend/web-server.ts` - Better error handling

---

## Phase 4: Documentation

Comprehensive documentation for all user types.

### 4.1 Installation Guide

**Create**: `docs/INSTALLATION.md`

**Contents**:
- Prerequisites (Node.js version, git, etc.)
- npm global installation
- Local development setup
- Verifying installation
- Troubleshooting common issues:
  - Permission errors
  - Native module compilation (better-sqlite3)
  - PATH issues

### 4.2 Quick Start Guide

**Create**: `docs/QUICKSTART.md`

**Contents**:
- 5-minute setup for common scenarios
- Sample plan file
- Running first execution
- Understanding the output
- Resuming executions

### 4.3 GitHub Setup Guide

**Create**: `docs/GITHUB_SETUP.md`

**Contents**:
- Creating a Personal Access Token
- Required scopes explanation (why each is needed)
- GitHub Enterprise configuration
- GitHub Actions requirements
- Troubleshooting API errors

### 4.4 Configuration Reference

**Create**: `docs/CONFIGURATION.md`

**Contents**:
- All CLI options with examples
- Config file format and location
- Environment variables
- Default values
- Config hierarchy

### 4.5 Troubleshooting Guide

**Create**: `docs/TROUBLESHOOTING.md`

**Contents**:
- Error code reference
- Common issues and solutions
- Debug mode and logging
- Getting help (issues, discussions)

### 4.6 Architecture Documentation

**Create**: `docs/ARCHITECTURE.md`

**Contents**:
- System overview diagram
- Component descriptions
- Data flow
- Database schema
- Extension points

### 4.7 Update README

**Update**: `README.md`

**Changes**:
- Clearer value proposition
- Quick install + first run
- Links to detailed docs
- Platform compatibility table
- Version compatibility
- Contributing guidelines

---

## Phase 5: Distribution & Platform Support

Make Stepcat easy to install and use everywhere.

### 5.1 Platform Testing

**Required**:
- Set up CI testing on:
  - Ubuntu (latest LTS)
  - macOS (latest)
  - Windows (latest)
- Document any platform-specific issues
- Add platform badges to README

**Files to modify**:
- `.github/workflows/ci.yml` - Add matrix testing

### 5.2 npm Package Improvements

**Required Changes**:
- Add proper `files` field to include only needed files
- Add `engines` field specifying Node.js version
- Add `os` field if platform restrictions needed
- Improve `description` and `keywords` for discoverability
- Add `repository`, `bugs`, `homepage` fields

**Files to modify**:
- `package.json`

### 5.3 Release Process

**Required**:
- Set up semantic versioning
- Create CHANGELOG.md
- GitHub Actions for automated releases
- npm publish automation
- Release notes template

**Files to create**:
- `CHANGELOG.md`
- `.github/workflows/release.yml`

### 5.4 Docker Support (Optional)

**Consider**:
- Dockerfile for containerized execution
- Docker Compose for full stack
- Pre-built images on Docker Hub

---

## Phase 6: Security Improvements

Address security concerns for production use.

### 6.1 Token Handling

**Current Issue**: Token visible in process list when passed via CLI.

**Required Changes**:
- Deprecate `--token` flag with warning
- Recommend environment variable only
- Add `STEPCAT_GITHUB_TOKEN` as alternative to `GITHUB_TOKEN`
- Document security best practices
- Never log token values

**Files to modify**:
- `backend/cli.ts` - Add deprecation warning
- `backend/github-checker.ts` - Support new env var

### 6.2 Secrets Detection

**Required**:
- Warn if plan file contains potential secrets
- Warn if agent output contains potential tokens
- Add `.stepcat` to suggested `.gitignore` entries

### 6.3 Audit Logging

**Required**:
- Log all agent invocations (without sensitive data)
- Log GitHub API calls
- Support log export for compliance

---

## Phase 7: Nice-to-Have Features

Lower priority improvements for future consideration.

### 7.1 Structured Logging

- Add `--log-level` option (debug, info, warn, error)
- JSON log output option
- Log rotation for long-running executions

### 7.2 Webhook Support

- Send webhooks on execution events
- Slack/Discord integration templates
- Generic webhook for custom integrations

### 7.3 Plugin System

- Define plugin API
- Support custom agents (not just Claude/Codex)
- Support custom review parsers
- Support custom build systems

### 7.4 Analytics Dashboard

- Execution statistics
- Success/failure rates
- Time per step tracking
- Historical trends

### 7.5 Team Features

- Shared configuration
- Execution history sharing
- Role-based access (if web UI exposed)

---

## Implementation Priority

### Must Have (MVP for Production)
1. Phase 1.1 - Alternative build systems
2. Phase 1.3 - Pin dependency versions
3. Phase 1.4 - Pre-flight validation
4. Phase 3.1 - Improved error messages
5. Phase 4.1-4.5 - Core documentation

### Should Have (v1.0 Release)
1. Phase 1.2 - GitHub Enterprise support
2. Phase 2.1 - Configuration file support
3. Phase 3.2 - Recovery mechanisms
4. Phase 5.1 - Platform testing
5. Phase 6.1 - Token handling security

### Nice to Have (v1.x+)
1. Phase 2.2 - Customizable prompts
2. Phase 5.4 - Docker support
3. Phase 7.x - Advanced features

---

## Estimated Scope

| Phase | Files Modified | New Files | Complexity |
|-------|---------------|-----------|------------|
| 1.1 Build Systems | 4 | 0 | Medium |
| 1.2 GitHub Enterprise | 2 | 0 | Low |
| 1.3 Dependencies | 2 | 0 | Low |
| 1.4 Validation | 2 | 2 | Medium |
| 2.1 Config File | 2 | 1 | Medium |
| 2.2 Custom Prompts | 2 | 0 | Medium |
| 3.1 Error Messages | 10+ | 1 | High |
| 4.x Documentation | 1 | 6 | Medium |
| 5.1 Platform CI | 1 | 0 | Low |
| 6.1 Token Security | 2 | 0 | Low |

---

## Success Criteria

Stepcat is production-ready when:

1. **New users can start in < 10 minutes** with clear documentation
2. **Works with any build system** (npm, make, just, custom)
3. **Works with GitHub Enterprise** and standard GitHub
4. **Errors are actionable** with clear recovery steps
5. **Configuration is flexible** without requiring code changes
6. **Tested on all major platforms** (Linux, macOS, Windows)
7. **Security concerns addressed** (no token exposure)
8. **Stable releases** with semantic versioning

---

## Next Steps

1. Review and prioritize this plan
2. Create GitHub issues for each work item
3. Start with Phase 1 (critical blockers)
4. Gather feedback from early adopters
5. Iterate based on real-world usage
