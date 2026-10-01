@echo off
cd /d "%~dp0"
where go >nul 2>nul
if errorlevel 1 (
  echo Go is not installed yet.
  echo Download it free from https://go.dev/dl/ ^(the Windows installer^), install it, then run this again.
  pause
  exit /b 1
)
echo Closing Yupoo Library if it's open...
taskkill /im YupooLibrary.exe >nul 2>nul
taskkill /im KitLibrary.exe >nul 2>nul
timeout /t 2 /nobreak >nul
if exist "Icon Yupoo.ico" go run tools/makeicon/main.go "Icon Yupoo.ico"
echo Building YupooLibrary.exe...
go build -trimpath -ldflags "-H windowsgui -s -w" -o YupooLibrary.exe .
if errorlevel 1 (
  echo.
  echo Build failed - the message above says what went wrong.
  echo Copy it into Claude Code and ask it to fix the problem.
  pause
  exit /b 1
)
echo Done! Starting the new version...
start "" YupooLibrary.exe
