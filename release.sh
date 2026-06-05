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

# --- colors ---
b() { printf '\033[1m%s\033[0m\n' "$1"; }       # bold
ok() { printf '\033[32m✓ %s\033[0m\n' "$1"; }   # green
warn() { printf '\033[33m! %s\033[0m\n' "$1"; } # yellow
die() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- parse args ---
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

# --- preflight ---
b "▶ Preflight checks"
command -v gh >/dev/null   || die "gh CLI not found (brew install gh)"
command -v node >/dev/null || die "node not found"
[ "$(git branch --show-current)" = "main" ] || warn "Not on 'main' branch."
git rev-parse --git-dir >/dev/null 2>&1 || die "Not a git repository."

if [ "$DRY_RUN" -eq 0 ]; then
  # Only prompt for auth when it's actually missing/expired — otherwise pass through.
  if ! npm whoami >/dev/null 2>&1; then
    warn "Not logged into npm — launching 'npm login' (needs a terminal)…"
    npm login || die "npm login failed or was cancelled."
    npm whoami >/dev/null 2>&1 || die "Still not authenticated with npm after login."
  fi
  if ! gh auth status >/dev/null 2>&1; then
    warn "Not authenticated with gh — launching 'gh auth login'…"
    gh auth login || die "gh auth login failed or was cancelled."
  fi
fi
ok "Preflight passed"

# --- compute the new unified version (server package.json is the source of truth) ---
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

b "▶ Releasing $CURRENT → $NEW_VERSION (tag $TAG)"
git rev-parse "$TAG" >/dev/null 2>&1 && die "Tag $TAG already exists."

# --- bump all three files to the same version ---
b "▶ Bumping versions"
( cd server    && npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version >/dev/null )
( cd extension && npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version >/dev/null )
node -e '
  const fs = require("fs"), f = "extension/manifest.json";
  const m = JSON.parse(fs.readFileSync(f, "utf8"));
  m.version = process.argv[1];
  fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$NEW_VERSION"
ok "server/package.json, extension/package.json, extension/manifest.json → $NEW_VERSION"

# --- build + typecheck ---
b "▶ Building server"
( cd server && npm run typecheck && npm run build >/dev/null )
ok "server built"

b "▶ Building extension"
( cd extension && npm run typecheck && npm run build >/dev/null )
ok "extension built"

# --- tests (e2e gate) ---
if [ "$SKIP_TESTS" -eq 0 ]; then
  b "▶ Running e2e tests"
  ( cd e2e && npx playwright test ) || die "e2e tests failed — aborting release."
  ok "e2e passed"
else
  warn "Skipping tests (--skip-tests)"
fi

# --- repackage extension zip ---
b "▶ Packaging extension zip"
rm -f extension-dist.zip
( cd extension && zip -qr ../extension-dist.zip dist manifest.json icons )
ok "extension-dist.zip rebuilt ($(du -h extension-dist.zip | cut -f1))"

if [ "$DRY_RUN" -eq 1 ]; then
  warn "DRY RUN — skipping commit, npm publish, push, and GitHub release."
  b "Would publish inspectflow-server@$NEW_VERSION and create release $TAG."
  exit 0
fi

# --- commit + tag ---
b "▶ Committing & tagging"
git add -A
git commit -m "Release $TAG"
git tag "$TAG"
ok "committed and tagged $TAG"

# --- npm publish (triggers prepublishOnly: clean + build) ---
b "▶ Publishing npm package"
( cd server && npm publish --access public )
ok "published inspectflow-server@$NEW_VERSION"

# --- push ---
b "▶ Pushing to origin"
git push
git push --tags
ok "pushed commit + tag"

# --- GitHub release with the zip ---
b "▶ Creating GitHub release"
if [ -n "$NOTES" ]; then
  gh release create "$TAG" extension-dist.zip --title "$TAG" --notes "$NOTES"
else
  gh release create "$TAG" extension-dist.zip --title "$TAG" --generate-notes
fi

b "🎉 Release $TAG complete"
ok "npm: inspectflow-server@$NEW_VERSION"
ok "GitHub release: $TAG (extension-dist.zip attached)"
