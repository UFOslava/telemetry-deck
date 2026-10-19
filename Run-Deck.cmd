@echo off
title Telemetry Deck
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Run-Dev.ps1" %*
