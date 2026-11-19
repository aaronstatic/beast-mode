#!/usr/bin/env bash
#
# Beast Mode - Layout v4 to v5 Migration
#
# Version 4 kept every Beast Mode file under .claude/:
#   .claude/commands/<name>.md   the 24 command files
#   .claude/templates/           the feature doc templates
#   .claude/<format>.md          the shared format references
#
# Version 5 splits that layout. Every harness reads the shared files, so they
# move to .beast-mode/. Each command becomes a skill at .claude/skills/<name>/,
# which /upgrade-beast-mode copies after this script runs.
#
# Usage: bash migrate-v4-to-v5.sh <plugin-root>
#
# Run the script from the project root. Argument one is the Beast Mode plugin
# root. The script reads the shipped command names from that plugin.
#
# Safety rules:
#   - The script backs up every file before it moves or deletes the file.
#   - The script deletes a command file only when the plugin ships that name.
#   - The script never overwrites a file that already sits in .beast-mode/.
#   - The script refuses to run against the Beast Mode repo, which links
#     .claude/ and .beast-mode/ back into its own source.
#   - The script leaves .claude/hooks/, .claude/skills/, .claude/agents/, and
#     docs/features/ alone.
#   - A second run finds no version 4 file and exits with a no-op message.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(pwd)"
CLAUDE_DIR="$PROJECT_ROOT/.claude"
SHARED_DIR="$PROJECT_ROOT/.beast-mode"

# The version 4 format references. The version 4 install wrote each of these
# files into .claude/. The list is fixed on purpose, so the script moves a
# known file and nothing else.
FORMAT_FILES=(
    "epic-resolution.md"
    "agent-structure-example.md"
    "skill-structure-example.md"
    "mission-statement-template.md"
    "technical-design-template.md"
)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 BEAST MODE LAYOUT v4 → v5 MIGRATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Guard 1. The plugin root
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ $# -lt 1 ]; then
    echo -e "${RED}❌ No plugin root.${NC}"
    echo "   The script reads the shipped command names from the plugin."
    echo "   Run it again with the plugin root as argument one:"
    echo "     bash migrate-v4-to-v5.sh <plugin-root>"
    echo ""
    exit 1
fi

if [ ! -d "$1" ]; then
    echo -e "${RED}❌ The plugin root \"$1\" is not a directory.${NC}"
    echo "   The script reads the shipped command names from the plugin."
    echo "   Pass the directory that holds .claude-plugin/plugin.json."
    echo ""
    exit 1
fi

PLUGIN_ROOT="$(cd "$1" && pwd)"

if [ ! -f "$PLUGIN_ROOT/.claude-plugin/plugin.json" ]; then
    echo -e "${RED}❌ No plugin manifest at $PLUGIN_ROOT/.claude-plugin/plugin.json${NC}"
    echo "   The script cannot confirm that this path holds Beast Mode."
    echo "   Pass the Beast Mode plugin root, then run the script again."
    echo ""
    exit 1
fi

if [ ! -d "$PLUGIN_ROOT/templates/skills" ]; then
    echo -e "${RED}❌ No command skills at $PLUGIN_ROOT/templates/skills${NC}"
    echo "   The script derives the delete list from that directory."
    echo "   Update the plugin to version 5.0.0 or later, then run the script again."
    echo ""
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Guard 2. Never run against the plugin repo
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# The Beast Mode repo develops Beast Mode with Beast Mode. Its .claude/ and
# .beast-mode/ directories hold symlinks into the tracked source, so a move or
# a delete there edits the shipped files.

if [ "$PROJECT_ROOT" = "$PLUGIN_ROOT" ]; then
    echo -e "${RED}❌ The project root is the plugin root.${NC}"
    echo "   This script migrates a project that uses Beast Mode, not the plugin itself."
    echo "   Change to the project you want to migrate, then run the script again."
    echo ""
    exit 1
fi

