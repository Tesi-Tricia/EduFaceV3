# EduFace - MySQL schema

MySQL 8.x (InnoDB, utf8mb4). These scripts create the tables for schools, users, students, attendance, visitors, face templates and more.

> **The browser edition in this folder does not use MySQL.** It keeps its data in the browser (IndexedDB). This schema is the database design for a server-backed version, and it matches the record shapes the browser edition already uses (UUID ids, `created_at`, `updated_at`, `version`, soft delete).

## Apply it
```
mysql -u root -p < V001__init_schema.sql
mysql -u root -p < V002__seed_defaults.sql
mysql -u root -p < V003__notification_and_face_settings.sql
```
Open `V001__init_schema.sql` in MySQL Workbench (File > Open SQL Script, then Database > Reverse Engineer) to get the EER diagram. Each later change ships as a new `V00N__*.sql`, recorded in `schema_migrations`.

## Tables and relationships (EER)
```
schools 1--* roles (school_id NULL = global role)
schools 1--* users *--1 roles
schools 1--* classes *--0..1 users (class teacher)
schools 1--* students *--0..1 classes
students *--* guardians          via student_guardians
students 1--* consent_records *--1 guardians
students 1--* face_embeddings    (subject_type = 'student')
users    1--* face_embeddings    (subject_type = 'staff')
schools 1--* devices
students 1--* attendance_events *--0..1 devices  (users for staff clock-in)
attendance_events *--0..1 users (override_by)
schools 1--* visitors 1--* visits 1--* badges
visits *--0..1 users (host), *--0..1 devices (entry)
guardians / students 1--* notifications_queue
schools 1--* settings (school_id NULL = global default)
audit_logs: append-only, hash-chained, no foreign keys (rows survive deletion of what they describe)
sync_outbox, sync_state, sync_inbox, sync_changes: optional tables for syncing several sites
```

## Design notes
- **Keys:** `CHAR(36)` UUID everywhere (readable in Workbench, no collisions between sites). The application generates them; nothing uses AUTO_INCREMENT except the `sync_outbox` ordering column.
- **Common columns:** `school_id, created_at, updated_at, version, deleted_at`. `version` is increased on every update; deletes are soft (`deleted_at`).
- **Biometrics:** `face_embeddings.embedding_enc` holds only encrypted face templates (AES-256-GCM: nonce, ciphertext, tag). No column stores face photos.
- **Immutable audit log:** `BEFORE UPDATE/DELETE` triggers on `audit_logs` raise an error, and each row's `row_hash` covers the previous row's hash.
- **Manual changes:** a CHECK constraint on `attendance_events` makes a reason and a user mandatory when `method = 'manual'`.
- **Polymorphic subject** (`student` or `staff`) in `attendance_events` and `face_embeddings` is enforced with CHECK constraints.

## Indexes (fast lookups by date, student and device)
| Query | Index |
|---|---|
| Today's attendance for a school, counts by status | `attendance_events(school_id, event_date, status)` |
| A student's history, term report | `attendance_events(student_id, event_date)` |
| Device activity | `attendance_events(device_id, occurred_at)` |
| Visitors on site, overstays | `visits(school_id, status, checked_in_at)` |
| Name / ID search | `students(school_id, last_name, first_name)`, `visitors(school_id, id_number)` |
| Notification dispatch | `notifications_queue(status, next_attempt_at)` |

## Sync (only if several sites are ever connected)
Each write also inserts a `sync_outbox` row in the same transaction; a background job sends the rows in order and the receiver ignores duplicates by `event_id`.

| Data | Conflict rule |
|---|---|
| Attendance events, audit entries, visit check-in/out | Append-only: no conflicts; a correction is a new event |
| Students, guardians, classes, consent, face templates | The school that owns the record wins; higher `version` wins |
| Roles and global settings | Central wins |
| Deletes | A delete beats an update at equal version |
| Consent | Most restrictive wins: a withdrawal always supersedes a grant |

## Retention
- Students who are `graduated` or `withdrawn` for longer than `retention.withdrawn_student_days` (default 90): delete their `face_embeddings` and thumbnail.
- Visitors older than `retention.visitor_days` (default 365): delete the photo, face template and ID number; keep totals.
- Nothing is ever deleted from `audit_logs`.

## Backups
Turn on the binary log (`log_bin`, `binlog_format=ROW`, `sync_binlog=1`, `innodb_flush_log_at_trx_commit=1`) and take regular `mysqldump --single-transaction --routines --triggers` backups. Encrypt them, store copies elsewhere, and test a restore.
