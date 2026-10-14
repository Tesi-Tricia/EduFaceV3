# EduFace (static HTML edition) - Phase 3: Attendance, visitors, roll call and reports

A complete copy: everything from phases 1-2 is included, plus the additions below.

## What this phase contains
- Scan page: QR card (camera or USB scanner), or type a code; late cut-off; duplicate scans ignored
- Daily attendance view, manual override with required reason, close day (marks absentees)
- Visitors: check-in, badge with QR, check-out, watchlist/blocked, overstay alerts
- Emergency roll call (students + visitors on campus)
- Reports: attendance summary, late-comers, chronic absentees, visitors; CSV and print/PDF

## Run it
1. Double-click **start.bat** (or run `.\serve.ps1 -Open` in PowerShell). It starts a tiny web server on this computer only and opens http://localhost:8080.
2. First time: create the school and administrator. Nothing needs installing; no internet is needed.
3. Stop it with Ctrl+C in the black window.

## Important
- All data is stored **in this browser on this computer**. A different browser, profile or computer sees nothing. Clearing browser data deletes everything.
- Each phase uses its own browser database (`EduFace-phase3`), so phases do not interfere with each other.
- The camera works only on http://localhost or https, which is why start.bat is used instead of opening index.html directly.

## Database schema (MySQL)
The `db/` folder holds the MySQL 8 schema (`V001`-`V003` scripts and `SCHEMA.md`). This browser edition does not use it; it is the database design for a server-backed version.
