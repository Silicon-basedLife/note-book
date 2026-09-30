@echo off
REM ---------------------------------------------------------------------------
REM Launch NoteApp directly, bypassing the Windows "Open File - Security Warning"
REM ("无法验证发布者 / 无法验证发布者。你确定要运行此软件吗？") dialog.
REM
REM Why this exists:
REM   That dialog is raised by Explorer (the shell) when you double-click an
REM   UNSIGNED executable that Windows treats as untrusted. Starting the process
REM   directly (CreateProcess, which is what this script does) does not raise it.
REM   It is only a confirmation prompt - clicking "Run/运行" is safe for a build
REM   you produced yourself; clicking "Cancel/取消" simply never starts the app.
REM
REM Keep this file pure ASCII so cmd.exe renders it correctly on any codepage.
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

REM Clean up a stuck previous instance, otherwise the new one may never show a window.
tasklist /fi "imagename eq noteapp.exe" 2>nul | find /i "noteapp.exe" >nul
if not errorlevel 1 (
  echo Stopping previous NoteApp instance...
  taskkill /f /im noteapp.exe >nul 2>&1
  timeout /t 2 /nobreak >nul
)

echo Starting NoteApp...
start "" "%EXE%"
exit /b 0
