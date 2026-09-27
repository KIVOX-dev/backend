output "log_bucket" {
  description = "Full resource name of the India log bucket (use as the scope in Logs Explorer)."
  value       = google_logging_project_bucket_config.india.id
}

output "sink_writer_identity" {
  description = "Service account the sink writes as."
  value       = google_logging_project_sink.india.writer_identity
}
