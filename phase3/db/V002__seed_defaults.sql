-- V002: global default roles and settings (school_id NULL = global default).
USE eduface;

INSERT INTO roles (id, school_id, name, permissions) VALUES
 (UUID(), NULL, 'SuperAdmin',  JSON_ARRAY('*')),
 (UUID(), NULL, 'SchoolAdmin', JSON_ARRAY('school.*','students.*','visitors.*','reports.*','devices.*','users.*','consent.*','attendance.*','rollcall.read','audit.read')),
 (UUID(), NULL, 'Teacher',     JSON_ARRAY('students.read','attendance.read','attendance.override','attendance.scan','reports.class')),
 (UUID(), NULL, 'Security',    JSON_ARRAY('visitors.*','attendance.read','attendance.scan','rollcall.read')),
 (UUID(), NULL, 'Parent',      JSON_ARRAY('portal.read'));

INSERT INTO settings (id, school_id, `key`, `value`) VALUES
 (UUID(), NULL, 'attendance.late_cutoff',        JSON_QUOTE('08:15')),
 (UUID(), NULL, 'attendance.rescan_window_sec',  CAST(30 AS JSON)),
 (UUID(), NULL, 'face.match_threshold',          CAST(0.45 AS JSON)),   -- tune only after an accuracy test
 (UUID(), NULL, 'face.margin_to_second',         CAST(0.08 AS JSON)),
 (UUID(), NULL, 'face.liveness_threshold',       CAST(0.80 AS JSON)),
 (UUID(), NULL, 'visitor.default_max_minutes',   CAST(120 AS JSON)),
 (UUID(), NULL, 'retention.withdrawn_student_days', CAST(90 AS JSON)),
 (UUID(), NULL, 'retention.visitor_days',        CAST(365 AS JSON)),
 (UUID(), NULL, 'session.idle_timeout_min',      CAST(15 AS JSON)),
 (UUID(), NULL, 'sync.interval_sec',             CAST(15 AS JSON));

INSERT INTO schema_migrations (version, description) VALUES ('V002', 'default roles and settings');
