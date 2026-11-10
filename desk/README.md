# Nightwatch Desk

A small Windows desktop widget that shows nightwatch's one-sentence answer and what needs you, read from `GET /api/desk/glance` with a bearer token.

This folder holds `Core` (pure logic: parse, config, poll state, copy, toasts) and its tests. The window, tray and installer arrive in a later PR, with build and install steps.

Config is `%APPDATA%\NightwatchDesk\desk.json`, never committed; see `desk.example.json` for its shape.

Test: `dotnet test desk/Core.Tests` (.NET 9 SDK).
