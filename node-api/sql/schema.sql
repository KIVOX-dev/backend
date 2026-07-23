-- ============================================================================
-- Skillovate Node/Express Backend — PostgreSQL Schema
-- Target: Google Cloud SQL for PostgreSQL 15+
-- Run once against a fresh database: psql -f sql/schema.sql "$DATABASE_URL"
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('super_admin', 'institution_admin', 'hr', 'faculty', 'student');
CREATE TYPE placement_status AS ENUM ('draft', 'open', 'closed', 'cancelled');
CREATE TYPE application_status AS ENUM ('applied', 'shortlisted', 'interview', 'selected', 'rejected', 'withdrawn');
CREATE TYPE test_type AS ENUM ('mcq', 'coding', 'mixed');
CREATE TYPE assignment_status AS ENUM ('assigned', 'in_progress', 'completed', 'expired');
CREATE TYPE notification_type AS ENUM ('info', 'success', 'warning', 'error');

-- ----------------------------------------------------------------------------
-- INSTITUTIONS
-- ----------------------------------------------------------------------------
CREATE TABLE institutions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    code            VARCHAR(50) NOT NULL UNIQUE,
    address         TEXT,
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(30),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_institutions_is_active ON institutions (is_active);

-- ----------------------------------------------------------------------------
-- USERS (central identity table for every role)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255),                 -- NULL when the account is Google-OAuth-only
    google_id       VARCHAR(255) UNIQUE,
    full_name       VARCHAR(255) NOT NULL,
    phone           VARCHAR(30),
    role            user_role NOT NULL,
    institution_id  UUID REFERENCES institutions (id) ON DELETE SET NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_auth_method CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_institution_id ON users (institution_id);
CREATE INDEX idx_users_email ON users (email);

-- ----------------------------------------------------------------------------
-- DEPARTMENTS (belong to an institution)
-- ----------------------------------------------------------------------------
CREATE TABLE departments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  UUID NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    code            VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, code)
);
CREATE INDEX idx_departments_institution_id ON departments (institution_id);

-- ----------------------------------------------------------------------------
-- ROLE PROFILE TABLES (1:1 extension of users)
-- ----------------------------------------------------------------------------
CREATE TABLE college_admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    institution_id  UUID NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    designation     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_college_admins_institution_id ON college_admins (institution_id);

CREATE TABLE companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    website         VARCHAR(255),
    industry        VARCHAR(120),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(30),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_companies_is_active ON companies (is_active);

CREATE TABLE hr (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    designation     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_hr_company_id ON hr (company_id);

CREATE TABLE faculty (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    institution_id  UUID NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    department_id   UUID REFERENCES departments (id) ON DELETE SET NULL,
    designation     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_faculty_institution_id ON faculty (institution_id);
CREATE INDEX idx_faculty_department_id ON faculty (department_id);

CREATE TABLE students (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    institution_id  UUID NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    department_id   UUID REFERENCES departments (id) ON DELETE SET NULL,
    roll_number     VARCHAR(50) NOT NULL,
    batch_year      SMALLINT NOT NULL,
    cgpa            NUMERIC(4, 2) CHECK (cgpa >= 0 AND cgpa <= 10),
    resume_url      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (institution_id, roll_number)
);
CREATE INDEX idx_students_institution_id ON students (institution_id);
CREATE INDEX idx_students_department_id ON students (department_id);
CREATE INDEX idx_students_batch_year ON students (batch_year);

-- ----------------------------------------------------------------------------
-- PLACEMENTS (drives posted by a company at an institution)
-- ----------------------------------------------------------------------------
CREATE TABLE placements (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id            UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    institution_id        UUID NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    created_by            UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    title                 VARCHAR(255) NOT NULL,
    description           TEXT,
    job_type              VARCHAR(50) NOT NULL DEFAULT 'full_time',
    package_lpa           NUMERIC(6, 2),
    eligibility_criteria  JSONB NOT NULL DEFAULT '{}',
    application_deadline  TIMESTAMPTZ,
    drive_date            TIMESTAMPTZ,
    status                placement_status NOT NULL DEFAULT 'draft',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_placements_institution_id ON placements (institution_id);
CREATE INDEX idx_placements_company_id ON placements (company_id);
CREATE INDEX idx_placements_status ON placements (status);

CREATE TABLE placement_applications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    placement_id    UUID NOT NULL REFERENCES placements (id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    status          application_status NOT NULL DEFAULT 'applied',
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (placement_id, student_id)
);
CREATE INDEX idx_placement_applications_student_id ON placement_applications (student_id);
CREATE INDEX idx_placement_applications_placement_id ON placement_applications (placement_id);
CREATE INDEX idx_placement_applications_status ON placement_applications (status);

-- ----------------------------------------------------------------------------
-- TESTS / ASSESSMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE tests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id    UUID NOT NULL REFERENCES institutions (id) ON DELETE CASCADE,
    created_by        UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    title             VARCHAR(255) NOT NULL,
    description       TEXT,
    test_type         test_type NOT NULL DEFAULT 'mcq',
    duration_minutes  INTEGER NOT NULL CHECK (duration_minutes > 0),
    total_marks       INTEGER NOT NULL CHECK (total_marks > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tests_institution_id ON tests (institution_id);

CREATE TABLE test_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         UUID NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    assigned_by     UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    scheduled_at    TIMESTAMPTZ,
    status          assignment_status NOT NULL DEFAULT 'assigned',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (test_id, student_id)
);
CREATE INDEX idx_test_assignments_student_id ON test_assignments (student_id);
CREATE INDEX idx_test_assignments_status ON test_assignments (status);

CREATE TABLE results (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_assignment_id    UUID NOT NULL UNIQUE REFERENCES test_assignments (id) ON DELETE CASCADE,
    student_id            UUID NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    test_id               UUID NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
    marks_obtained        NUMERIC(6, 2) NOT NULL CHECK (marks_obtained >= 0),
    total_marks           NUMERIC(6, 2) NOT NULL CHECK (total_marks > 0),
    percentage            NUMERIC(5, 2) GENERATED ALWAYS AS (ROUND((marks_obtained / total_marks) * 100, 2)) STORED,
    submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_results_student_id ON results (student_id);
CREATE INDEX idx_results_test_id ON results (test_id);

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    message     TEXT NOT NULL,
    type        notification_type NOT NULL DEFAULT 'info',
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_id_is_read ON notifications (user_id, is_read);

-- ----------------------------------------------------------------------------
-- RESUME BUILDER (one editable resume document per student)
-- ----------------------------------------------------------------------------
CREATE TABLE resume_builder (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      UUID NOT NULL UNIQUE REFERENCES students (id) ON DELETE CASCADE,
    template        VARCHAR(50) NOT NULL DEFAULT 'default',
    data            JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- ACTIVITY LOGS (audit trail)
-- ----------------------------------------------------------------------------
CREATE TABLE activity_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES users (id) ON DELETE SET NULL,
    action       VARCHAR(120) NOT NULL,
    entity_type  VARCHAR(120),
    entity_id    UUID,
    metadata     JSONB NOT NULL DEFAULT '{}',
    ip_address   VARCHAR(64),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activity_logs_user_id ON activity_logs (user_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs (created_at);

-- ----------------------------------------------------------------------------
-- AUTO-UPDATE updated_at ON EVERY ROW UPDATE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at' AND table_schema = 'public'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl
        );
    END LOOP;
END;
$$;

COMMIT;
