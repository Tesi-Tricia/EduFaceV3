@echo off
title EduFace
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Open
