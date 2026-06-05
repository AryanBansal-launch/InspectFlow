#!/usr/bin/env bash
#
# release.sh — one-command release for InspectFlow.
#
# Bumps server + extension + manifest to a single unified version, builds and
# tests both, publishes the npm package, repackages the extension zip, and
# creates the git tag + GitHub release with the zip attached.
#
# Usage:
#   ./release.sh patch                 # 0.1.3 -> 0.1.4 (default if omitted)
#   ./release.sh minor                 # 0.1.3 -> 0.2.0
#   ./release.sh major                 # 0.1.3 -> 1.0.0
#   ./release.sh 0.2.5                 # explicit version
#   ./release.sh patch --notes "..."   # custom release notes (else auto-generated)
#   ./release.sh patch --dry-run       # do everything locally, skip publish/push/release
#   ./release.sh patch --skip-tests    # skip the Playwright e2e gate
#
set -euo pipefail

# --- locate repo root (dir of this script) ---
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; CYAN=""; RESET=""
fi

RUN_START=$(date +%s)
PHASE_NUM=0
TOTAL_PHASES=0
PHASE_START=0
PHASE_TITLE=""

now()  { date +%s; }
secs() { local s=$1; if [ "$s" -ge 60 ]; then printf '%dm%02ds' $((s/60)) $((s%60)); else printf '%ds' "$s"; fi; }

ok()   { printf '%s\n' "${GREEN}  ✓ $1${RESET}"; }
warn() { printf '%s\n' "${YELLOW}  ! $1${RESET}"; }
step() { printf '%s\n' "${DIM}    · $1${RESET}"; }
b()    { printf '%s\n' "${BOLD}$1${RESET}"; }

# Closes timing for the current phase (called by the next phase() and at the end).
_close_phase() {
  [ "$PHASE_START" -eq 0 ] && return 0
  printf '%s\n' "${DIM}    ↳ ${PHASE_TITLE} finished in $(secs $(( $(now) - PHASE_START )))${RESET}"
  PHASE_START=0
}

# Starts a numbered, timed phase: phase "Title".
phase() {
  _close_phase
  PHASE_NUM=$((PHASE_NUM + 1))
  PHASE_TITLE="$1"
  PHASE_START=$(now)
  printf '\n%s\n' "${CYAN}${BOLD}┌─[${PHASE_NUM}/${TOTAL_PHASES}] $1${RESET}"
}

die() {
  printf '\n%s\n' "${RED}${BOLD}✗ FAILED${RESET}${RED} during phase ${PHASE_NUM}/${TOTAL_PHASES}: ${PHASE_TITLE:-preflight}${RESET}" >&2
  printf '%s\n' "${RED}  $1${RESET}" >&2
  printf '%s\n' "${DIM}  Elapsed before failure: $(secs $(( $(now) - RUN_START )))${RESET}" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
BUMP="patch"
NOTES=""
DRY_RUN=0
SKIP_TESTS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY_RUN=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --notes)      NOTES="${2:-}"; shift ;;
    patch|minor|major) BUMP="$1" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="$1" ;;
    *) die "Unknown argument: $1" ;;
  esac
  shift
done

# Total phase count depends on the flags, so the [n/N] counter stays accurate.
#   base: preflight, resolve, bump, build server, build extension, package = 6
#   + e2e (unless --skip-tests)         = +1
#   + commit/publish/push/release (unless --dry-run) = +4
TOTAL_PHASES=6
[ "$SKIP_TESTS" -eq 0 ] && TOTAL_PHASES=$((TOTAL_PHASES + 1))
[ "$DRY_RUN"    -eq 0 ] && TOTAL_PHASES=$((TOTAL_PHASES + 4))

MODE_LABEL="live release"
[ "$DRY_RUN" -eq 1 ] && MODE_LABEL="dry run (no publish/push/release)"
b "InspectFlow release — ${MODE_LABEL}"
[ "$SKIP_TESTS" -eq 1 ] && warn "e2e tests will be skipped (--skip-tests)"

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
phase "Preflight checks"
step "checking required tools"
command -v gh >/dev/null   || die "gh CLI not found (brew install gh)"
command -v node >/dev/null || die "node not found"
ok "gh + node present"

step "checking git repository state"
git rev-parse --git-dir >/dev/null 2>&1 || die "Not a git repository."
if [ "$(git branch --show-current)" = "main" ]; then
  ok "on 'main' branch"
else
  warn "Not on 'main' branch (current: $(git branch --show-current))"
fi

if [ "$DRY_RUN" -eq 0 ]; then
  # Only prompt for auth when it's actually missing/expired — otherwise pass through.
  step "checking npm authentication"
  if npm whoami >/dev/null 2>&1; then
    ok "npm: logged in as $(npm whoami 2>/dev/null)"
  else
    warn "Not logged into npm — launching 'npm login' (needs a terminal)…"
    npm login || die "npm login failed or was cancelled."
    npm whoami >/dev/null 2>&1 || die "Still not authenticated with npm after login."
    ok "npm: logged in as $(npm whoami 2>/dev/null)"
  fi

  step "checking GitHub authentication"
  if gh auth status >/dev/null 2>&1; then
    ok "gh: authenticated"
  else
    warn "Not authenticated with gh — launching 'gh auth login'…"
    gh auth login || die "gh auth login failed or was cancelled."
    ok "gh: authenticated"
  fi
