CREATE TABLE users (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, username VARCHAR(100) NOT NULL UNIQUE,
 display_name VARCHAR(200) NOT NULL, password_hash VARCHAR(255) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, auth_version INT NOT NULL DEFAULT 1,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE roles (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(40) NOT NULL UNIQUE) ENGINE=InnoDB;
CREATE TABLE permissions (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(80) NOT NULL UNIQUE) ENGINE=InnoDB;
CREATE TABLE user_roles (
 user_id BIGINT UNSIGNED NOT NULL, role_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(user_id,role_id),
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(role_id) REFERENCES roles(id)
) ENGINE=InnoDB;
CREATE TABLE role_permissions (
 role_id BIGINT UNSIGNED NOT NULL, permission_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(role_id,permission_id),
 FOREIGN KEY(role_id) REFERENCES roles(id), FOREIGN KEY(permission_id) REFERENCES permissions(id)
) ENGINE=InnoDB;
CREATE TABLE user_sessions (
 token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL,
 csrf_token VARCHAR(64) CHARACTER SET ascii NOT NULL, auth_version INT NOT NULL,
 expires_at DATETIME(6) NOT NULL, last_seen_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(user_id) REFERENCES users(id), INDEX(expires_at)
) ENGINE=InnoDB;
CREATE TABLE login_limits (
 bucket CHAR(64) CHARACTER SET ascii PRIMARY KEY, attempts INT NOT NULL, reset_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE audit_logs (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, actor_user_id BIGINT UNSIGNED NULL,
 action VARCHAR(80) NOT NULL, entity_type VARCHAR(80) NOT NULL, entity_id VARCHAR(80) NULL,
 changes JSON NULL, request_id CHAR(36) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(actor_user_id) REFERENCES users(id), INDEX(entity_type,entity_id,created_at), INDEX(actor_user_id,action,created_at)
) ENGINE=InnoDB;

-- Clinics come from the HOSxP clinic table. Nothing is sent for a clinic until an admin enables it.
-- code '-' collects appointments that have no clinic in HOSxP.
CREATE TABLE clinics (
 code VARCHAR(20) PRIMARY KEY, name VARCHAR(255) NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE, note VARCHAR(1000) NOT NULL DEFAULT '',
 in_source BOOLEAN NOT NULL DEFAULT TRUE, version INT NOT NULL DEFAULT 1
) ENGINE=InnoDB;
-- Snapshot of HOSxP oapp rows in the monitored range. No CID is stored: it is read from HOSxP at send time.
CREATE TABLE appointments (
 oapp_id VARCHAR(64) CHARACTER SET ascii PRIMARY KEY,
 hn VARCHAR(20) NOT NULL, patient_name VARCHAR(255) NOT NULL DEFAULT '',
 clinic_code VARCHAR(20) NOT NULL, appointment_date DATE NOT NULL, appointment_time TIME NULL,
 location VARCHAR(255) NOT NULL DEFAULT '', doctor_name VARCHAR(255) NOT NULL DEFAULT '',
 source_status_id VARCHAR(40) NULL, fingerprint CHAR(64) CHARACTER SET ascii NOT NULL,
 schedule_version INT NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 INDEX(appointment_date,clinic_code), INDEX(hn), INDEX(active,appointment_date)
) ENGINE=InnoDB;
CREATE TABLE sync_state (
 id INT PRIMARY KEY, initialized BOOLEAN NOT NULL DEFAULT FALSE,
 last_success_at DATETIME(6) NULL, last_error VARCHAR(200) NULL, last_error_at DATETIME(6) NULL, last_count INT NULL
) ENGINE=InnoDB;
INSERT INTO sync_state(id) VALUES(1);
-- Patients (by HN) who asked not to receive LINE notices.
CREATE TABLE patient_opt_outs (
 hn VARCHAR(20) PRIMARY KEY, note VARCHAR(255) NOT NULL DEFAULT '',
 created_by BIGINT UNSIGNED NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE notification_settings (
 id INT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE, mode ENUM('DRY_RUN','LIVE') NOT NULL DEFAULT 'DRY_RUN',
 notify_new BOOLEAN NOT NULL DEFAULT TRUE, notify_cancel BOOLEAN NOT NULL DEFAULT TRUE,
 reminder_time TIME NOT NULL DEFAULT '08:00:00',
 window_start TIME NOT NULL DEFAULT '07:00:00', window_end TIME NOT NULL DEFAULT '20:00:00',
 version INT NOT NULL DEFAULT 1, CHECK(window_start < window_end)
) ENGINE=InnoDB;
INSERT INTO notification_settings(id) VALUES(1);
CREATE TABLE notification_rules (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, days_before SMALLINT UNSIGNED NOT NULL UNIQUE,
 active BOOLEAN NOT NULL DEFAULT TRUE, CHECK(days_before <= 30)
) ENGINE=InnoDB;
INSERT INTO notification_rules(days_before,active) VALUES(1,1);
CREATE TABLE notification_jobs (
 id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
 oapp_id VARCHAR(64) CHARACTER SET ascii NOT NULL, schedule_version INT NOT NULL,
 kind ENUM('NEW','REMINDER','MANUAL','CANCELLED') NOT NULL, dedupe_key VARCHAR(64) CHARACTER SET ascii NOT NULL DEFAULT '',
 rule_id BIGINT UNSIGNED NULL, requested_by BIGINT UNSIGNED NULL,
 status ENUM('PENDING','SENDING','ACCEPTED','FAILED','UNKNOWN','CANCELLED','BLOCKED','DRY_RUN') NOT NULL DEFAULT 'PENDING',
 scheduled_at DATETIME(6) NOT NULL, available_at DATETIME(6) NOT NULL,
 lease_until DATETIME(6) NULL, attempt_count INT NOT NULL DEFAULT 0, safe_error VARCHAR(500) NULL,
 accepted_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(oapp_id) REFERENCES appointments(oapp_id), FOREIGN KEY(rule_id) REFERENCES notification_rules(id),
 FOREIGN KEY(requested_by) REFERENCES users(id),
 UNIQUE KEY uq_notice(oapp_id,schedule_version,kind,dedupe_key), INDEX(status,available_at), INDEX(created_at)
) ENGINE=InnoDB;
CREATE TABLE notification_attempts (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, job_id CHAR(36) CHARACTER SET ascii NOT NULL,
 attempt_no INT NOT NULL, outcome VARCHAR(20) NOT NULL, http_status INT NULL, provider_code VARCHAR(40) NULL,
 safe_error VARCHAR(500) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(job_id) REFERENCES notification_jobs(id), UNIQUE(job_id,attempt_no)
) ENGINE=InnoDB