if [ -f "$PROJECT_ROOT/.claude-plugin/plugin.json" ]; then
    if command -v jq >/dev/null 2>&1; then
        LOCAL_PLUGIN_NAME="$(jq -r '.name // ""' "$PROJECT_ROOT/.claude-plugin/plugin.json")"
    else
        LOCAL_PLUGIN_NAME="$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PROJECT_ROOT/.claude-plugin/plugin.json" | head -1)"
    fi
    if [ "$LOCAL_PLUGIN_NAME" = "beast-mode" ]; then
        echo -e "${RED}❌ The project root holds the Beast Mode plugin manifest.${NC}"
        echo "   This directory is a Beast Mode checkout, and its .claude/ links into the source."
        echo "   Change to the project you want to migrate, then run the script again."
        echo ""
        exit 1
    fi
fi

# A symlinked layout directory points at tracked source. A move or a delete
# there edits the link target, so refuse the whole run.
LINKED=""
for rel in ".claude/commands" ".claude/skills" ".claude/templates" ".beast-mode" ".beast-mode/templates"; do
    if [ -L "$PROJECT_ROOT/$rel" ]; then
        LINKED="$LINKED  $rel -> $(readlink "$PROJECT_ROOT/$rel")
"
    fi
done

if [ -n "$LINKED" ]; then
    echo -e "${RED}❌ A Beast Mode directory in this project is a symlink:${NC}"
    printf '%s' "$LINKED"
    echo "   The script would move and delete files inside the link target."
    echo "   Replace each link with a real directory, then run the script again."
    echo ""
    exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Guard 3. Find the version 4 files
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# The delete list comes from the plugin, one name per skill folder. The script
# never deletes a command file whose name is absent from this list.
SHIPPED_NAMES=()
for skill_dir in "$PLUGIN_ROOT"/templates/skills/*/; do
    [ -d "$skill_dir" ] || continue
    SHIPPED_NAMES+=("$(basename "$skill_dir")")
done

if [ ${#SHIPPED_NAMES[@]} -eq 0 ]; then
    echo -e "${RED}❌ $PLUGIN_ROOT/templates/skills holds no skill folder.${NC}"
    echo "   The script cannot tell a Beast Mode command from a command you wrote."
    echo "   Reinstall the plugin, then run the script again."
    echo ""
    exit 1
fi

OLD_COMMANDS=()
for name in "${SHIPPED_NAMES[@]}"; do
    if [ -f "$CLAUDE_DIR/commands/$name.md" ]; then
        OLD_COMMANDS+=("$name")
    fi
done

OLD_FORMATS=()
for format_file in "${FORMAT_FILES[@]}"; do
    if [ -f "$CLAUDE_DIR/$format_file" ]; then
        OLD_FORMATS+=("$format_file")
    fi
done

OLD_TEMPLATES="no"
if [ -d "$CLAUDE_DIR/templates" ]; then
    OLD_TEMPLATES="yes"
fi

if [ ${#OLD_COMMANDS[@]} -eq 0 ] && [ "$OLD_TEMPLATES" = "no" ] && [ ${#OLD_FORMATS[@]} -eq 0 ]; then
    echo -e "${BLUE}ℹ️${NC}  No version 4 file found. Nothing to migrate."
    echo "   This project already runs the version 5 layout, or it never held Beast Mode."
    echo ""
    echo "   The script looked for:"
    echo "     .claude/commands/<name>.md   for each of the ${#SHIPPED_NAMES[@]} shipped commands"
    echo "     .claude/templates/           the feature doc templates"
    echo "     .claude/<format>.md          the ${#FORMAT_FILES[@]} format references"
    echo ""
    exit 0
fi

echo "Project root: $PROJECT_ROOT"
echo "Plugin root:  $PLUGIN_ROOT"
echo ""
echo "Found the version 4 layout:"
echo "  ${#OLD_COMMANDS[@]} Beast Mode command file(s) in .claude/commands/"
echo "  ${#OLD_FORMATS[@]} format reference(s) in .claude/"
if [ "$OLD_TEMPLATES" = "yes" ]; then
    echo "  the feature doc templates in .claude/templates/"
fi
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 1. Back up
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BACKUP_DIR="$CLAUDE_DIR/.beast-mode-backup-$(date +%Y%m%d-%H%M%S)"

# Two runs inside the same second would share one directory. Give the second
# run its own directory, so one backup never writes over another.
if [ -e "$BACKUP_DIR" ]; then
    suffix=2
    while [ -e "$BACKUP_DIR-$suffix" ]; do
        suffix=$((suffix + 1))
    done
    BACKUP_DIR="$BACKUP_DIR-$suffix"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Backing up the version 4 files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if ! mkdir -p "$BACKUP_DIR"; then
    echo -e "${RED}❌ The script cannot create $BACKUP_DIR${NC}"
    echo "   The migration backs up every file before it moves one, so it stops here."
    echo "   Check the write permission on .claude/, then run the script again."
    echo ""
    exit 1
fi

# Copy the contents, not the directory. A plain "cp -r src dest" nests the
# directory when dest already exists.
if [ -d "$CLAUDE_DIR/commands" ]; then
    mkdir -p "$BACKUP_DIR/commands"
    cp -r "$CLAUDE_DIR/commands/." "$BACKUP_DIR/commands/"
    echo -e "  ${GREEN}✓${NC} .claude/commands/  →  $BACKUP_DIR/commands/"
fi

if [ "$OLD_TEMPLATES" = "yes" ]; then
    mkdir -p "$BACKUP_DIR/templates"
    cp -r "$CLAUDE_DIR/templates/." "$BACKUP_DIR/templates/"
    echo -e "  ${GREEN}✓${NC} .claude/templates/  →  $BACKUP_DIR/templates/"
fi

if [ ${#OLD_FORMATS[@]} -gt 0 ]; then
    for format_file in "${OLD_FORMATS[@]}"; do
        cp "$CLAUDE_DIR/$format_file" "$BACKUP_DIR/$format_file"
        echo -e "  ${GREEN}✓${NC} .claude/$format_file  →  $BACKUP_DIR/$format_file"
    done
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2. Move the shared files to .beast-mode/
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Moving the shared files to .beast-mode/..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

mkdir -p "$SHARED_DIR/templates"

MOVED_TEMPLATES=0
MOVED_FORMATS=0
CONFLICTS=0

if [ "$OLD_TEMPLATES" = "yes" ]; then
    for entry in "$CLAUDE_DIR"/templates/* "$CLAUDE_DIR"/templates/.[!.]*; do
        [ -e "$entry" ] || continue
        base="$(basename "$entry")"
        if [ -e "$SHARED_DIR/templates/$base" ]; then
            echo -e "  ${YELLOW}⚠${NC} Kept both: .beast-mode/templates/$base already exists"
            echo "     The old copy stays at .claude/templates/$base. Compare the two, then delete one."
            CONFLICTS=$((CONFLICTS + 1))
            continue
        fi
        mv "$entry" "$SHARED_DIR/templates/$base"
        echo -e "  ${GREEN}✓${NC} .claude/templates/$base  →  .beast-mode/templates/$base"
        MOVED_TEMPLATES=$((MOVED_TEMPLATES + 1))
    done
fi

if [ ${#OLD_FORMATS[@]} -gt 0 ]; then
    for format_file in "${OLD_FORMATS[@]}"; do
        if [ -e "$SHARED_DIR/$format_file" ]; then
            echo -e "  ${YELLOW}⚠${NC} Kept both: .beast-mode/$format_file already exists"
            echo "     The old copy stays at .claude/$format_file. Compare the two, then delete one."
            CONFLICTS=$((CONFLICTS + 1))
            continue
        fi
        mv "$CLAUDE_DIR/$format_file" "$SHARED_DIR/$format_file"
        echo -e "  ${GREEN}✓${NC} .claude/$format_file  →  .beast-mode/$format_file"
        MOVED_FORMATS=$((MOVED_FORMATS + 1))
    done
fi

if [ "$MOVED_TEMPLATES" -eq 0 ] && [ "$MOVED_FORMATS" -eq 0 ] && [ "$CONFLICTS" -eq 0 ]; then
    echo "  No shared file to move."
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3. Delete the shipped command files
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# A leftover .claude/commands/<name>.md and a new .claude/skills/<name>/ both
# answer /<name>. The delete removes that duplicate. Every deleted file sits in
# the backup, and every name comes from the plugin list.

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗑️  Removing the version 4 command files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DELETED=0
if [ ${#OLD_COMMANDS[@]} -gt 0 ]; then
    for name in "${OLD_COMMANDS[@]}"; do
        rm "$CLAUDE_DIR/commands/$name.md"
        echo -e "  ${GREEN}✓${NC} Removed: .claude/commands/$name.md"
        DELETED=$((DELETED + 1))
    done
else
    echo "  No Beast Mode command file to remove."
fi

KEPT=0
if [ -d "$CLAUDE_DIR/commands" ]; then
    for entry in "$CLAUDE_DIR"/commands/* "$CLAUDE_DIR"/commands/.[!.]*; do
        [ -e "$entry" ] || continue
        if [ "$KEPT" -eq 0 ]; then
            echo ""
            echo "  These files are yours. The script keeps them:"
        fi
        echo -e "  ${BLUE}ℹ${NC} Kept: .claude/commands/$(basename "$entry")"
        KEPT=$((KEPT + 1))
    done
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 4. Remove the empty version 4 directories
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

for rel in ".claude/commands" ".claude/templates"; do
    dir="$PROJECT_ROOT/$rel"
    [ -d "$dir" ] || continue
    if rmdir "$dir" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Removed the empty directory: $rel"
    else
        echo -e "  ${BLUE}ℹ${NC} Kept $rel because it still holds a file."
    fi
done

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 5. Report a user skill that carries a shipped command name
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#
# Version 4 kept the Beast Mode commands in .claude/commands/, so every folder
# in .claude/skills/ belongs to the user. Report a name clash. Never overwrite
# and never delete a folder there.

COLLISIONS=0
if [ -d "$CLAUDE_DIR/skills" ]; then
    for name in "${SHIPPED_NAMES[@]}"; do
        if [ -e "$CLAUDE_DIR/skills/$name" ]; then
            if [ "$COLLISIONS" -eq 0 ]; then
                echo -e "${YELLOW}⚠ Your skills carry a Beast Mode command name:${NC}"
            fi
            echo "  .claude/skills/$name/"
            COLLISIONS=$((COLLISIONS + 1))
        fi
    done
    if [ "$COLLISIONS" -gt 0 ]; then
        echo "  The upgrade keeps your skill and installs no Beast Mode skill of that name."
        echo "  Rename your skill to run both."
        echo ""
    fi
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6. Summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ MIGRATION COMPLETE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Moved to .beast-mode/:"
echo "  • $MOVED_TEMPLATES feature doc template(s) → .beast-mode/templates/"
echo "  • $MOVED_FORMATS format reference(s) → .beast-mode/"
echo ""
echo "Removed from .claude/commands/:"
echo "  • $DELETED Beast Mode command file(s)"
echo "  • $KEPT file(s) of your own stayed"
if [ "$CONFLICTS" -gt 0 ]; then
    echo ""
    echo "Needs your decision:"
    echo "  • $CONFLICTS file(s) already existed in .beast-mode/. The old copy stayed in .claude/."
fi
if [ "$COLLISIONS" -gt 0 ]; then
    echo ""
    echo "Name clash:"
    echo "  • $COLLISIONS skill(s) of yours carry a Beast Mode command name."
fi
echo ""
echo "📦 Backup: $BACKUP_DIR"
echo ""
echo "Next: /upgrade-beast-mode installs the command skills into .claude/skills/."
echo "Commit .beast-mode/ with the project. Every harness reads it."
echo ""
