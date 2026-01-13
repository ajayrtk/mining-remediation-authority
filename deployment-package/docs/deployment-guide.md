# Deployment Guide

## Prerequisites

- AWS account with admin access
- AWS CLI v2.0+ (no need to configure separately)
- Terraform v1.6.0+
- Docker v20.0+ running
- Node.js v20.0+ and npm v9.0+
- Both repositories extracted: `deployment-package/` and `mra-mine-plans-ds/`

**Quick Check**:
```bash
cd deployment-package
./scripts/setup.sh
```

## Step 1: Configure Environment (.env)

The `.env` file contains AWS credentials and paths. This approach makes deployment portable across different machines.

### Create .env file:

```bash
cd deployment-package
cp .env.example .env
nano .env  # or use your preferred editor
```

### Configure Required Settings:

```bash
# ==================================================
# AWS CREDENTIALS (REQUIRED)
# ==================================================
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=eu-west-2

# ==================================================
# PROCESSOR REPOSITORY (REQUIRED)
# ==================================================
# Set the absolute path to mra-mine-plans-ds repository
PROCESSOR_REPO_PATH=/home/username/mra-mine-plans-ds

# ==================================================
# OPTIONAL: PROJECT CONFIGURATION
# ==================================================
# PROJECT_NAME=mra-mines
# ENVIRONMENT=prod
```

**Important**:
- Get AWS credentials from IAM Console → Users → Security Credentials → Create Access Key
- Use absolute path for PROCESSOR_REPO_PATH (not relative)
- Never commit `.env` to version control (already in .gitignore)

### Validate Configuration:

```bash
./scripts/configure_aws.sh
```

**Expected Output**:
```
✓ AWS credentials validated successfully
  Account ID: 123456789012
  Region:     eu-west-2
✓ S3 access confirmed
```

## Step 2: Configure Infrastructure (terraform.tfvars)

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
aws_region    = "eu-west-2"  # Same as in .env
project_name  = "mra-mines"
environment   = "prod"        # prod, staging, or dev

# Admin credentials
admin_username = "admin"
admin_email    = "admin@yourcompany.com"
admin_password = "ChangeThisPassword123!"

# IAM Configuration
use_existing_iam_roles = false  # Set true if roles exist

# Custom Domain (Optional)
enable_custom_domain = true
domain_name          = "mine-maps.yourcompany.com"
```

## Step 3: Deploy Everything

Run the automated deployment script:

```bash
cd ..  # Back to deployment-package
./scripts/deploy.sh
```

**This single command will**:
1. **[0/8]** Configure AWS credentials from .env
2. **[1/8]** Initialize Terraform
3. **[2/8]** Plan infrastructure
4. **[3/8]** Create AWS infrastructure (~5-10 minutes)
5. **[4/8]** Build and push processor container (~5-10 minutes)
   - Navigates to mra-mine-plans-ds
   - Builds Docker image
   - Pushes to ECR
6. **[5/8]** Build and push frontend container (~3-5 minutes)
7. **[6/8]** Wait for ECS deployment
8. **[7/8]** Verify Cognito configuration
9. **[8/8]** Create admin user

**Total Time**: 15-25 minutes

**Deployment Output**:
```
============================================
Deployment completed successfully!

Application URL: https://alb-123456789.eu-west-2.elb.amazonaws.com

Admin Credentials:
  Username: admin
  Email:    admin@yourcompany.com
  Password: ChangeThisPassword123!

⚠ CHANGE THIS PASSWORD after first login!
============================================
```

## Step 4: Access Application

After deployment:

1. Visit the Application URL (shown in deployment output)
2. Accept certificate warning (self-signed HTTPS)
   - Chrome: Click "Advanced" → "Proceed to site"
   - Firefox: Click "Advanced" → "Accept the Risk"
3. Login with admin credentials
4. **Change password immediately** (security requirement)

## Alternative: Manual Deployment

If you prefer manual control over each step:

### 1. Configure AWS Credentials
```bash
cd deployment-package
./scripts/configure_aws.sh
```

### 2. Deploy Infrastructure
```bash
cd infra
terraform init
terraform plan
terraform apply
```

### 3. Build and Deploy Processor
```bash
# Navigate to processor repository (path from .env)
cd $PROCESSOR_REPO_PATH
./build_and_push.sh
```

### 4. Build and Deploy Frontend
```bash
cd /path/to/deployment-package/frontend
npm ci
npm run build
./build_and_push.sh
```

### 5. Get Deployment Information
```bash
cd ../infra
terraform output
```

## Configuration Options

### Required Variables

| Variable | Description |
|----------|-------------|
| `aws_region` | AWS region |
| `admin_email` | Admin user email |
| `admin_password` | Admin user password |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `project_name` | mra-mines | Project identifier |
| `environment` | staging | Environment suffix |
| `frontend_cpu` | 512 | Frontend task CPU |
| `frontend_memory` | 1024 | Frontend task memory |
| `enable_custom_domain` | false | Enable custom domain with ACM |
| `domain_name` | "" | Custom domain (e.g., mine-maps.com) |

## Custom Domain Setup (Optional)

For production with a custom domain:

```hcl
# In terraform.tfvars
enable_custom_domain = true
domain_name = "mine-maps.com"
```

This will:
1. Create Route53 hosted zone
2. Request ACM SSL certificate (free)
3. Configure ALB with ACM certificate
4. Create DNS A records

**After deployment:**
1. Get nameservers: `terraform output route53_nameservers`
2. Update your domain registrar with these nameservers
3. Wait for DNS propagation (up to 48 hours)

## Post-Deployment

### Create Additional Users

```bash
POOL_ID=$(cd infra && terraform output -raw cognito_user_pool_id)
REGION=$(cd infra && terraform output -raw aws_region)

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username newuser@example.com \
  --user-attributes Name=email,Value=newuser@example.com \
  --region $REGION

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username newuser@example.com \
  --password 'SecurePassword123!' \
  --permanent \
  --region $REGION
```

### Update Frontend

```bash
cd frontend
npm run build
./build_and_push.sh

# Force redeploy
cd ../infra
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw frontend_service_name)
REGION=$(terraform output -raw aws_region)

aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --force-new-deployment \
  --region $REGION
```

### View Logs

```bash
cd infra
SERVICE=$(terraform output -raw frontend_service_name)
REGION=$(terraform output -raw aws_region)

aws logs tail /ecs/$SERVICE --follow --region $REGION
```

## Cleanup

To destroy all resources:

```bash
./scripts/cleanup.sh
```

This requires confirmation prompts to prevent accidental deletion.
