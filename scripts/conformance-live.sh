#!/usr/bin/env bash
#
# Beast Mode - Conformance Live Fixture
#
# Builds a two-harness project in a fresh temporary directory, installs
# Claude Code and dsh into it, and writes one tiny fixture feature request.
# The script prints the manual step for each harness and the
# scripts/conformance-diff.sh command line that compares the two results.
#
# This script runs no harness. A harness session needs a human, so a
# person runs the printed step on Claude Code and on dsh, in turn, and
# copies each result out before the next harness overwrites it.
#
# Usage: bash scripts/conformance-live.sh
#
# Safety rules:
#   - The script never writes into this repo. Every write lands under the
#     fresh directory that "mktemp -d" creates.
#   - The script leaves the fixture project in place when it finishes, and
#     prints its path. Remove it yourself when the conformance run is done.
#

set -euo pipefail

if [ "$#" -ne 0 ]; then
    echo "Usage: bash scripts/conformance-live.sh" >&2
    echo "This script takes no argument." >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$REPO_ROOT/installer/bin/beast-mode.js"

if [ ! -f "$CLI" ]; then
    echo "No installer CLI at \"$CLI\"." >&2
    echo "Run this script from a checkout of the Beast Mode repo." >&2
    exit 2
fi

FEATURE_NAME="conformance-fixture"

PROJECT="$(mktemp -d)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 BEAST MODE CONFORMANCE FIXTURE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Project: $PROJECT"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. A git root. dsh resolves the project root at the nearest ancestor
#    directory that holds ".git".
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "Step 1. Initialize a git repository."
git -C "$PROJECT" init -q
echo "  done"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. Install both harnesses.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "Step 2. Install dsh, then install Claude Code."
node "$CLI" install dsh --project "$PROJECT" >/dev/null
echo "  dsh installed"
node "$CLI" install claude --project "$PROJECT" >/dev/null
echo "  claude installed"
echo ""

echo "The shared version marker, after both installs:"
echo ""
cat "$PROJECT/.beast-mode/version.json"
echo ""
echo "The composed harness glossary, after both installs:"
echo ""
cat "$PROJECT/.beast-mode/harness.md"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. One tiny fixture feature request.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "Step 3. Write the fixture feature request."
FIXTURE_DIR="$PROJECT/docs/features/$FEATURE_NAME"
mkdir -p "$FIXTURE_DIR"
cat > "$FIXTURE_DIR/requirements.md" <<'EOF'
# Fixture Feature: Conformance Check

Add a function `isEven(n)` that returns whether an integer is even.
Add one unit test with three cases: 0, 1, and 2.
No dependency. No UI. Keep the change under 20 lines of code.
EOF
echo "  wrote $FIXTURE_DIR/requirements.md"
echo ""

RESULTS_DIR="$(dirname "$PROJECT")/$(basename "$PROJECT")-runs"
mkdir -p "$RESULTS_DIR"
RUN_A="$RESULTS_DIR/claude"
RUN_B="$RESULTS_DIR/dsh"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. The manual steps. A harness session needs a human.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MANUAL STEPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Do these two steps one harness at a time. Copy each result out before"
echo "the next harness writes over the same feature folder."
echo ""
echo "A. Claude Code"
echo "  1. Open a Claude Code session with \"$PROJECT\" as the working directory."
echo "  2. Run this command, and paste the content of \"$FIXTURE_DIR/requirements.md\""
echo "     as the initial requirements text:"
echo ""
echo "       /plan-feature $FEATURE_NAME"
echo ""
echo "  3. When the run finishes, copy the result out:"
echo ""
echo "       mkdir -p \"$RUN_A\" && cp -r \"$FIXTURE_DIR\" \"$RUN_A/\""
echo ""
echo "  4. Reset the feature folder, keeping only the fixture request, so the"
echo "     dsh run starts from the same state:"
echo ""
echo "       rm -rf \"$FIXTURE_DIR\" && mkdir -p \"$FIXTURE_DIR\" && cp \"$RUN_A/$FEATURE_NAME/requirements.md\" \"$FIXTURE_DIR/\""
echo ""
echo "B. dsh"
echo "  1. Open a dsh session with \"$PROJECT\" as the working directory."
echo "  2. Run the same command. dsh does not substitute \$ARGUMENTS, so type"
echo "     the feature name, then the content of \"$FIXTURE_DIR/requirements.md\","
echo "     in the same message:"
echo ""
echo "       /plan-feature $FEATURE_NAME"
echo ""
echo "  3. When the run finishes, copy the result out:"
echo ""
echo "       mkdir -p \"$RUN_B\" && cp -r \"$FIXTURE_DIR\" \"$RUN_B/\""
echo ""
echo "C. Compare the two results."
echo ""
echo "       bash \"$REPO_ROOT/scripts/conformance-diff.sh\" \"$RUN_A/$FEATURE_NAME\" \"$RUN_B/$FEATURE_NAME\""
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "The fixture project stays at \"$PROJECT\"."
echo "Remove it yourself when the conformance run is done:"
echo ""
echo "       rm -rf \"$PROJECT\" \"$RESULTS_DIR\""
echo ""
