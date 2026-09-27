# Security logging, retention and alerts

How TalentSnaps meets the CERT-In Directions 2022 logging requirements and the DPDP Rules 2025
log-retention requirement. Covers:
- what the app logs
- where logs are kept
- how alerts work
- exporting MongoDB Atlas logs
- time synchronisation
- what to do when an alert fires

## 1. What the app logs

Both services write one JSON object per line to stdout, and Cloud Run ships each line to Cloud Logging:
- Timestamps are ISO-8601 UTC.
- `severity` is set so Cloud Logging's severity filters work.
- Every request gets an `X-Request-Id`, and every line for that request carries it.

**Request log.** One line per request (`middlewares/requestLogger.js`) with:
- method and path (never the query string)
- status and latency
- user ID and role
- client IP

**Security events.** These are lines with `logType="security"` (`utils/securityLog.js`). Each carries:
- `event`
- `actorId` and `actorRole`
- `ip`, `requestId` and `userAgent`
- the fields listed below

| Event | When | Extra fields |
|---|---|---|
| `auth.login_succeeded` | Password or Google sign-in | `method` |
| `auth.login_failed` ⚠ | Wrong password, unknown email, deactivated account | `reason`, `targetUserId`, `emailHash` |
| `auth.rate_limited` ⚠ | Auth limiter returned 429 | `limiter`, `path` |
| `request.rate_limited` | Global or kiosk-lookup limiter returned 429 | `limiter`, `path` |
| `auth.registered` | Self-registration | `role`, `status` |
| `auth.refresh_failed` | Invalid, expired or revoked refresh token | `reason` |
| `auth.password_reset_requested` / `_completed` | Forgot-password flow | `accountExists` |
| `auth.password_changed` | Any password change, including one set by an admin | `setByAdmin`, `sessionsRevoked` |
| `auth.email_verified`, `auth.sign_in_method_linked` / `_unlinked` | Account changes | `provider` |
| `access.denied` | Any 403, from route role checks or service ownership checks | `method`, `path`, `reason` |
| `user.created` | Admin-created account (⚠ if the role is super_admin or institution_admin) | `targetUserId`, `role` |
| `user.role_changed` ⚠ | Role or institution changed | `oldValue`, `newValue`, `field` |
| `user.status_changed` | `is_active`, `status` (approve or reject) or `is_email_verified` changed | `field`, `oldValue`, `newValue` |
| `user.deleted`, `record.deleted` | Deletions | `targetUserId` / `entity`, `targetId` |
| `document.access_granted` | Signed link issued for an offer letter | `targetId`, `studentId` |
| `admin.action` | Any POST, PUT, PATCH or DELETE by super_admin, institution_admin, hr or faculty | `route` (ids replaced by `:id`), `targetIds`, `statusCode`, `outcome` |

⚠ = feeds an alert (the `alert` field is `failed_login` or `privilege_change`).

**Never logged.** `utils/logRedaction.js` runs inside the logger, so this holds even if a caller
passes something it shouldn't:
- **Dropped entirely:** passwords, tokens, secrets, cookies, API keys, and Authorization headers.
  This applies to any key matching those names, at any depth.
- **Removed from free text:** JWTs, `Bearer` values, and signed-link parameters (`token=`, `sig=`,
  `X-Goog-Signature=`).
- **Masked:** emails become `j***@example.com`. Phone numbers, names, roll numbers, addresses and
  dates of birth become `9***0`.
- **Pseudonymised:** failed-login events record `emailHash`, a keyed hash. It shows that repeated
  attempts targeted the same account without storing the address.

**Known limitation.** Cloud Run's own request log (`run.googleapis.com/requests`) records full URLs,
query strings included. Links signed for offer letters and profile photos therefore appear there.
They expire after 2 and 15 minutes respectively. The app can't change what Cloud Run records.

## 2. Log bucket in India, 365-day retention

Use **Terraform** (`deploy/terraform/logging/`) or the **console steps** below. Either way you end
up with:
- a log bucket `talentsnaps-logs-in` in `asia-south1` with 365-day retention
- a sink copying Cloud Run and Cloud Audit logs into it
- three alerts

The `_Default` bucket keeps its normal 30-day copy. Nothing existing is changed or deleted.

**Cost:** ingestion is free up to 50 GiB per project per month. Storage beyond 30 days is about
US$0.01 per GiB per month. At current traffic this should be close to nothing.

### Option A: Terraform

```bash
cd deploy/terraform/logging
cp terraform.tfvars.example terraform.tfvars   # set project_id and alert_email
gcloud auth application-default login
terraform init
terraform plan    # review: it should only CREATE resources
terraform apply
```

Your account needs **Logging Admin** and **Monitoring Admin** (Owner covers both). After applying,
open the alert email Google sends to confirm the notification channel.

