#!/bin/bash
# Launcher for zk-X509 Interactive CLI
# Opens Terminal.app and runs the interactive binary

DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$DIR/interactive"

if [ ! -x "$BINARY" ]; then
    osascript -e 'display dialog "zk-X509 binary not found." buttons {"OK"} default button "OK" with icon stop'
    exit 1
fi

# Open Terminal.app with the interactive binary
# Uses quoted heredoc and argv to prevent shell expansion issues
osascript - "$BINARY" <<'APPLESCRIPT'
on run argv
    set binPath to quoted form of (item 1 of argv)
    tell application "Terminal"
        activate
        set newTab to do script "clear && " & binPath & "; echo ''; echo 'Press Enter to close...'; read"
        set custom title of newTab to "zk-X509 Proof Generator"
        set title displays custom title of newTab to true
    end tell
end run
APPLESCRIPT
