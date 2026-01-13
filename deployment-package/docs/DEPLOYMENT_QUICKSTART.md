# MRA Mines Map - Deployment Quick Start

## 🚀 One-Command Deployment

Deploy the entire application with a single command - no need to configure AWS CLI separately!

---

## Prerequisites

Install these tools before deploying:
- ✅ **AWS CLI v2.0+**
- ✅ **Terraform v1.6.0+**
- ✅ **Docker v20.0+** (running)
- ✅ **Node.js v20.0+** and **npm v9.0+**

**Verify**:
```bash
cd deployment-package
./scripts/setup.sh
```

---

## 📝 Configuration (2 Files Only!)

### Step 1: Configure Environment (.env)

```bash
cd deployment-package
cp .env.example .env
nano .env
```

**Edit `.env` with your settings:**

```bash
# ==================================================
# AWS CREDENTIALS (Get from AWS IAM Console)
# ==================================================
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=eu-west-2

# ==================================================
# PROCESSOR REPOSITORY PATH
# ==================================================
PROCESSOR_REPO_PATH=/home/username/mra-mine-plans-ds
```

**How to get AWS credentials:**
1. Go to https://console.aws.amazon.com/iam/
2. Create a new user (or use existing)
3. Attach policy: **AdministratorAccess** (or custom policy)
4. Create access keys (Security Credentials tab)
5. Copy Access Key ID and Secret Access Key

### Step 2: Configure Infrastructure (terraform.tfvars)

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
```

**Edit `terraform.tfvars`:**

```hcl
# AWS Settings (Region already in .env)
project_name  = "mra-mines"
environment   = "prod"

# IAM Configuration
use_existing_iam_roles = false  # Set true if roles exist

# Admin User
admin_username = "admin"
admin_email    = "admin@yourcompany.com"
admin_password = "YourSecurePassword123!"  # CHANGE THIS!

# Custom Domain (Optional)
enable_custom_domain = true
domain_name          = "your-domain.com"
```

---

## 🎯 Deploy Everything

```bash
cd deployment-package
./scripts/deploy.sh
```

**That's it!** The script will:
1. ✅ Validate AWS credentials from `.env`
2. ✅ Build infrastructure (VPC, ALB, S3, DynamoDB, etc.)
3. ✅ Build and push processor container
4. ✅ Build and push frontend container
5. ✅ Deploy to AWS ECS Fargate
6. ✅ Create admin user
7. ✅ Verify deployment

**Duration**: 15-25 minutes

---

## 📊 Post-Deployment

### Get Application URL

```bash
cd infra
terraform output application_url
```

### Access Application

1. Visit the URL in your browser
2. Accept certificate warning (self-signed HTTPS)
3. Login with admin credentials
4. **Change password immediately!**

### Configure Custom Domain (if enabled)

```bash
cd infra
terraform output route53_nameservers
```

Update your domain registrar with these nameservers.
DNS propagation: 1-48 hours (typically 1-6 hours)

---

## 🔒 Security Notes

⚠️ **IMPORTANT:**
- ✅ `.env` is in `.gitignore` - never commit it!
- ✅ Change default admin password after first login
- ✅ Keep AWS credentials secure
- ✅ Review IAM permissions (use least privilege)

---

## 🧪 Testing Deployment

### Verify Infrastructure

```bash
cd infra

# Check ECS
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --region $AWS_DEFAULT_REGION

# Check ALB Health
aws elbv2 describe-target-health \
  --target-group-arn $(terraform output -raw frontend_target_group_arn) \
  --region $AWS_DEFAULT_REGION
```

### View Logs

```bash
# Frontend logs
aws logs tail /ecs/mra-mines-frontend-prod --follow --region $AWS_DEFAULT_REGION

# Processor logs
aws logs tail /ecs/mra-mines-processor-prod --follow --region $AWS_DEFAULT_REGION
```

---

## 🛠️ Common Issues

### Error: "AWS credential validation failed"
**Solution**: Check AWS credentials in `.env`
- Verify Access Key ID is correct
- Verify Secret Access Key is correct
- Ensure IAM user has admin permissions

### Error: "PROCESSOR_REPO_PATH not set"
**Solution**: Edit `.env` and set processor path
```bash
PROCESSOR_REPO_PATH=/full/path/to/mra-mine-plans-ds
```

### Error: "Docker daemon not running"
**Solution**: Start Docker Desktop or Docker service

### Error: "terraform.tfvars not found"
**Solution**: Create it from template
```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
```

---

## 📚 Full Documentation

- **Architecture**: `docs/architecture.md`
- **Detailed Deployment**: `docs/deployment-guide.md`
- **Troubleshooting**: `docs/troubleshooting.md`

---

## 🔄 Cleanup / Destroy

To remove all AWS resources:

```bash
cd deployment-package
./scripts/cleanup.sh
```

Requires confirmation: type "DELETE" and "YES I AM SURE"

---

## 📞 Support

For deployment issues:
1. Check deployment logs in terminal
2. Review troubleshooting guide: `docs/troubleshooting.md`
3. Verify prerequisites: `./scripts/setup.sh`
4. Check AWS credentials: `./scripts/configure_aws.sh`

---

**Ready to deploy? Start with Step 1 above! 🚀**
