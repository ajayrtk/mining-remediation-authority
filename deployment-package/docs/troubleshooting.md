# Deployment Troubleshooting Guide

## Quick Reference

This document provides solutions to common deployment issues encountered with the MRA Mines Map infrastructure.

## Issues Resolved in This Session

### ✅ Issue 1: IAM Role Already Exists
**Error Message:**
```
Error: creating IAM Role (mra-mines-ecs-task-execution): operation error IAM: CreateRole,
https response error StatusCode: 409, RequestID: ..., EntityAlreadyExists:
Role with name mra-mines-ecs-task-execution already exists.
```

**Root Cause:**
- IAM roles already exist in AWS account from previous deployment
- Terraform trying to create them again
- No mechanism to use existing roles

**Solution:**
1. Set `use_existing_iam_roles = true` in `terraform.tfvars`
2. Specify existing role names in `existing_iam_role_names` variable
3. Terraform will use data sources instead of creating new roles

**Files Modified:**
- `variables.tf` - Added new variables
- `iam_data.tf` - Created data sources for existing roles
- `iam.tf`, `ecs.tf`, `frontend_ecs_simple.tf`, `lambda_pre_auth.tf` - Made roles conditional
- `terraform.tfvars` - Configured to use existing roles

**Verification:**
```bash
cd infra
terraform plan | grep "data.aws_iam_role.existing"
# Should show data sources being read, not resources being created
```

---

### ✅ Issue 2: Build Script Not Found
**Error Message:**
```
./build_and_push.sh: No such file or directory
ERROR: Frontend deployment failed when executing deploy.sh script
```

**Root Cause:**
- `deploy.sh` changed directory to `infra` too early
- When it tried to run `./build_and_push.sh`, it looked in wrong directory
- `build_and_push.sh` is in `frontend` directory, not `infra`

**Solution:**
Changed directory navigation flow in `deploy.sh`:
```bash
# Before (incorrect):
cd frontend
npm ci && npm run build
cd ../infra
./build_and_push.sh  # ❌ Script not in infra directory

# After (correct):
cd frontend
npm ci && npm run build
./build_and_push.sh  # ✅ Script is in frontend directory
cd ../infra
```

**Files Modified:**
- `../scripts/deploy.sh` (lines 104-118)

---

### ✅ Issue 3: ECR Authentication Failed
**Error Message:**
```
no basic auth credentials
ERROR: Frontend deployment failed when executing deploy.sh script
```

**Root Cause:**
- Docker not authenticated with ECR
- Wrong AWS region used for authentication (eu-west-2 vs eu-west-1)
- Resources actually in eu-west-1, script defaulted to eu-west-2

**Solution:**
1. Enhanced region detection in `build_and_push.sh`:
   - Try terraform output first
   - Fall back to reading `terraform.tfvars`
   - Changed default from eu-west-2 to eu-west-1

2. Manual authentication (immediate fix):
```bash
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin \
  719259376075.dkr.ecr.eu-west-1.amazonaws.com
```

**Files Modified:**
- `../frontend/build_and_push.sh` (lines 18-27)
- Added `aws_region` output to `outputs.tf`
- Set `aws_region = "eu-west-1"` in `terraform.tfvars`

**Verification:**
```bash
# Check ECR repositories region
aws ecr describe-repositories --query 'repositories[?contains(repositoryName, `mra-mines`)].repositoryUri'

# Verify build script detects correct region
cd frontend
./build_and_push.sh
# Should show "Using AWS Region: eu-west-1"
```

---

### ✅ Issue 4: S3 Bucket Region Mismatch
**Error Message:**
```
Error: reading S3 Bucket Versioning (mra-mines-prod-map-input): operation error S3:
GetBucketVersioning, https response error StatusCode: 301, api error PermanentRedirect:
The bucket you are attempting to access must be addressed using the specified endpoint.
```

**Root Cause:**
- S3 buckets exist in eu-west-1
- Terraform configured for eu-west-2
- S3 requires region-specific endpoints

**Solution:**
Set correct region in `terraform.tfvars`:
```hcl
aws_region = "eu-west-1"
```

**Files Modified:**
- `terraform.tfvars`

**Verification:**
```bash
# Check bucket locations
aws s3api get-bucket-location --bucket mra-mines-prod-map-input
# Should return: eu-west-1
```

---

### ✅ Issue 5: Script Exits on Missing Terraform Output
**Error Message:**
```
ERROR: Frontend deployment failed when executing deploy.sh script
```
(After successful image push and ECS update)

**Root Cause:**
- Script has `set -e` (exit on any error)
- Command `terraform output -raw frontend_url` returns non-zero exit code when output doesn't exist
- Even though error redirected to `/dev/null`, exit code still causes script to fail
- This happened at the very end, making it appear deployment failed

