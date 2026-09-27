variable "project_id" {
  description = "GCP project that runs node-api and ai-service."
  type        = string
}

variable "region" {
  description = "Location for the log bucket. Must stay in India for CERT-In."
  type        = string
  default     = "asia-south1"
}

variable "log_bucket_id" {
  description = "Name of the Cloud Logging bucket to create."
  type        = string
  default     = "talentsnaps-logs-in"
}

variable "retention_days" {
  description = "How long logs are kept. CERT-In needs >= 180; DPDP Rules need >= 365."
  type        = number
  default     = 365

  validation {
    condition     = var.retention_days >= 365
    error_message = "Keep logs at least 365 days (DPDP Rules 2025; covers CERT-In's 180)."
  }
}

variable "lock_retention" {
  description = "Permanently lock the retention period. Irreversible: see README.md."
  type        = bool
  default     = false
}

variable "alert_email" {
  description = "Where security alerts are sent."
  type        = string
}

variable "failed_login_threshold" {
  description = "Alert when failed logins across the app exceed this many in 5 minutes."
  type        = number
  default     = 10
}
