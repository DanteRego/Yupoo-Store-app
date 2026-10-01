@echo off
cd /d "%~dp0"
where go >nul 2>nul
if errorlevel 1 (
  echo Go is not installed yet.
  echo Download it free from https://go.dev/dl/ ^(the Windows installer^), install it, then run this again.
  pause
  exit /b 1
)
echo Closing Kit Library if it's open...
taskkill /im KitLibrary.exe >nul 2>nul
timeout /t 2 /nobreak >nul
echo Building KitLibrary.exe...
go build -trimpath -ldflags "-H windowsgui -s -w" -o KitLibrary.exe .
if errorlevel 1 (
  echo.
  echo Build failed - the message above says what went wrong.
  echo Copy it into Claude Code and ask it to fix the problem.
  pause
  exit /b 1
)
echo Done! Starting the new version...
start "" KitLibrary.exe
