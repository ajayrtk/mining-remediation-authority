# Deployment Guide

## Prerequisites

- AWS account with admin access
- AWS CLI v2.0+ configured
- Terraform v1.6.0+
- Docker v20.0+ running
- Node.js v20.0+ and npm v9.0+

## Step 1: Configure Settings

```bash
cd deployment-package/infra
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
aws_region    = "eu-west-2"
project_name  = "mra-mines"
environment   = "staging"

# Admin credentials
admin_username = "admin"
admin_email    = "admin@example.com"
admin_password = "ChangeMe123!"

# Use existing IAM roles (recommended)
use_existing_iam_roles = true
```

## Step 2: Deploy

Run the automated deployment:

```bash
cd deployment-package
./scripts/deploy.sh
```

This will:
1. Initialize Terraform
2. Create infrastructure (~5-10 minutes)
3. Build and push frontend container
4. Wait for ECS deployment
5. Create admin user
6. Verify deployment

## Step 3: Access Application

After deployment:

1. Visit the Application URL (shown in output)
2. Accept certificate warning (self-signed HTTPS)
3. Login with admin credentials
4. Change password immediately

## Manual Deployment

If you prefer manual steps:

```bash
# 1. Deploy infrastructure
cd infra
terraform init
terraform plan
terraform apply

# 2. Build and deploy frontend
cd ../frontend
npm ci
npm run build
./build_and_push.sh

# 3. Get outputs
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
