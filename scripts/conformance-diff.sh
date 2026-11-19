#!/usr/bin/env bash
#
# Beast Mode - Conformance Diff
#
# Compares two "docs/features/" outputs by structure only. One harness
# produced runA. A different harness produced runB, from the same fixture
# request. The two runs must hold the same file set and the same document
# structure, so that either harness serves the workflow with equal effect.
#
# The script never compares body text. Model prose differs between two
# runs of the same command, on the same harness, so a body diff would fail
# on every run. Structure is the contract: the file set, the heading
# outline of each file, and the required sections of implementation.md,
# context.md, and tasks.md.
#
# Usage: bash scripts/conformance-diff.sh <runA> <runB>
#
#   <runA>   A directory that holds one feature's rendered docs, for
#            example the "docs/features/<name>/" copy from harness A.
#   <runB>   The matching copy from harness B.
#
# Exit codes:
#   0   the two runs match in structure
#   1   the two runs differ, or a run fails a required section check
#   2   a usage error, for example a missing argument or a missing path
#
# The required section list below is a fixed list, not a literal read of
# templates/dev-docs/*.md. That template also lists project-specific
# sections that many features never need, for example "API Integration" or
# "State Management" in context.md, and its "## Phase N: [Phase Name]"
# headings carry a per-feature title and count that no two runs share by
# text. The fixed list below names only the headings that both the
# template and this repo's own dogfooded feature docs hold in every case.
# A project's numbered convention, for example "## 1. Executive Summary",
# still matches: the check strips one leading "<digits>. " before it
# compares a rendered heading with a required section name.
#
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "Usage: bash scripts/conformance-diff.sh <runA> <runB>" >&2
    exit 2
fi

RUN_A="$1"
RUN_B="$2"

if [ ! -d "$RUN_A" ]; then
    echo "No directory at \"$RUN_A\"." >&2
    exit 2
fi
if [ ! -d "$RUN_B" ]; then
    echo "No directory at \"$RUN_B\"." >&2
    exit 2
fi

RUN_A="$(cd "$RUN_A" && pwd)"
RUN_B="$(cd "$RUN_B" && pwd)"

DIFF_COUNT=0

# note <line>
#
# Record one structural difference and print it at once. One line per
# difference, per the script's contract.
note() {
    echo "DIFF: $1"
    DIFF_COUNT=$((DIFF_COUNT + 1))
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# The required H2 sections, one list per file basename. A project-numbered
# heading such as "## 1. Executive Summary" still matches "Executive
# Summary" below, because heading_list() strips a leading "N. " first.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUIRED_IMPLEMENTATION=(
    "Executive Summary"
    "Goals"
    "Architecture Overview"
    "Implementation Phases"
    "Definition of Done"
    "Testing Strategy"
)

REQUIRED_CONTEXT=(
    "Quick Status"
    "Key Files"
    "Session Notes"
)

REQUIRED_TASKS=(
    "Bugs & Issues"
    "Technical Debt"
    "Progress Tracking"
)

# heading_list <file>
#
# Print every H1 and H2 heading of a markdown file, one per line, as
# "LEVEL|TEXT". A level-3-or-deeper heading never matches "^#{1,2} ", so it
# is not part of this outline.
heading_list() {
    local file="$1"
    grep -E '^#{1,2} ' "$file" 2>/dev/null | sed -E 's/^(##?) *(.*)$/\1|\2/' || true
}

# section_text <heading-line>
#
# Strip the "LEVEL|" prefix and one leading "<digits>. " numbering, so a
# project's numbered convention ("## 1. Executive Summary") still compares
# equal to the plain template heading ("## Executive Summary").
section_text() {
    local line="$1"
    line="${line#*|}"
    echo "$line" | sed -E 's/^[0-9]+\. //'
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. The file set
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FILES_A="$(cd "$RUN_A" && find . -type f -name '*.md' | sed 's|^\./||' | sort)"
FILES_B="$(cd "$RUN_B" && find . -type f -name '*.md' | sed 's|^\./||' | sort)"

while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if ! grep -qxF "$rel" <<< "$FILES_B"; then
        note "\"$rel\" exists in runA but not in runB."
    fi
done <<< "$FILES_A"

while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if ! grep -qxF "$rel" <<< "$FILES_A"; then
        note "\"$rel\" exists in runB but not in runA."
    fi
done <<< "$FILES_B"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. The H1 and H2 heading list of every file both runs hold
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if ! grep -qxF "$rel" <<< "$FILES_B"; then
        continue
    fi

    mapfile -t HEADINGS_A < <(heading_list "$RUN_A/$rel")
    mapfile -t HEADINGS_B < <(heading_list "$RUN_B/$rel")

    LEN_A="${#HEADINGS_A[@]}"
    LEN_B="${#HEADINGS_B[@]}"
    MAX_LEN="$LEN_A"
    [ "$LEN_B" -gt "$MAX_LEN" ] && MAX_LEN="$LEN_B"

    for ((i = 0; i < MAX_LEN; i++)); do
        LINE_A="${HEADINGS_A[i]:-}"
        LINE_B="${HEADINGS_B[i]:-}"
        if [ "$LINE_A" != "$LINE_B" ]; then
            note "\"$rel\" heading ${i} differs: runA holds \"${LINE_A:-<none>}\", runB holds \"${LINE_B:-<none>}\"."
            break
        fi
    done
done <<< "$FILES_A"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. The required sections of implementation.md, context.md, and tasks.md
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# check_required <run-label> <run-dir> <relative-file-list>
check_required() {
    local run_label="$1"
    local run_dir="$2"
    local files="$3"

    while IFS= read -r rel; do
        [ -z "$rel" ] && continue

        local required_name=""
        case "$(basename "$rel")" in
            implementation.md) required_name="REQUIRED_IMPLEMENTATION" ;;
            context.md) required_name="REQUIRED_CONTEXT" ;;
            tasks.md) required_name="REQUIRED_TASKS" ;;
            *) continue ;;
        esac

        mapfile -t HEADINGS < <(heading_list "$run_dir/$rel")
        local -a SECTION_TEXTS=()
        for line in "${HEADINGS[@]}"; do
            SECTION_TEXTS+=("$(section_text "$line")")
        done

        local -n required_ref="$required_name"
        for required in "${required_ref[@]}"; do
            local found=0
            for text in "${SECTION_TEXTS[@]:-}"; do
                if [ "$text" = "$required" ]; then
                    found=1
                    break
                fi
            done
            if [ "$found" -eq 0 ]; then
                note "run$run_label \"$rel\" holds no \"$required\" section."
            fi
        done
    done <<< "$files"
}

check_required "A" "$RUN_A" "$FILES_A"
check_required "B" "$RUN_B" "$FILES_B"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Result
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$DIFF_COUNT" -eq 0 ]; then
    echo "OK: runA and runB hold the same document structure."
    exit 0
fi

echo "FAIL: $DIFF_COUNT structural difference(s) found." >&2
exit 1