**Solution:**
Added `|| true` to optional terraform output commands:
```bash
# Before:
FRONTEND_URL=$(terraform output -raw frontend_url 2>/dev/null)

# After:
FRONTEND_URL=$(terraform output -raw frontend_url 2>/dev/null || true)
```

**Files Modified:**
- `../frontend/build_and_push.sh` (line 73)
- Added final success message (line 78)

**Note:** The deployment was actually successful! The error was just the script's exit code.

---

## Deployment Checklist

Use this checklist to ensure smooth deployment:

### Pre-Deployment
- [ ] Verify AWS credentials are configured
- [ ] Check AWS region matches resource locations
- [ ] Confirm IAM roles exist (if using existing roles)
- [ ] Ensure Docker is running
- [ ] Review `terraform.tfvars` configuration

### During Deployment
- [ ] Run `terraform validate` first
- [ ] Review `terraform plan` output
- [ ] Check for IAM role conflicts
- [ ] Verify ECR authentication succeeds
- [ ] Monitor Docker image build progress

### Post-Deployment
- [ ] Verify ECS service is running
- [ ] Check CloudWatch logs for errors
- [ ] Test frontend URL (if available)
- [ ] Confirm database connectivity

---

## Quick Fixes

### Manually Authenticate with ECR
```bash
# Replace <region> and <account-id> with your values
aws ecr get-login-password --region <region> | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.<region>.amazonaws.com
```

### Force ECS Service Update
```bash
aws ecs update-service \
  --cluster mra-mines-dev-cluster \
  --service mra-mines-dev-frontend \
  --force-new-deployment \
  --region eu-west-1
```

### Check ECS Service Status
```bash
aws ecs describe-services \
  --cluster mra-mines-dev-cluster \
  --services mra-mines-dev-frontend \
  --region eu-west-1 \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Events:events[0:3]}'
```

### View ECS Task Logs
```bash
# Get task ID
TASK_ID=$(aws ecs list-tasks \
  --cluster mra-mines-dev-cluster \
  --service-name mra-mines-dev-frontend \
  --region eu-west-1 \
  --query 'taskArns[0]' \
  --output text | cut -d'/' -f3)

# View logs
aws logs tail "/ecs/mra-mines-dev-frontend" \
  --follow \
  --region eu-west-1
```

### Check Terraform State
```bash
cd infra
terraform state list | grep iam_role
terraform state show aws_iam_role.ecs_task_execution[0]
```

---

## Environment-Specific Configuration

### Development Environment
```hcl
# terraform.tfvars
aws_region = "eu-west-1"
environment = "dev"
use_existing_iam_roles = true
```

### Production Environment
```hcl
# terraform.tfvars
aws_region = "eu-west-1"
environment = "prod"
use_existing_iam_roles = true
```

---

## Common Questions

### Q: Why does deployment show error but resources are created?
A: The actual deployment succeeded. The error is from the script's exit code on optional commands. This has been fixed by adding `|| true` to optional operations.

### Q: Can I use different IAM roles per environment?
A: Yes! Use different role names in `existing_iam_role_names` for each environment, or set `use_existing_iam_roles = false` to create environment-specific roles.

### Q: What if I want to create new IAM roles?
A: Set `use_existing_iam_roles = false` in `terraform.tfvars`, or remove the variable entirely (defaults to false).

### Q: How do I switch from using existing roles to creating new ones?
A:
1. Change `use_existing_iam_roles = false`
2. Change `project_name` variable to avoid name conflicts
3. Run `terraform plan` to review changes
4. Run `terraform apply`

---

## Support

For additional help:
1. Check CloudWatch Logs for detailed error messages
2. Review [Changelog](changelog.md) for recent changes
3. See [IAM Configuration](iam-configuration.md) for IAM role configuration details
4. Check AWS service status: https://status.aws.amazon.com/

---

## Summary of All Fixes

| Issue | Status | Files Modified | Impact |
|-------|--------|----------------|---------|
| IAM roles already exist | ✅ Fixed | `variables.tf`, `iam_data.tf`, `terraform.tfvars` | Critical |
| Build script not found | ✅ Fixed | `../scripts/deploy.sh` | Critical |
| ECR auth failed | ✅ Fixed | `../frontend/build_and_push.sh`, `terraform.tfvars` | Critical |
| S3 region mismatch | ✅ Fixed | `terraform.tfvars` | High |
| Script exit on optional output | ✅ Fixed | `../frontend/build_and_push.sh` | Medium |

All deployment blocking issues have been resolved. Deployment workflow is now fully functional.
