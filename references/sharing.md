# Sharing and installation

The supported installation is a macOS user-level clone of the public source
repository. It makes the skill available across Cursor projects.

Prerequisites: GitHub CLI and Node.js 20+ with npm.

```bash
gh repo clone ebarron/EdsDemoVideoBuilder "$HOME/.cursor/skills/demo-video-builder"
"$HOME/.cursor/skills/demo-video-builder/scripts/install.sh"
```

Start a new Cursor chat or reload Cursor after the first installation.

```bash
git -C "$HOME/.cursor/skills/demo-video-builder" pull --ff-only
"$HOME/.cursor/skills/demo-video-builder/scripts/install.sh"
```

On Windows, Git and Node.js 20+ replace the GitHub CLI requirement.

```powershell
git clone https://github.com/ebarron/EdsDemoVideoBuilder.git "$env:USERPROFILE\.cursor\skills\demo-video-builder"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.cursor\skills\demo-video-builder\scripts\install.ps1"
```

```powershell
git -C "$env:USERPROFILE\.cursor\skills\demo-video-builder" pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.cursor\skills\demo-video-builder\scripts\install.ps1"
```

New Windows demos use Kokoro. The macOS `say` voice remains macOS-only, and
the voiceover studio opens in the default browser.

Project-local installation, manual copies, and Linux installation are
outside the supported scope.
