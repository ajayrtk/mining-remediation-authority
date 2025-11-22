# Changelog

## 2025-11-14 - Performance Optimization & UX Improvements

### Added
- **Frontend Auto-Refresh** - Real-time data updates without manual refresh
  - Auto-refresh for Recent Job Activity (10-second interval)
  - Auto-refresh for Job Pipeline Overview statistics
  - Auto-refresh for All Maps table view
  - Automatic start/stop based on user authentication
  - Proper cleanup on component unmount

### Changed
- **ECS Processor Resources Upgraded** - Improved processing performance
  - CPU: 4 vCPU → 8 vCPU (2x increase)
  - Memory: 8 GB → 16 GB (2x increase)
  - Expected processing time reduction: 30-50%
  - Better handling of ML models (EasyOCR) and image processing (OpenCV)

### Removed
- **Redundant .gitignore Files** - Simplified project structure
  - Removed `/deployment-package/infra/.gitignore` (16 lines, redundant)
  - Removed `/deployment-package/frontend/.gitignore` (24 lines, redundant)
  - Consolidated to single root `.gitignore` (229 lines, comprehensive)

### Files Modified
- `deployment-package/infra/ecs.tf` - Updated task definition resources (lines 153-154)
- `deployment-package/frontend/src/routes/+page.svelte` - Added auto-refresh to job activity
- `deployment-package/frontend/src/routes/maps/+page.svelte` - Added auto-refresh to maps table
- Removed redundant .gitignore files

### Performance Metrics
**Processing Time Analysis (Pre-Upgrade):**
- File: 16287_453465.zip
- Total time: 12 min 38 sec
- Processing stage: 9 min 31 sec (75% of total)
- Queue wait: 3 min 7 sec

**Expected Performance (Post-Upgrade):**
- Processing stage: ~5-7 minutes (estimated)
- Total time: ~8-10 minutes (estimated)

---

## 2025-11-06 - Infrastructure Hardening & Fixes

### Added
- **Existing IAM Roles Support** - Skip IAM role creation if they already exist
  - New variables: `use_existing_iam_roles`, `existing_iam_role_names`
  - Data sources for existing roles (`iam_data.tf`)
  - Conditional role creation across all modules

- **Production Readiness Assessment** - Comprehensive guide for production deployment
  - Security checklist
  - High availability recommendations
  - Cost estimates

- **Enhanced Documentation**
  - README.md - Main deployment guide
  - PRODUCTION_READINESS_ASSESSMENT.md - Production guide
  - IAM_ROLES_USAGE.md - IAM configuration guide
  - TROUBLESHOOTING.md - Common issues and fixes

### Fixed
- **IAM Role Conflicts** - Resolved "EntityAlreadyExists" errors
- **Deployment Script Paths** - Fixed `build_and_push.sh` location issues
- **ECR Authentication** - Enhanced region detection (eu-west-1 vs eu-west-2)
- **S3 Region Mismatch** - Corrected region configuration
- **Script Error Handling** - Added `|| true` to optional terraform outputs
- **Cognito Configuration** - Updated callback URLs and region settings

### Changed
- Region configuration: eu-west-2 → eu-west-1
- All IAM roles now conditional (count-based)
- Deployment scripts with improved error handling
- Terraform outputs include aws_region

### Configuration
```hcl
# terraform.tfvars (active)
aws_region = "eu-west-1"
use_existing_iam_roles = true
# All 9 IAM roles configured to use existing
```

### Files Modified
- `variables.tf` - Added IAM role variables
- `iam.tf`, `ecs.tf`, `frontend_ecs_simple.tf`, `lambda_pre_auth.tf` - Conditional roles
- `lambda.tf` - Conditional Lambda functions
- `cognito.tf` - Conditional Lambda triggers
- `outputs.tf` - Added aws_region output
- `s3.tf` - Conditional S3 notifications
- `../scripts/deploy.sh` - Fixed directory navigation
- `../frontend/build_and_push.sh` - Enhanced region detection

### Infrastructure Status
- ✅ Terraform state validated
- ✅ All deployment blocking issues resolved
- ⚠️  Development/Staging grade (see PRODUCTION_READINESS_ASSESSMENT.md)

---

## Migration Notes

**From Previous Setup:**
1. Update `terraform.tfvars` with region and IAM role settings
2. Run `terraform plan` to verify changes
3. Run `terraform apply` to update infrastructure
4. Redeploy frontend: `cd frontend && ./build_and_push.sh`

**Breaking Changes:**
- None - All changes are backward compatible with `use_existing_iam_roles = false`

---

For detailed technical changes, see git commit history.
For troubleshooting, see TROUBLESHOOTING.md.
For production deployment, see PRODUCTION_READINESS_ASSESSMENT.md.
