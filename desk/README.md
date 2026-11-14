# Nightwatch Desk

A small Windows desktop widget that shows nightwatch's one-sentence answer and what needs you, read from `GET /api/desk/glance` with a bearer token. It only ever reads: the one request is a GET.

- `Core/` is the pure logic (parse, config, poll state, the no-jitter gate, copy, toasts, placement) with `Core.Tests/`.
- `App/` is the WPF window, tray and snapshot renderer (Windows only, `net9.0-windows`, no NuGet packages) with `App.Tests/`.

Config is `%APPDATA%\NightwatchDesk\desk.json`, never committed; see `desk.example.json` for its shape (`homelab.local` is a placeholder). The desk never writes it. Window position and the "Always on top" choice live in `%APPDATA%\NightwatchDesk\state.json`.

Optional `desk.json` keys: `cameraIntervalSeconds` (5-300, default 30) sets how often the door-camera picture refreshes. `doorToasts` (default `true`) raises a Windows toast when someone rings or is at the front door, read from the public `/kiosk/api/doorbell` every 5 s while a door camera is configured; `false` stops that poll. Clicking the toast opens the kiosk door view.

The FRONT DOOR header has a second button, `Watch live`: it opens the section and fetches the camera picture once a second (the server caches a frame for 1 s) in a full-width frame. Live ends when the button or the chevron is pressed, the window hides, the session locks, the PC suspends, the frame no longer fits the screen or the server answers 401, and it never restarts by itself. It is never saved.

## Build and test

Needs the .NET 9 SDK on Windows.

```powershell
dotnet test desk/Core.Tests     # any OS, runs on CI
dotnet test desk/App.Tests      # Windows only; runs on CI in the desk-app job
powershell -File desk\snapshots.ps1 out   # 58 states at 100% and 150% plus the tray sheet (117 PNGs), offscreen
```

## Install

Needs the .NET 9 Desktop Runtime. No admin.

```powershell
powershell -File desk\install.ps1 -Start
```

It publishes a single file to `%LOCALAPPDATA%\NightwatchDesk`, adds a Startup shortcut, and (only if `desk.json` is missing) asks for the address (for example `http://homelab.local:3005`) and the desk token. The token is read as a secure string and is never printed. `-Start` launches it.

Check the install without opening the window:

```powershell
& "$env:LOCALAPPDATA\NightwatchDesk\NightwatchDesk.exe" --check   # prints for example: Live tone=warn lanes=0 items=1
```

## Update

Stop the widget (tray menu, Quit), pull, and run `install.ps1 -Start` again. `desk.json` is kept.

## Uninstall

1. Tray menu, Quit.
2. Delete `%LOCALAPPDATA%\NightwatchDesk` and the `Nightwatch Desk.lnk` shortcut in the Startup folder (`shell:startup`).
3. Optionally delete `%APPDATA%\NightwatchDesk` (the config and window state).
