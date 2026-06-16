#!/bin/bash
#
# Beast Mode - Template Installation Script
#
# This script copies universal templates from the plugin to the current project
# and sets up the necessary directory structure.
#
# Usage: bash install-templates.sh
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the plugin root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$PLUGIN_ROOT/templates"

# Current project directory
PROJECT_ROOT="$(pwd)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 INSTALLING BEAST MODE TEMPLATES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Plugin root: $PLUGIN_ROOT"
echo "Project root: $PROJECT_ROOT"
echo ""

# Function to create directory if it doesn't exist
create_dir() {
    local dir=$1
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo -e "${GREEN}✓${NC} Created: $dir"
    else
        echo -e "${BLUE}ℹ${NC} Exists: $dir"
    fi
}

# Function to copy file with confirmation
copy_file() {
    local src=$1
    local dest=$2
    local overwrite=${3:-false}

    if [ -f "$dest" ] && [ "$overwrite" != "true" ]; then
        echo -e "${YELLOW}⚠${NC} Skipped (already exists): $dest"
        return
    fi

    cp "$src" "$dest"
    echo -e "${GREEN}✓${NC} Copied: $dest"
}

# Function to copy directory recursively
copy_dir() {
    local src=$1
    local dest=$2

    cp -r "$src" "$dest"
    echo -e "${GREEN}✓${NC} Copied directory: $dest"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📁 Creating directory structure..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create .claude directories
create_dir "$PROJECT_ROOT/.claude"
create_dir "$PROJECT_ROOT/.claude/commands"
create_dir "$PROJECT_ROOT/.claude/skills"
create_dir "$PROJECT_ROOT/.claude/agents"
create_dir "$PROJECT_ROOT/.claude/templates"

# Create docs/features directory
create_dir "$PROJECT_ROOT/docs"
create_dir "$PROJECT_ROOT/docs/features"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Installing slash commands..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

CMD_COUNT=0
for src in "$TEMPLATES_DIR"/slash-commands/*.md; do
    [ -f "$src" ] || continue
    filename="$(basename "$src")"
    copy_file "$src" "$PROJECT_ROOT/.claude/commands/$filename"
    CMD_COUNT=$((CMD_COUNT + 1))
done
echo -e "${GREEN}✓${NC} Installed $CMD_COUNT slash commands"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 Installing agent templates..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

AGENT_COUNT=0
for src in "$TEMPLATES_DIR"/agents/*.md; do
    [ -f "$src" ] || continue
    filename="$(basename "$src")"
    copy_file "$src" "$PROJECT_ROOT/.claude/agents/$filename"
    AGENT_COUNT=$((AGENT_COUNT + 1))
done
echo -e "${GREEN}✓${NC} Installed $AGENT_COUNT agent templates"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Installing feature doc templates..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TMPL_COUNT=0
for src in "$TEMPLATES_DIR"/dev-docs/*.md; do
    [ -f "$src" ] || continue
    filename="$(basename "$src")"
    copy_file "$src" "$PROJECT_ROOT/.claude/templates/$filename"
    TMPL_COUNT=$((TMPL_COUNT + 1))
done
echo -e "${GREEN}✓${NC} Installed $TMPL_COUNT feature doc templates"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Installing format references..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FMT_COUNT=0
for src in "$TEMPLATES_DIR"/formats/*; do
    [ -f "$src" ] || continue
    filename="$(basename "$src")"
    copy_file "$src" "$PROJECT_ROOT/.claude/$filename"
    FMT_COUNT=$((FMT_COUNT + 1))
done
echo -e "${GREEN}✓${NC} Installed $FMT_COUNT format references"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📄 Updating .gitignore..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

GITIGNORE="$PROJECT_ROOT/.gitignore"

# Create .gitignore if it doesn't exist
if [ ! -f "$GITIGNORE" ]; then
    touch "$GITIGNORE"
    echo -e "${GREEN}✓${NC} Created .gitignore"
fi

# Add Beast Mode entries if they don't exist
if ! grep -q "# Beast Mode" "$GITIGNORE" 2>/dev/null; then
    cat >> "$GITIGNORE" << 'EOF'

# Beast Mode - Backups
.claude/.beast-mode-backup-*/
EOF
    echo -e "${GREEN}✓${NC} Added Beast Mode entries to .gitignore"
else
    echo -e "${BLUE}ℹ${NC} Beast Mode entries already in .gitignore"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Writing version file..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get plugin version from plugin.json
PLUGIN_VERSION=$(grep '"version"' "$PLUGIN_ROOT/.claude-plugin/plugin.json" | sed 's/.*"version": "\(.*\)".*/\1/')

# Write version file
echo "$PLUGIN_VERSION" > "$PROJECT_ROOT/.claude/.beast-mode-version"
echo -e "${GREEN}✓${NC} Wrote version: $PLUGIN_VERSION"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ TEMPLATES INSTALLED!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Installed:"
echo "  ✓ $CMD_COUNT slash commands (.claude/commands/)"
echo "  ✓ $AGENT_COUNT agent templates (.claude/agents/)"
echo "  ✓ $TMPL_COUNT feature doc templates (.claude/templates/)"
echo "  ✓ $FMT_COUNT format references (.claude/)"
echo "  ✓ Directory structure (docs/features/)"
echo "  ✓ Updated .gitignore"
echo "  ✓ Version file (v$PLUGIN_VERSION)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
