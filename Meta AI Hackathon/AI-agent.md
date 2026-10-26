cat << 'EOF' > .muserules.md
# Muse Agent Profile: Webcomic App Builder

## Critical Token Constraints
- Keep all code blocks modular, highly concise, and tightly focused.
- Never write conversational introductions, generic tutorials, or textual filler.
- If a response or file is large, output only the modified snippet or requested function.

## Webcomic App Architecture Context
- Target: Mobile-first webcomic streaming layout.
- Core UI Element: Continuous vertical-scrolling panel viewer.
- Layout Constraint: Pre-calculate image aspect ratios to eliminate layout shifting during scroll.
EOF
clear
echo "🚀 .muserules.md successfully created inside your project folder!"