### Option B: console

1. **Create the bucket.** Logging → Logs Storage → **Create log bucket**.
   - Name: `talentsnaps-logs-in`
   - Region: `asia-south1 (Mumbai)`. This can't be changed later.
   - Retention: `365` days. Leave "Upgrade to use Log Analytics" off.
   - Create.
2. **Route logs to it.** Logging → Log Router → **Create sink**.
   - Name: `talentsnaps-logs-to-india`
   - Destination: Cloud Logging bucket → `talentsnaps-logs-in`
   - Inclusion filter:
     ```
     resource.type="cloud_run_revision" OR resource.type="cloud_run_job" OR log_id("cloudaudit.googleapis.com/activity") OR log_id("cloudaudit.googleapis.com/system_event") OR log_id("cloudaudit.googleapis.com/policy") OR log_id("cloudaudit.googleapis.com/data_access")
     ```
   - Create.
3. **Add the notification channel.** Monitoring → Alerting → Edit notification channels → Email →
   Add new. Use `admin@talentsnaps.com`.
4. **Create the failed-login metric.** Logging → Log-based Metrics → Create metric.
   - Type: Counter
   - Name: `security/failed_logins`
   - Filter:
     `resource.type="cloud_run_revision" AND jsonPayload.logType="security" AND jsonPayload.alert="failed_login"`
5. **Create the failed-login alert.** On that metric, click ⋮ → **Create alert from metric**.
   - Rolling window: 5 min
   - Function: sum
   - Threshold: above 10
   - Notify the email channel.
6. **Create the privilege-change alert.** Logs Explorer → run
   `jsonPayload.logType="security" AND jsonPayload.alert="privilege_change"` → **Create alert**.
   - Time between notifications: 5 min
   - Notify the email channel.
7. **Create the IAM-change alert.** Logs Explorer → run the query below → **Create alert**, with the
   same settings as step 6.
   ```
   log_id("cloudaudit.googleapis.com/activity") AND (protoPayload.methodName:"SetIamPolicy" OR protoPayload.methodName="storage.setIamPermissions" OR protoPayload.methodName:"CreateServiceAccountKey")
   ```

### Verify

1. **Confirm logs reach the bucket.** Logs Explorer → Refine scope → Log bucket →
   `talentsnaps-logs-in`, then run `jsonPayload.logType="security"`. Sign in once to the app with a
   wrong password; an `auth.login_failed` line should appear within a minute.
2. **Confirm the location.** Logging → Logs Storage should show the bucket in `asia-south1` with
   365 days retention.
3. **Test the failed-login alert.** Make 11 failed sign-ins within 5 minutes and confirm the email
   arrives. Use a test account.

### Locking retention (optional, irreversible)

A locked bucket's retention can never be shortened, and the bucket can never be deleted, even by an
Owner. That is strong evidence for an auditor. It also means a misconfigured bucket is permanent.
Lock it only after a month of confirmed operation: `lock_retention = true` in Terraform, or Logs
Storage → bucket → Edit → Lock.

## 3. MongoDB Atlas logs

What's possible depends on the cluster tier (**not yet confirmed; please check**):

| Tier | Database logs | Database audit log | Project activity feed |
|---|---|---|---|
| M0 free / Flex | ❌ not downloadable | ❌ | ✅ |
| M10 and above | ✅ `mongodb.gz`, kept by Atlas about 30 days | ✅ when Database Auditing is on | ✅ |

Atlas can't push logs to Google Cloud directly; its built-in log export targets AWS S3 only. The
approach is a scheduled job that pulls logs with the Atlas CLI and stores them in a GCS bucket in
Mumbai with a 365-day retention policy.

1. **Turn on auditing (M10+ only).** Atlas → Project → Security → Advanced → **Database Auditing**:
   On. Audit authentication failures and user/role management at minimum.
2. **Create the archive bucket in Mumbai with a retention policy.** Replace `<PROJECT>`:
   ```bash
   gcloud storage buckets create gs://<PROJECT>-atlas-logs-in \
     --location=asia-south1 --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://<PROJECT>-atlas-logs-in --retention-period=365d
   ```
3. **Create an Atlas API key.** Atlas → Project → Access Manager → Applications → API Keys →
   Create.
   - Role: **Project Data Access Read Only**. Log download needs it.
   - Store the public and private halves in Secret Manager as `atlas-api-public-key` and
     `atlas-api-private-key`.
