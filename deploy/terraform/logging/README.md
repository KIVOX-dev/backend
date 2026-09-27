# Logging and alerts (Terraform)

This module creates a 365-day Cloud Logging bucket in `asia-south1`, a sink that routes Cloud Run
and Cloud Audit logs into it, and three alerts:
- repeated failed logins
- app role or privilege changes
- GCP IAM changes

It only creates resources and never modifies or deletes existing ones.

Full instructions, the console-only alternative, Atlas log export, time sync and the alert runbook
are in [../../SECURITY-LOGGING.md](../../SECURITY-LOGGING.md).

```bash
cp terraform.tfvars.example terraform.tfvars   # set project_id and alert_email
terraform init && terraform plan && terraform apply
```

Commit `.terraform.lock.hcl` after the first `init`. `terraform.tfvars` and state files are
gitignored.
