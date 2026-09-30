@echo off
REM ---------------------------------------------------------------------------
REM Launch NoteApp directly, bypassing the Windows "Open File - Security Warning"
REM dialog (the one that says the publisher cannot be verified).
REM
REM Why this exists:
REM   Explorer (the shell) raises that dialog when you double-click an UNSIGNED
REM   executable. Starting the process directly does not raise it. The dialog is
REM   only a confirmation prompt: clicking Run is safe for a build you produced
REM   yourself, while clicking Cancel simply never starts the app.
REM
REM IMPORTANT: keep this file CRLF-terminated and pure ASCII.
REM   cmd.exe misparses LF-only batch files - REM lines get executed as commands.
REM   That was a real bug in the first version of this file.
REM ---------------------------------------------------------------------------
setlocal
set "EXE=%~dp0src-tauri\target\release\noteapp.exe"

if not exist "%EXE%" (
  echo [ERROR] Not found: "%EXE%"
  echo         Build it first:  npm run desktop:exe
  echo.
  pause
  exit /b 1
)

tasklist /fi "imagename eq noteapp.exe" 2>nul | find /i "noteapp.exe" >nul
if not errorlevel 1 (
  echo Stopping previous NoteApp instance...
  taskkill /f /im noteapp.exe >nul 2>&1
  timeout /t 2 /nobreak >nul
)

echo Starting NoteApp...
start "" "%EXE%"
exit /b 0
