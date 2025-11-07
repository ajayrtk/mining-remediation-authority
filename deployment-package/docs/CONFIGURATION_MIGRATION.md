# Configuration Migration Notice

**Date:** 2025-11-07
**Status:** ⚠️ Configuration files updated

---

## What Changed

The project configuration system has been updated:

### ❌ OLD (Removed):
```
deployment-package/
├── client-config.tfvars         ← REMOVED
└── client-config.tfvars.example ← REMOVED
```

### ✅ NEW (Current):
```
deployment-package/infra/
├── terraform.tfvars         ← USE THIS
└── terraform.tfvars.example ← Template
```

---

## Why This Changed

1. **Standard Terraform Convention**: Terraform automatically loads `terraform.tfvars` from the working directory
2. **Simplified Deployment**: No need for `-var-file` flag in commands
3. **Better Organization**: Configuration lives with infrastructure code
4. **IAM Role Support**: New configuration includes `use_existing_iam_roles` feature

---

## Migration Guide

### If You Have Old Scripts

**Old Command:**
```bash
terraform apply -var-file=../client-config.tfvars
```

**New Command:**
```bash
cd infra
terraform apply   # Automatically uses terraform.tfvars
```

### Configuration File Location

**Old:** `deployment-package/client-config.tfvars`
**New:** `deployment-package/infra/terraform.tfvars`

---

## Current Configuration Format

### Required Settings

```hcl
# infra/terraform.tfvars

# AWS Region
aws_region = "eu-west-1"

# IAM Roles (recommended to avoid conflicts)
use_existing_iam_roles = true

existing_iam_role_names = {
  input_handler           = "mra-mines-input-handler"
  mock_ecs               = "mra-mines-mock-ecs"
  output_handler         = "mra-mines-output-handler"
  s3_copy_processor      = "mra-mines-s3-copy-processor"
  ecs_task_execution     = "mra-mines-ecs-task-execution"
  ecs_task               = "mra-mines-ecs-task"
  frontend_task_execution = "mra-mines-dev-frontend-task-execution"
  frontend_task          = "mra-mines-dev-frontend-task"
  pre_auth_trigger       = "mra-mines-pre-auth-trigger-role"
}

# Cognito Callback URLs (update after getting CloudFront URL)
cognito_callback_urls = [
  "http://localhost:5173/auth/callback",
  "https://YOUR_CLOUDFRONT_URL/auth/callback"
]

cognito_logout_urls = [
  "http://localhost:5173/",
  "https://YOUR_CLOUDFRONT_URL/"
]
```

---

## Manual Deployment (Recommended)

**Instead of using the automated scripts**, deploy manually for better control:

### Step 1: Configure
```bash
cd deployment-package/infra
nano terraform.tfvars  # Edit configuration
```

### Step 2: Deploy Infrastructure
```bash
terraform init
terraform plan
terraform apply
```

### Step 3: Deploy Frontend
```bash
cd ../frontend
./build_and_push.sh
```

### Step 4: Create Users
```bash
cd ../infra
POOL_ID=$(terraform output -raw cognito_user_pool_id)

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username admin@your-company.com \
  --user-attributes Name=email,Value=admin@your-company.com

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username admin@your-company.com \
  --password 'YourSecurePassword123!' \
  --permanent
```

---

## Automated Scripts Status

⚠️ **Note:** The automated scripts in `scripts/` directory still reference the old `client-config.tfvars` file and need to be updated or avoided.

**Scripts Affected:**
- `scripts/deploy.sh` - Automated deployment
- `scripts/setup.sh` - Prerequisites check
- `scripts/cleanup.sh` - Resource cleanup
- `scripts/import-existing-resources.sh` - Resource import

**Recommendation:** Use manual deployment steps above until scripts are updated.

---

## Documentation References

All documentation has been updated to reference the new configuration:

✅ **docs/deployment-guide.md** - Updated
✅ **docs/README.md** - Updated
✅ **README.md** - Updated
❌ **scripts/*.sh** - Not yet updated (use manual deployment)

---

## Quick Reference

### Configuration File
```bash
# Edit configuration
cd deployment-package/infra
nano terraform.tfvars
```

### Deploy
```bash
terraform init
terraform plan
terraform apply
```

### Get Outputs
```bash
terraform output
terraform output cloudfront_url
terraform output cognito_user_pool_id
```

---

## Support

For deployment help, see:
- **docs/deployment-guide.md** - Complete deployment guide
- **docs/troubleshooting.md** - Common issues
- **docs/iam-configuration.md** - IAM role setup

---

**Migration Date:** 2025-11-07
**Updated By:** System Update
**Status:** Configuration files migrated, scripts pending update
