#!/usr/bin/env bash
# Beast Mode statusline for Claude Code.
#
# Reads session JSON from stdin. Falls back to docs/status.json when stdin is
# empty or a TTY, so the script can be iterated on without launching Claude
# Code:
#
#   ./scripts/statusline.sh                  # uses docs/status.json
#   echo '{...}' | ./scripts/statusline.sh   # uses piped JSON

if [ -t 0 ]; then
    input=""
else
    input=$(cat)
fi

if [ -z "$input" ]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    test_json="$script_dir/../docs/status.json"
    if [ ! -f "$test_json" ]; then
        echo "no stdin and no test data at $test_json" >&2
        exit 1
    fi
    input=$(cat "$test_json")
fi

RESET='\033[0m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
CYAN='\033[36m'

# make_bar <label> <percent> [suffix]
# Writes one segment (no newline): "<label> <colored 10-char bar> <pct>%[ <suffix>]"
make_bar() {
    local label="$1"
    local pct="$2"
    local suffix="${3:-}"

    [ -z "$pct" ] && pct=0
    [ "$pct" -gt 100 ] && pct=100
    [ "$pct" -lt 0 ] && pct=0

    local bar_color
    if [ "$pct" -ge 90 ]; then bar_color="$RED"
    elif [ "$pct" -ge 70 ]; then bar_color="$YELLOW"
    else bar_color="$GREEN"; fi

    local filled=$((pct / 10))
    local empty=$((10 - filled))
    local fill pad
    printf -v fill "%${filled}s"
    printf -v pad "%${empty}s"
    local bar="${fill// /█}${pad// /░}"

    if [ -n "$suffix" ]; then
        printf '%s %b%s%b %d%% %s' "$label" "$bar_color" "$bar" "$RESET" "$pct" "$suffix"
    else
        printf '%s %b%s%b %d%%' "$label" "$bar_color" "$bar" "$RESET" "$pct"
    fi
}

# fmt_until <epoch_seconds>
# Compact countdown: "5d2h", "3h15m", "12m", or "now" if past.
fmt_until() {
    local target="$1"
    local now diff days hours mins
    now=$(date +%s)
    diff=$((target - now))

    if [ "$diff" -le 0 ]; then
        printf 'now'
        return
    fi

    days=$((diff / 86400))
    hours=$(((diff % 86400) / 3600))
    mins=$(((diff % 3600) / 60))

    if [ "$days" -gt 0 ]; then
        if [ "$hours" -gt 0 ]; then printf '%dd%dh' "$days" "$hours"
        else printf '%dd' "$days"; fi
    elif [ "$hours" -gt 0 ]; then
        if [ "$mins" -gt 0 ]; then printf '%dh%dm' "$hours" "$mins"
        else printf '%dh' "$hours"; fi
    else
        printf '%dm' "$mins"
    fi
}

# --- Line 1: folder, branch, change counts (cached) ---
#
# Git commands are slow in large repos and the statusline runs frequently, so
# we cache to /tmp keyed by session_id (stable per session, unique across
# concurrent sessions). The cached line includes the cwd so a directory
# change inside the session invalidates the cache immediately.

DIR=$(jq -r '.workspace.project_dir // .workspace.current_dir // .cwd // ""' <<<"$input")
SESSION_ID=$(jq -r '.session_id // "default"' <<<"$input")
CACHE_FILE="/tmp/beast-mode-statusline-git-${SESSION_ID}"
CACHE_MAX_AGE=5

needs_refresh=true
if [ -f "$CACHE_FILE" ]; then
    mtime=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0)
    age=$(( $(date +%s) - mtime ))
    cached_dir=$(cut -d'|' -f1 "$CACHE_FILE")
    if [ "$age" -le "$CACHE_MAX_AGE" ] && [ "$cached_dir" = "$DIR" ]; then
        needs_refresh=false
    fi
fi

if $needs_refresh; then
    if [ -n "$DIR" ] && git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1; then
        BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null)
        STAGED=$(git -C "$DIR" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
        MODIFIED=$(git -C "$DIR" diff --numstat 2>/dev/null | wc -l | tr -d ' ')
        UNTRACKED=$(git -C "$DIR" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
        printf '%s|%s|%s|%s|%s\n' "$DIR" "$BRANCH" "$STAGED" "$MODIFIED" "$UNTRACKED" > "$CACHE_FILE"
    else
        printf '%s||||\n' "$DIR" > "$CACHE_FILE"
    fi
fi

IFS='|' read -r _ BRANCH STAGED MODIFIED UNTRACKED < "$CACHE_FILE"

git_line="${CYAN}📁 ${DIR##*/}${RESET}"
if [ -n "$BRANCH" ]; then
    git_line+="  🌿 ${BRANCH}"
    [ "${STAGED:-0}" -gt 0 ] && git_line+=" ${GREEN}+${STAGED}${RESET}"
    [ "${MODIFIED:-0}" -gt 0 ] && git_line+=" ${YELLOW}~${MODIFIED}${RESET}"
    [ "${UNTRACKED:-0}" -gt 0 ] && git_line+=" ${RED}?${UNTRACKED}${RESET}"
fi
printf '%b\n' "$git_line"

# --- Line 2: progress bars ---

SEP="  "

# Context window
PCT=$(jq -r '.context_window.used_percentage // 0' <<<"$input" | cut -d. -f1)
line=$(make_bar "🧠" "$PCT")

# 5-hour rate limit (only present for Claude.ai Pro/Max after first API response)
FIVE_H_PCT=$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$input" | cut -d. -f1)
if [ -n "$FIVE_H_PCT" ]; then
    FIVE_H_RESETS=$(jq -r '.rate_limits.five_hour.resets_at // empty' <<<"$input")
    if [ -n "$FIVE_H_RESETS" ]; then
        line+="${SEP}$(make_bar "⏳" "$FIVE_H_PCT" "$(fmt_until "$FIVE_H_RESETS")")"
    else
        line+="${SEP}$(make_bar "⏳" "$FIVE_H_PCT")"
    fi
fi

# 7-day rate limit
WEEK_PCT=$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$input" | cut -d. -f1)
if [ -n "$WEEK_PCT" ]; then
    WEEK_RESETS=$(jq -r '.rate_limits.seven_day.resets_at // empty' <<<"$input")
    if [ -n "$WEEK_RESETS" ]; then
        line+="${SEP}$(make_bar "📅" "$WEEK_PCT" "$(fmt_until "$WEEK_RESETS")")"
    else
        line+="${SEP}$(make_bar "📅" "$WEEK_PCT")"
    fi
fi

printf '%s\n' "$line"
