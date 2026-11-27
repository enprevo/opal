@echo off
rem Installs Opal on this Windows computer from this folder, in one step: double-click install.cmd
rem When Node.js (22.12 or newer) is missing it offers to install it with winget.
rem Options: --no-open (do not start Opal at the end), --keep (keep the packaged app),
rem --clean-all (also delete the dependencies and the build afterwards).
setlocal
cd /d "%~dp0"

call :nodeok
if not errorlevel 1 goto run

echo Opal needs Node.js 22.12 or newer to be built, and this computer does not have it.
where winget >nul 2>nul
if errorlevel 1 goto manual
choice /c YN /m "Install it now with winget"
if errorlevel 2 goto manual
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
rem This window does not see the new PATH yet: add the usual place of Node.js.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :nodeok
if not errorlevel 1 goto run

:manual
echo Install Node.js (LTS) from https://nodejs.org , then run install.cmd again.
start "" "https://nodejs.org/"
goto fail

:run
node build\install.mjs %*
if errorlevel 1 goto fail
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1

:nodeok
where node >nul 2>nul
if errorlevel 1 exit /b 1
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
exit /b %errorlevel%