4. **Create a Cloud Run Job.** Use any image with the Atlas CLI and `gcloud` installed. Run this
   script with env vars `ATLAS_PROJECT_ID` and `BUCKET`, and the two secrets mapped to
   `MONGODB_ATLAS_PUBLIC_API_KEY` and `MONGODB_ATLAS_PRIVATE_API_KEY`.
   ```bash
   #!/usr/bin/env bash
   # Pull the last 7 hours of Atlas logs (runs every 6h, so windows overlap) into GCS.
   set -euo pipefail
   END=$(date -u +%s); START=$((END - 7 * 3600)); DAY=$(date -u +%Y/%m/%d)
   for HOST in $(atlas processes list --projectId "$ATLAS_PROJECT_ID" -o json | jq -r '.results[].hostname'); do
     for LOG in mongodb.gz mongodb-audit-log.gz; do
       if atlas logs download "$HOST" "$LOG" --projectId "$ATLAS_PROJECT_ID" \
            --start "$START" --end "$END" --out "/tmp/$LOG" --force; then
         gcloud storage cp "/tmp/$LOG" "gs://$BUCKET/$DAY/$HOST/$END-$LOG"
       fi
     done
   done
   # Project activity feed (all tiers): logins to Atlas, user and network-access changes.
   atlas events projects list --projectId "$ATLAS_PROJECT_ID" -o json > /tmp/events.json
   gcloud storage cp /tmp/events.json "gs://$BUCKET/$DAY/events-$END.json"
   ```
   Check `atlas logs download --help` for your CLI version; flag names have changed between
   releases. The job's service account needs **Storage Object Creator** on the bucket and
   **Secret Manager Secret Accessor** on the two secrets.
5. **Schedule it.** Cloud Scheduler → Create job → every 6 hours (`0 */6 * * *`, timezone
   Asia/Kolkata) → target: the Cloud Run Job.
6. **Check the Atlas API access list.** If the organisation requires an IP access list for API
   keys, the job needs a fixed egress IP: Cloud Run with a VPC connector and Cloud NAT. Otherwise,
   leave the key without an access list and rely on the narrow read-only role.

On M0 or Flex, run only the `atlas events` part. Upgrading to M10 is also what Phase 9's backups
need.

## 4. Time synchronisation (NTP)

CERT-In asks that system clocks sync to NIC or NPL NTP servers, or to sources traceable to them.

| System | Time source | Can we change it? |
|---|---|---|
| Cloud Run (`node-api`, `ai-service`) | Google's internal NTP (the same service as `time.google.com`), GPS- and atomic-clock-referenced UTC | No. Containers inherit the host clock, and there is nothing to configure. |
| MongoDB Atlas | The cloud provider's NTP, managed by MongoDB | No |
| Cloud Logging | Each entry has the app's `timestamp` plus Google's `receiveTimestamp` | No |
| Developer and admin laptops | Windows default is `time.windows.com` | **Yes, see below** |

**Application:** every timestamp the app writes is taken from the system clock in UTC: log lines,
MongoDB dates and token expiry. No local time zones are stored.

**Record this as your control:** "Production runs on managed Google Cloud and MongoDB Atlas
infrastructure whose clocks are synchronised by the provider to UTC; the provider's time service is
not configurable by customers. Staff machines synchronise to NPL India."

**Spot-check** once a quarter: the gap between `timestamp` and `receiveTimestamp` on recent log
entries should be well under a second.

**Staff Windows machines** (run as Administrator):

```powershell
w32tm /config /manualpeerlist:"time.nplindia.org samay1.nic.in" /syncfromflags:manual /reliable:no /update
Restart-Service w32time
w32tm /resync
w32tm /query /status   # "Source:" should show time.nplindia.org or samay1.nic.in
```

## 5. When an alert fires

**Repeated failed logins**
1. Logs Explorer: `jsonPayload.logType="security" AND jsonPayload.alert="failed_login"`, the last
   hour.
2. Many `emailHash` values from one `ip` means credential stuffing. One `emailHash` from many IPs
   means someone is targeting that account.
3. If an attack is ongoing, block the IP or range in Cloudflare (Security → WAF → Tools → IP Access
   Rules).
4. Look for an `auth.login_succeeded` for the targeted accounts right after the failures. **A
   success after many failures means a possible compromise.** Reset that account's password (this
   revokes its sessions) and follow step 5.
5. If there was unauthorised access to the system or data, the CERT-In **6-hour** reporting clock
   has started. Report to incident@cert-in.org.in. If personal data was affected, also notify
   affected colleges and users, and the Data Protection Board within 72 hours.

**Role or privilege changed**
1. Read the `actor`, `target` and `event` labels in the alert.
2. If you or another admin made the change on purpose, close the alert.
3. If not: deactivate the actor's account, revert the change, and look through that actor's recent
   `admin.action` events for anything else. Then follow step 5 above.

**GCP IAM permission changed**
1. Check the `principal` and `method` labels.
2. If it wasn't you, go to IAM & Admin → IAM, remove the new grant or delete the new service account
   key, rotate your password and MFA, and follow step 5 above.