else
  step "dry run — skipping npm/gh auth checks"
fi

# ---------------------------------------------------------------------------
# 2. Resolve version (server package.json is the source of truth)
# ---------------------------------------------------------------------------
phase "Resolve target version"
CURRENT="$(node -p "require('./server/package.json').version")"
NEW_VERSION="$(node -e '
  const [cur, bump] = [process.argv[1], process.argv[2]];
  if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(bump)) { console.log(bump); process.exit(0); }
  let [maj, min, pat] = cur.split(".").map(Number);
  if (bump === "major") { maj++; min = 0; pat = 0; }
  else if (bump === "minor") { min++; pat = 0; }
  else { pat++; }
  console.log(`${maj}.${min}.${pat}`);
' "$CURRENT" "$BUMP")"
TAG="v$NEW_VERSION"
step "bump type: ${BUMP}"
git rev-parse "$TAG" >/dev/null 2>&1 && die "Tag $TAG already exists."
ok "$CURRENT → ${BOLD}$NEW_VERSION${RESET}${GREEN} (tag $TAG)"

# ---------------------------------------------------------------------------
# 3. Bump version files
# ---------------------------------------------------------------------------
phase "Bump version files"
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version >/dev/null
step "package.json (root) → $NEW_VERSION"
( cd server    && npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version >/dev/null )
step "server/package.json → $NEW_VERSION"
( cd extension && npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version >/dev/null )
step "extension/package.json → $NEW_VERSION"
node -e '
  const fs = require("fs"), f = "extension/manifest.json";
  const m = JSON.parse(fs.readFileSync(f, "utf8"));
  m.version = process.argv[1];
  fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$NEW_VERSION"
step "extension/manifest.json → $NEW_VERSION"
ok "all four files unified at $NEW_VERSION"

# ---------------------------------------------------------------------------
# 4. Build server
# ---------------------------------------------------------------------------
phase "Build server"
step "typecheck"
( cd server && npm run typecheck ) || die "server typecheck failed."
step "build"
( cd server && npm run build >/dev/null ) || die "server build failed."
ok "server built"

# ---------------------------------------------------------------------------
# 5. Build extension
# ---------------------------------------------------------------------------
phase "Build extension"
step "typecheck"
( cd extension && npm run typecheck ) || die "extension typecheck failed."
step "build"
( cd extension && npm run build >/dev/null ) || die "extension build failed."
ok "extension built"

# ---------------------------------------------------------------------------
# 6. e2e tests (gate)
# ---------------------------------------------------------------------------
if [ "$SKIP_TESTS" -eq 0 ]; then
  phase "Run e2e tests (Playwright)"
  step "this starts the server + demo and drives a real Chromium…"
  ( cd e2e && npx playwright test ) || die "e2e tests failed — aborting release."
  ok "e2e passed"
fi

# ---------------------------------------------------------------------------
# 7. Package extension zip
# ---------------------------------------------------------------------------
phase "Package extension zip"
rm -f extension-dist.zip
( cd extension && zip -qr ../extension-dist.zip dist manifest.json icons )
ok "extension-dist.zip rebuilt ($(du -h extension-dist.zip | cut -f1 | tr -d ' '))"

if [ "$DRY_RUN" -eq 1 ]; then
  _close_phase
  printf '\n%s\n' "${YELLOW}${BOLD}● DRY RUN complete${RESET} — no commit, publish, push, or GitHub release."
  printf '%s\n' "${DIM}  Would publish inspectflow-server@$NEW_VERSION and create release $TAG.${RESET}"
  printf '%s\n' "${DIM}  Total time: $(secs $(( $(now) - RUN_START )))${RESET}"
  warn "Version files were bumped to $NEW_VERSION locally — 'git checkout .' to revert if not releasing."
  exit 0
fi

# ---------------------------------------------------------------------------
# 8. Commit + tag
# ---------------------------------------------------------------------------
phase "Commit & tag"
git add -A
git commit -m "Release $TAG" >/dev/null
step "committed working tree"
git tag "$TAG"
ok "committed and tagged $TAG"

# ---------------------------------------------------------------------------
# 9. Publish npm package (prepublishOnly runs clean + build)
# ---------------------------------------------------------------------------
phase "Publish npm package"
( cd server && npm publish --access public ) || die "npm publish failed."
ok "published inspectflow-server@$NEW_VERSION"

# ---------------------------------------------------------------------------
# 10. Push
# ---------------------------------------------------------------------------
phase "Push to origin"
git push
step "pushed commit"
git push --tags
ok "pushed commit + tag $TAG"

# ---------------------------------------------------------------------------
# 11. GitHub release
# ---------------------------------------------------------------------------
phase "Create GitHub release"
if [ -n "$NOTES" ]; then
  gh release create "$TAG" extension-dist.zip --title "$TAG" --notes "$NOTES" || die "gh release create failed."
else
  gh release create "$TAG" extension-dist.zip --title "$TAG" --generate-notes || die "gh release create failed."
fi
ok "GitHub release $TAG created (extension-dist.zip attached)"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
_close_phase
printf '\n%s\n' "${GREEN}${BOLD}🎉 Release $TAG complete in $(secs $(( $(now) - RUN_START )))${RESET}"
ok "npm:    inspectflow-server@$NEW_VERSION"
ok "github: release $TAG (extension-dist.zip attached)"
