-- V003: notification and face-recognition settings.
USE eduface;

INSERT INTO settings (id, school_id, `key`, `value`) VALUES
 (UUID(), NULL, 'notify.require_consent',  CAST(TRUE AS JSON)),   -- only message guardians who granted 'notifications' consent
 (UUID(), NULL, 'notify.max_age_hours',    CAST(24 AS JSON));     -- queued messages older than this are cancelled, not sent late

-- Keep the face thresholds (V002) at their defaults until an accuracy test has been run with real students and the school's cameras.
INSERT INTO schema_migrations (version, description) VALUES ('V003', 'notification and face settings');
