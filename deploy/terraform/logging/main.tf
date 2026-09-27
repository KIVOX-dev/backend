# CERT-In log retention and security alerting for TalentSnaps.
#
# Creates:
#   1. A Cloud Logging bucket in asia-south1 (Mumbai) keeping logs for 365 days
#      (CERT-In requires 180 days in India; DPDP Rules require 1 year).
#   2. A sink copying app, Cloud Run, and Cloud Audit logs into it.
#   3. Alerts: repeated failed logins, any role/privilege change in the app,
#      and any IAM permission change in the GCP project.
#
# Nothing here deletes or modifies existing logs or buckets. The _Default
# bucket keeps receiving its usual 30-day copy. See README.md before applying.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0, < 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ---- 1. Log bucket in India ------------------------------------------------

resource "google_logging_project_bucket_config" "india" {
  project        = var.project_id
  location       = var.region
  bucket_id      = var.log_bucket_id
  retention_days = var.retention_days
  description    = "TalentSnaps security and application logs, kept in India for ${var.retention_days} days (CERT-In / DPDP)."

  # Locking makes retention impossible to shorten or the bucket impossible to
  # delete — ever, even by you. Leave false until you've confirmed everything
  # works, then decide deliberately (see README.md).
  locked = var.lock_retention
}

# ---- 2. Route logs into it --------------------------------------------------

locals {
  sink_filter = join(" OR ", [
    "resource.type=\"cloud_run_revision\"",
    "resource.type=\"cloud_run_job\"",
    "log_id(\"cloudaudit.googleapis.com/activity\")",
    "log_id(\"cloudaudit.googleapis.com/system_event\")",
    "log_id(\"cloudaudit.googleapis.com/policy\")",
    "log_id(\"cloudaudit.googleapis.com/data_access\")",
  ])
}

resource "google_logging_project_sink" "india" {
  name        = "talentsnaps-logs-to-india"
  project     = var.project_id
  destination = "logging.googleapis.com/${google_logging_project_bucket_config.india.id}"
  filter      = local.sink_filter
  description = "Copies Cloud Run and Cloud Audit logs into the ${var.region} log bucket."

  unique_writer_identity = true
}

# ---- 3. Alerts ---------------------------------------------------------------

resource "google_monitoring_notification_channel" "security_email" {
  display_name = "TalentSnaps security alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

# Every auth.login_failed and auth.rate_limited event carries
# alert="failed_login" (node-api/src/utils/securityLog.js).
resource "google_logging_metric" "failed_logins" {
  name        = "security/failed_logins"
  description = "Failed sign-in attempts and auth rate-limit hits in node-api."
  filter      = "resource.type=\"cloud_run_revision\" AND jsonPayload.logType=\"security\" AND jsonPayload.alert=\"failed_login\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "failed_logins" {
  display_name = "TalentSnaps: repeated failed logins"
  combiner     = "OR"

  conditions {
    display_name = "More than ${var.failed_login_threshold} failed logins in 5 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.failed_logins.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.failed_login_threshold
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.security_email.id]

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      Possible password guessing or credential stuffing against TalentSnaps.
      In Logs Explorer, run:
      `jsonPayload.logType="security" AND jsonPayload.alert="failed_login"`
      Group by `jsonPayload.ip` and `jsonPayload.emailHash` to see whether one
      source is hitting many accounts, or many sources one account.
      Runbook: deploy/SECURITY-LOGGING.md, "When an alert fires".
    EOT
  }
}

# Fires on every user.role_changed (role or institution moved) and on the
# creation of a super_admin/institution_admin account.
resource "google_monitoring_alert_policy" "privilege_change" {
  display_name = "TalentSnaps: user role or privilege changed"
  combiner     = "OR"

  conditions {
    display_name = "Privilege change in node-api"
    condition_matched_log {
      filter = "jsonPayload.logType=\"security\" AND jsonPayload.alert=\"privilege_change\""
      label_extractors = {
        event  = "EXTRACT(jsonPayload.event)"
        actor  = "EXTRACT(jsonPayload.actorId)"
        target = "EXTRACT(jsonPayload.targetUserId)"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "1800s"
  }

  notification_channels = [google_monitoring_notification_channel.security_email.id]

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      A user's role, institution, or admin status changed in TalentSnaps.
      Confirm the actor (label `actor`) made this change on purpose. If not,
      treat it as a possible account compromise: runbook in
      deploy/SECURITY-LOGGING.md, "When an alert fires".
    EOT
  }
}

# Infrastructure-level permission changes: IAM policy edits on the project,
# buckets, or Cloud Run services, and new service-account keys.
resource "google_monitoring_alert_policy" "gcp_iam_change" {
  display_name = "TalentSnaps: GCP IAM permission changed"
  combiner     = "OR"

  conditions {
    display_name = "IAM policy or service account key change"
    condition_matched_log {
      filter = join(" AND ", [
        "log_id(\"cloudaudit.googleapis.com/activity\")",
        "(protoPayload.methodName:\"SetIamPolicy\" OR protoPayload.methodName=\"storage.setIamPermissions\" OR protoPayload.methodName:\"CreateServiceAccountKey\")",
      ])
      label_extractors = {
        method    = "EXTRACT(protoPayload.methodName)"
        principal = "EXTRACT(protoPayload.authenticationInfo.principalEmail)"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "1800s"
  }

  notification_channels = [google_monitoring_notification_channel.security_email.id]

  documentation {
    mime_type = "text/markdown"
    content   = "Someone changed IAM permissions or created a service account key in the TalentSnaps GCP project. Confirm the `principal` label is you and the change was intended."
  }
}
