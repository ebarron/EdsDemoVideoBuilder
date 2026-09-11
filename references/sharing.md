# Sharing and installation

The supported installation is a macOS user-level clone of the private
repository. It makes the skill available across Cursor projects.

Prerequisites: GitHub CLI authenticated with repository access and Node.js 20+
with npm.

```bash
gh repo clone ebarron/EdsDemoVideoBuilder "$HOME/.cursor/skills/narrated-browser-demo"
"$HOME/.cursor/skills/narrated-browser-demo/scripts/install.sh"
```

Start a new Cursor chat or reload Cursor after the first installation.

```bash
git -C "$HOME/.cursor/skills/narrated-browser-demo" pull --ff-only
"$HOME/.cursor/skills/narrated-browser-demo/scripts/install.sh"
```

Project-local installation, manual copies, and non-macOS installation are
outside the supported scope.
