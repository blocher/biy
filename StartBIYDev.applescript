-- BIY development launcher: Django, React, and an import/tools shell in iTerm.
-- Reclaim only BIY's two loopback development ports before starting fresh.
do shell script "for port in 8017 5178; do pids=$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true); if [ -n \"$pids\" ]; then kill $pids; fi; done; sleep 1"

tell application "Finder"
    set screenBounds to bounds of window of desktop
    set screenWidth to item 3 of screenBounds
    set screenHeight to item 4 of screenBounds
end tell

tell application "iTerm"
    activate

    -- Replace only an existing BIY launcher window. Other iTerm work is untouched.
    set windowList to windows
    repeat with w in windowList
        try
            set sessionList to sessions of current tab of w
            repeat with s in sessionList
                tell s
                    set biySession to variable named "user.BIYSession"
                    if biySession is not missing value then
                        close w
                        exit repeat
                    end if
                end tell
            end repeat
        end try
    end repeat

    set newWindow to (create window with default profile)
    set bounds of newWindow to {0, 0, screenWidth * 0.75, screenHeight}

    -- Top pane: Django API.
    tell current session of newWindow
        set variable named "user.BIYSession" to "Backend"
        set name to "BIY Backend :8017"
        write text "cd ~/projects/biy"
        write text "source .venv/bin/activate"
        write text "python backend/manage.py check && python backend/manage.py runserver 127.0.0.1:8017"
        set frontendPane to (split horizontally with default profile)
    end tell

    -- Middle pane: Vite frontend.
    tell frontendPane
        set variable named "user.BIYSession" to "Frontend"
        set name to "BIY Frontend :5178"
        write text "cd ~/projects/biy/frontend"
        write text "npm run dev -- --strictPort"
        set toolsPane to (split horizontally with default profile)
    end tell

    -- Bottom pane: ready-to-use project and import shell.
    tell toolsPane
        set variable named "user.BIYSession" to "Tools"
        set name to "BIY Import and Tools"
        write text "cd ~/projects/biy"
        write text "source .venv/bin/activate"
        write text "git status --short"
        write text "printf '\\nImport one day:\\n  python backend/manage.py import_podcasts --day 1\\n\\nRefresh episode list only (no audio or AI):\\n  python backend/manage.py import_podcasts --all --catalog-only\\n\\nResume the full import:\\n  python backend/manage.py import_podcasts --all --workers 4\\n\\n'"
    end tell
end tell

try
    do shell script "open -a 'Google Chrome' 'http://localhost:5178/' > /dev/null 2>&1 &"
end try
