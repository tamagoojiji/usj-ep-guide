#!/bin/bash
set -euo pipefail

# Only run in remote (web/mobile) environment
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install Node.js dependencies for the scraper
# Skip Puppeteer browser download - Chrome is not needed in Claude Code sessions
# (scraping runs in GitHub Actions with its own Chrome)
cd "$CLAUDE_PROJECT_DIR/scripts"
PUPPETEER_SKIP_DOWNLOAD=true npm install
