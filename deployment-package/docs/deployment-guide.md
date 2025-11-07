# MRA Mines Map - Deployment Guide

**Version:** 2.0
**Last Updated:** 2025-11-06
**Region:** eu-west-1

---

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Step-by-Step Deployment](#step-by-step-deployment)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Verification](#verification)
- [Common Operations](#common-operations)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

**For experienced users with tools already installed:**

```bash
# 1. Navigate to deployment package
cd /path/to/deployment-package

# 2. Configure deployment
cd infra
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars  # Edit: aws_region, cognito_callback_urls

# 3. Deploy infrastructure
terraform init
terraform plan
terraform apply

# 4. Deploy frontend
cd ../frontend
./build_and_push.sh

# 5. Create admin user
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

# 6. Access application
terraform output cloudfront_url
```

**Deployment Time:** 10-15 minutes

---

## Prerequisites

### 1. AWS Account Requirements

**Required:**
- Active AWS account with billing enabled
- IAM user with appropriate permissions:
  - `AdministratorAccess` (recommended for initial deployment)
  - OR specific permissions for: ECS, ECR, CloudFront, Cognito, DynamoDB, S3, Lambda, VPC, IAM

**Service Limits:**
- ECS: Can run at least 2 Fargate tasks
- ECR: Can create repositories
- CloudFront: Can create distributions
- DynamoDB: No table count restrictions
- S3: Can create buckets

**Create IAM User (if needed):**
1. Log into AWS Console
2. Navigate to IAM → Users → Add User
3. Set username (e.g., `terraform-deployer`)
4. Select "Programmatic access"
5. Attach `AdministratorAccess` policy
6. Save Access Key ID and Secret Access Key

### 2. Required Software

| Tool | Minimum Version | Installation |
|------|----------------|--------------|
| **AWS CLI** | v2.0+ | https://aws.amazon.com/cli/ |
| **Terraform** | v1.6.0+ | https://www.terraform.io/downloads |
| **Docker** | v20.0+ | https://docs.docker.com/get-docker/ |
| **Node.js** | v20.0+ | https://nodejs.org/ |
| **npm** | v9.0+ | Comes with Node.js |

**Check Installed Versions:**
```bash
aws --version      # Should be 2.0+
terraform --version # Should be 1.6.0+
docker --version   # Should be 20.0+
node --version     # Should be v20.0+
npm --version      # Should be 9.0+
```

**Installation by Platform:**

#### macOS
```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install required tools
brew install awscli
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
brew install --cask docker
brew install node@20
```

#### Linux (Ubuntu/Debian)
```bash
# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Terraform
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform

# Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Windows
```powershell
# Install Chocolatey (Run PowerShell as Administrator)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install tools
choco install awscli terraform docker-desktop nodejs --version=20.0.0
```

### 3. Configure AWS Credentials

```bash
# Run AWS configuration
aws configure
```

**Enter when prompted:**
```
AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name: eu-west-1
Default output format: json
```

**Verify Configuration:**
```bash
# Test credentials
aws sts get-caller-identity

# Expected output:
# {
#     "UserId": "AIDAXXXXXXXXXXXXXXXXX",
#     "Account": "123456789012",
#     "Arn": "arn:aws:iam::123456789012:user/terraform-deployer"
# }

# Test permissions
aws s3 ls  # Should list buckets or return empty (not "Access Denied")
```

### 4. Pre-Deployment Checklist

- [ ] AWS account created and accessible
- [ ] IAM user with appropriate permissions created
- [ ] AWS CLI installed and configured (`aws sts get-caller-identity` works)
- [ ] Terraform installed (version >= 1.6.0)
- [ ] Docker installed and running (`docker ps` works)
- [ ] Node.js and npm installed
- [ ] Project files downloaded/extracted
- [ ] Estimated costs reviewed (~$50-100/month for dev, ~$300-500/month for production)

---

## Step-by-Step Deployment

### Step 1: Prepare Deployment Package

```bash
# Navigate to deployment package
cd /path/to/deployment-package

# Make scripts executable
chmod +x scripts/*.sh
chmod +x frontend/build_and_push.sh

# Verify directory structure
ls -la
# Should see: backend/, frontend/, infra/, scripts/, docs/
```

### Step 2: Configure Terraform Variables

```bash
# Navigate to infra directory
cd infra

# Create configuration from example (if doesn't exist)
cp terraform.tfvars.example terraform.tfvars

# Edit configuration
nano terraform.tfvars  # or vim, code, etc.
```

**Required Configuration Changes:**

```hcl
# ============================================
# REQUIRED SETTINGS
# ============================================

# AWS Region (must match where you want to deploy)
aws_region = "eu-west-1"

# Use existing IAM roles (recommended to avoid conflicts)
use_existing_iam_roles = true

# Cognito callback URLs - IMPORTANT: Update after getting CloudFront URL
cognito_callback_urls = [
  "http://localhost:5173/auth/callback",
  "https://YOUR_CLOUDFRONT_URL/auth/callback"  # Update after deployment
]

cognito_logout_urls = [
  "http://localhost:5173/",
  "https://YOUR_CLOUDFRONT_URL/"  # Update after deployment
]

# Names of existing IAM roles (if use_existing_iam_roles = true)
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
```

**Note:** If IAM roles don't exist yet, set:
```hcl
use_existing_iam_roles = false
```

**Save the file:**
- In `nano`: Press `Ctrl+X`, then `Y`, then `Enter`
- In `vim`: Press `Esc`, type `:wq`, press `Enter`

### Step 3: Initialize Terraform

```bash
# Still in infra/ directory
terraform init
```

**Expected Output:**
```
Initializing the backend...
Initializing provider plugins...
- Finding hashicorp/aws versions matching "~> 5.0"...
- Installing hashicorp/aws v5.30.0...

Terraform has been successfully initialized!
```

### Step 4: Plan Infrastructure

```bash
# Preview what will be created
terraform plan
```

**Expected Output:**
```
Plan: 45 to add, 0 to change, 0 to destroy.

Changes to Outputs:
  + cloudfront_url          = (known after apply)
  + cognito_user_pool_id    = (known after apply)
  + map_input_bucket_name   = (known after apply)
  + map_output_bucket_name  = (known after apply)
```

**Review the plan carefully:**
- Check resource names are correct
- Verify region is eu-west-1
- Ensure no unexpected deletions

### Step 5: Deploy Infrastructure

```bash
# Apply the Terraform plan
terraform apply
```

**You'll be prompted:**
```
Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value:
```

Type `yes` and press Enter.

**Deployment Progress (5-10 minutes):**
```
aws_vpc.main: Creating...
aws_vpc.main: Creation complete after 2s
aws_subnet.public_a: Creating...
aws_subnet.public_b: Creating...
aws_internet_gateway.main: Creating...
aws_security_group.frontend: Creating...
aws_s3_bucket.map_input: Creating...
aws_s3_bucket.map_output: Creating...
aws_dynamodb_table.maps: Creating...
aws_dynamodb_table.map_jobs: Creating...
aws_ecs_cluster.main: Creating...
aws_cognito_user_pool.main: Creating...
aws_cloudfront_distribution.frontend: Creating... (this takes 5-10 minutes)
...

Apply complete! Resources: 45 added, 0 changed, 0 destroyed.

Outputs:
cloudfront_url = "https://d3n47138ce9sz5.cloudfront.net"
cognito_user_pool_id = "eu-west-1_ABC123XYZ"
map_input_bucket_name = "mra-mines-dev-map-input"
map_output_bucket_name = "mra-mines-dev-map-output"
```

**Save the outputs:**
```bash
# Save all outputs to file
terraform output > ../deployment-outputs.txt

# Get CloudFront URL
CLOUDFRONT_URL=$(terraform output -raw cloudfront_url)
echo "Application URL: $CLOUDFRONT_URL"
```

### Step 6: Update Cognito Callback URLs

**Important:** Now that you have the CloudFront URL, update Cognito configuration:

```bash
# Still in infra/ directory
nano terraform.tfvars
```

**Update the callback URLs:**
```hcl
cognito_callback_urls = [
  "http://localhost:5173/auth/callback",
  "https://d3n47138ce9sz5.cloudfront.net/auth/callback"  # Your actual CloudFront URL
]

cognito_logout_urls = [
  "http://localhost:5173/",
  "https://d3n47138ce9sz5.cloudfront.net/"  # Your actual CloudFront URL
]
```

**Apply the update:**
```bash
terraform apply
# Type 'yes' when prompted
```

### Step 7: Build and Deploy Frontend

```bash
# Navigate to frontend directory
cd ../frontend

# Build and push Docker image
./build_and_push.sh
```

**Expected Output:**
```
Building frontend Docker image...
[+] Building 45.2s (12/12) FINISHED
 => [1/6] FROM node:20-alpine
 => [2/6] WORKDIR /app
 => [3/6] COPY package*.json ./
 => [4/6] RUN npm ci --production
 => [5/6] COPY . .
 => [6/6] RUN npm run build

Pushing to ECR...
The push refers to repository [123456789012.dkr.ecr.eu-west-1.amazonaws.com/mra-mines-dev-frontend]
latest: digest: sha256:abc123... size: 2841

Frontend deployed successfully!
```

**If deployment script fails, manually deploy:**
```bash
# Get ECR repository URL
cd ../infra
ECR_URL=$(terraform output -raw ecr_repository_url)

# Build Docker image
cd ../frontend
docker build -t mra-mines-frontend .

# Authenticate to ECR
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin $ECR_URL

# Tag and push
docker tag mra-mines-frontend:latest $ECR_URL:latest
docker push $ECR_URL:latest

# Force ECS service to redeploy
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --force-new-deployment \
  --region eu-west-1
```

### Step 8: Wait for ECS Service to Start

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --region eu-west-1 \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

**Expected Output:**
```json
{
    "Status": "ACTIVE",
    "Running": 1,
    "Desired": 1
}
```

**If Running is 0, wait 2-3 minutes and check again.**

---

## Post-Deployment Configuration

### Create Your First Admin User

```bash
# Navigate to infra directory
cd infra

# Get Cognito User Pool ID
POOL_ID=$(terraform output -raw cognito_user_pool_id)
echo "User Pool ID: $POOL_ID"

# Create admin user
aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username admin@your-company.com \
  --user-attributes Name=email,Value=admin@your-company.com \
  --message-action SUPPRESS \
  --region eu-west-1
```

**Expected Output:**
```json
{
    "User": {
        "Username": "admin@your-company.com",
        "Attributes": [...],
        "UserStatus": "FORCE_CHANGE_PASSWORD",
        "Enabled": true
    }
}
```

**Set Permanent Password:**
```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username admin@your-company.com \
  --password 'YourSecurePassword123!' \
  --permanent \
  --region eu-west-1
```

**Password Requirements:**
- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (!@#$%^&*)

### Create Additional Users (Optional)

```bash
# Create another user
aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username user1@your-company.com \
  --user-attributes Name=email,Value=user1@your-company.com \
  --message-action SUPPRESS \
  --region eu-west-1

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username user1@your-company.com \
  --password 'UserPassword123!' \
  --permanent \
  --region eu-west-1
```

### List All Users

```bash
aws cognito-idp list-users \
  --user-pool-id $POOL_ID \
  --region eu-west-1 \
  --query 'Users[*].{Username:Username,Email:Attributes[?Name==`email`].Value|[0],Status:UserStatus}' \
  --output table
```

---

## Verification

### 1. Access the Application

```bash
# Get application URL
cd infra
CLOUDFRONT_URL=$(terraform output -raw cloudfront_url)
echo "Application URL: $CLOUDFRONT_URL"

# Open in browser (macOS)
open $CLOUDFRONT_URL

# Open in browser (Linux)
xdg-open $CLOUDFRONT_URL
```

**Wait 2-3 minutes** if you see "Something went wrong" initially (CloudFront cache propagation).

### 2. Test Login

1. Navigate to the CloudFront URL
2. Click "Sign in with AWS Cognito"
3. Enter credentials:
   - **Username:** `admin@your-company.com`
   - **Password:** `YourSecurePassword123!`
4. You should see the Dashboard with:
   - Job pipeline overview
   - Upload section
   - Recent job activity

### 3. Test File Upload

**Create test file:**
```bash
mkdir -p ~/mra-test-upload
cd ~/mra-test-upload

# Create dummy images
echo "Test image 1" > image1.jpg
echo "Test image 2" > image2.jpg
echo "Test image 3" > image3.jpg

# Create ZIP
zip test-maps.zip image1.jpg image2.jpg image3.jpg
```

**Upload via UI:**
1. In the Dashboard, click "Select files" or drag-and-drop
2. Select `test-maps.zip`
3. Click "Upload"
4. Watch job progress: QUEUED → DISPATCHED → PROCESSING → COMPLETED

### 4. Verify Infrastructure

```bash
cd infra

# List all resources
terraform state list

# Check key outputs
echo "CloudFront URL: $(terraform output -raw cloudfront_url)"
echo "Cognito Pool ID: $(terraform output -raw cognito_user_pool_id)"
echo "Input Bucket: $(terraform output -raw map_input_bucket_name)"
echo "Output Bucket: $(terraform output -raw map_output_bucket_name)"

# Check ECS service
aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --region eu-west-1 \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,Deployments:deployments[0].status}'
```

---

## Common Operations

### View Application Logs

```bash
# Real-time frontend logs
aws logs tail "/ecs/mra-mines-dev-frontend" \
  --follow \
  --region eu-west-1

# Filter for errors only
aws logs tail "/ecs/mra-mines-dev-frontend" \
  --follow \
  --filter-pattern "ERROR" \
  --region eu-west-1

# View last 1 hour
aws logs tail "/ecs/mra-mines-dev-frontend" \
  --since 1h \
  --region eu-west-1
```

### Update Frontend Application

```bash
# Make code changes in frontend/src/

# Rebuild and deploy
cd frontend
./build_and_push.sh

# Force ECS to deploy new version
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --force-new-deployment \
  --region eu-west-1

# Wait for deployment to complete
aws ecs wait services-stable \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --region eu-west-1
```

### Check ECS Service Status

```bash
aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --region eu-west-1 \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

### Force Service Redeploy

```bash
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --force-new-deployment \
  --region eu-west-1
```

### Invalidate CloudFront Cache

```bash
cd infra
DIST_ID=$(terraform output -raw cloudfront_distribution_id)

aws cloudfront create-invalidation \
  --distribution-id $DIST_ID \
  --paths "/*" \
  --region eu-west-1
```

### Check DynamoDB Tables

```bash
# List jobs
aws dynamodb scan \
  --table-name map-jobs \
  --region eu-west-1 \
  --query 'Items[*].{JobID:jobId.S,Status:status.S,Created:createdAt.S}' \
  --output table

# List maps
aws dynamodb scan \
  --table-name maps \
  --region eu-west-1 \
  --query 'Items[*].{MapID:mapId.S,Name:name.S,Status:status.S}' \
  --output table
```

### Check S3 Buckets

```bash
cd infra
INPUT_BUCKET=$(terraform output -raw map_input_bucket_name)
OUTPUT_BUCKET=$(terraform output -raw map_output_bucket_name)

# List input files
aws s3 ls s3://$INPUT_BUCKET --recursive --human-readable --region eu-west-1

# List output files
aws s3 ls s3://$OUTPUT_BUCKET --recursive --human-readable --region eu-west-1
```

### Monitor Costs

```bash
# Current month costs by service
aws ce get-cost-and-usage \
  --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --group-by Type=SERVICE \
  --output table
```

---

## Troubleshooting

### Issue: IAM Role Already Exists

**Error:**
```
Error: creating IAM Role (mra-mines-ecs-task-execution): EntityAlreadyExists:
Role with name mra-mines-ecs-task-execution already exists.
```

**Solution:**
```bash
cd infra
nano terraform.tfvars

# Set use_existing_iam_roles = true
# Configure existing_iam_role_names with your role names

terraform apply
```

See `infra/IAM_ROLES_USAGE.md` for details.

---

### Issue: CloudFront Shows "Something Went Wrong"

**Causes:**
1. Cache hasn't cleared yet (wait 2-3 minutes)
2. ECS task not running
3. CloudFront origin incorrect

**Solution:**

```bash
# Check ECS task status
aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --region eu-west-1

# Check if task is running (Running: 1)
# If Running: 0, force new deployment:
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --force-new-deployment \
  --region eu-west-1

# Invalidate CloudFront cache
cd infra
DIST_ID=$(terraform output -raw cloudfront_distribution_id)
aws cloudfront create-invalidation \
  --distribution-id $DIST_ID \
  --paths "/*"

# Wait 2-3 minutes, then refresh browser
```

---

### Issue: Login Fails with "redirect_mismatch"

**Cause:** CloudFront URL not in Cognito callback URLs

**Solution:**
```bash
cd infra

# Get CloudFront URL
CLOUDFRONT_URL=$(terraform output -raw cloudfront_url)
echo "CloudFront URL: $CLOUDFRONT_URL"

# Edit terraform.tfvars
nano terraform.tfvars

# Ensure cognito_callback_urls includes:
# "https://YOUR_CLOUDFRONT_URL/auth/callback"

# Apply changes
terraform apply
```

---

### Issue: S3 Bucket Region Mismatch

**Error:**
```
Error: reading S3 Bucket Versioning: PermanentRedirect: The bucket you are
attempting to access must be addressed using the specified endpoint.
```

**Solution:**
```bash
cd infra
nano terraform.tfvars

# Ensure aws_region matches where buckets are deployed
aws_region = "eu-west-1"

terraform apply
```

---

### Issue: ECR Authentication Failed

**Error:**
```
no basic auth credentials
```

**Solution:**
```bash
# Manually authenticate to ECR
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin \
  123456789012.dkr.ecr.eu-west-1.amazonaws.com

# Retry deployment
cd frontend
./build_and_push.sh
```

---

### Issue: Docker Build Fails

**Causes:**
1. Docker daemon not running
2. Insufficient disk space
3. Network issues

**Solution:**
```bash
# Check Docker status
docker ps

# If fails, start Docker Desktop

# Clean up old images
docker system prune -a

# Check disk space
df -h

# Retry build
cd frontend
./build_and_push.sh
```

---

### Issue: Terraform State Lock

**Error:**
```
Error: Error acquiring the state lock
```

**Solution:**
```bash
# Wait 2 minutes for lock to expire automatically
# OR force unlock (use with caution):
cd infra
terraform force-unlock <LOCK_ID>
```

---

### Issue: High AWS Costs

**Check cost breakdown:**
```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '30 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --group-by Type=SERVICE \
  --output table
```

**Cost optimization tips:**
1. Stop ECS services when not in use
2. Enable S3 lifecycle policies
3. Reduce CloudWatch log retention
4. Use reserved capacity for predictable workloads

---

## Infrastructure Cleanup

**To destroy all infrastructure:**

```bash
cd infra

# Preview what will be destroyed
terraform plan -destroy

# Destroy infrastructure
terraform destroy

# Type 'yes' when prompted
```

**Warning:** This will delete all resources including data in S3 and DynamoDB!

**Before destroying, backup important data:**
```bash
# Backup DynamoDB tables
aws dynamodb create-backup \
  --table-name maps \
  --backup-name maps-backup-$(date +%Y%m%d)

aws dynamodb create-backup \
  --table-name map-jobs \
  --backup-name map-jobs-backup-$(date +%Y%m%d)

# Download S3 data
INPUT_BUCKET=$(terraform output -raw map_input_bucket_name)
OUTPUT_BUCKET=$(terraform output -raw map_output_bucket_name)

aws s3 sync s3://$INPUT_BUCKET ./backup/input/
aws s3 sync s3://$OUTPUT_BUCKET ./backup/output/
```

---

## Additional Resources

**Documentation:**
- **Architecture Overview:** `docs/architecture.md`
- **Maintenance Guide:** `docs/maintenance-guide.md`
- **IAM Configuration:** `infra/IAM_ROLES_USAGE.md`
- **Production Readiness:** `infra/PRODUCTION_READINESS_ASSESSMENT.md`
- **Troubleshooting:** `infra/TROUBLESHOOTING.md`
- **Recent Changes:** `infra/CHANGELOG.md`

**External Resources:**
- AWS Documentation: https://docs.aws.amazon.com/
- Terraform AWS Provider: https://registry.terraform.io/providers/hashicorp/aws/
- Docker Documentation: https://docs.docker.com/
- AWS CLI Reference: https://awscli.amazonaws.com/v2/documentation/api/latest/index.html

---

## Quick Reference

### Get All Important Information

```bash
cd infra

echo "=== Application Access ==="
echo "URL: $(terraform output -raw cloudfront_url)"
echo ""

echo "=== User Management ==="
echo "Cognito Pool ID: $(terraform output -raw cognito_user_pool_id)"
echo ""

echo "=== Storage ==="
echo "Input Bucket: $(terraform output -raw map_input_bucket_name)"
echo "Output Bucket: $(terraform output -raw map_output_bucket_name)"
echo ""

echo "=== Infrastructure ==="
echo "ECS Cluster: $(terraform output -raw ecs_cluster_name)"
echo "Region: $(terraform output -raw aws_region)"
```

### Health Check Script

```bash
cat > check_health.sh << 'EOF'
#!/bin/bash
cd infra

echo "=== MRA Mines Map - Health Check ==="
echo ""

echo "1. CloudFront Distribution:"
DIST_ID=$(terraform output -raw cloudfront_distribution_id)
aws cloudfront get-distribution --id $DIST_ID --query 'Distribution.Status' --output text
echo ""

echo "2. ECS Service Status:"
aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --region eu-west-1 \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table
echo ""

echo "3. DynamoDB Tables:"
aws dynamodb describe-table --table-name maps --region eu-west-1 --query 'Table.{Name:TableName,Status:TableStatus}' --output table
echo ""

echo "4. Application URL:"
terraform output cloudfront_url
echo ""

echo "=== Health Check Complete ==="
EOF

chmod +x check_health.sh
./check_health.sh
```

---

**Deployment Guide Version:** 2.0
**Last Updated:** 2025-11-06
**Tested With:** AWS CLI 2.x, Terraform 1.6.x, Docker 24.x, Node.js 20.x
**Region:** eu-west-1
