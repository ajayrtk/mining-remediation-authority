# MRA Mines Map Application - Complete Client Deployment Guide

## 📦 Table of Contents

1. [What You're Receiving](#what-youre-receiving)
2. [Prerequisites & Installation](#prerequisites--installation)
3. [Step-by-Step Deployment](#step-by-step-deployment)
4. [Post-Deployment Configuration](#post-deployment-configuration)
5. [Testing Your Deployment](#testing-your-deployment)
6. [Troubleshooting](#troubleshooting)
7. [Maintenance & Operations](#maintenance--operations)

---

## What You're Receiving

You will receive **TWO separate repositories**:

### 1. `deployment-package/` - Main Deployment Package
Contains:
- ✅ Frontend web application (SvelteKit)
- ✅ Infrastructure code (Terraform)
- ✅ Deployment scripts
- ✅ AWS Lambda functions
- ✅ Configuration templates

### 2. `mra-mine-plans-ds/` - Map Processor Engine
Contains:
- ✅ Python ML/CV processing code
- ✅ Docker container definitions
- ✅ Map digitization algorithms
- ✅ Build and deployment scripts

**Both repositories are required** for a complete deployment.

---

## Prerequisites & Installation

### Required Software

Before deployment, you must install the following tools on your machine:

#### 1. AWS CLI (v2.0 or higher)

**What it does**: Communicates with AWS services

**Installation**:

**macOS**:
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

**Linux**:
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

**Windows**:
Download and run: https://awscli.amazonaws.com/AWSCLIV2.msi

**Verify**:
```bash
aws --version
# Expected: aws-cli/2.x.x or higher
```

#### 2. Terraform (v1.6.0 or higher)

**What it does**: Creates and manages AWS infrastructure

**Installation**:

**macOS** (using Homebrew):
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```

**Linux**:
```bash
wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip
unzip terraform_1.6.0_linux_amd64.zip
sudo mv terraform /usr/local/bin/
```

**Windows** (using Chocolatey):
```bash
choco install terraform
```

**Verify**:
```bash
terraform --version
# Expected: Terraform v1.6.0 or higher
```

#### 3. Docker (v20.0 or higher)

**What it does**: Builds and runs container images

**Installation**:

**macOS**: Download Docker Desktop from https://www.docker.com/products/docker-desktop/
**Linux**: Follow guide at https://docs.docker.com/engine/install/
**Windows**: Download Docker Desktop from https://www.docker.com/products/docker-desktop/

**Start Docker Desktop** (macOS/Windows) or **Docker service** (Linux)

**Verify**:
```bash
docker --version
# Expected: Docker version 20.x or higher

docker ps
# Should show running containers (or empty list)
```

#### 4. Node.js (v20.0 or higher) and npm (v9.0 or higher)

**What it does**: Builds the frontend application

**Installation**:

**macOS/Linux/Windows**: Download from https://nodejs.org/ (LTS version)

**Verify**:
```bash
node --version
# Expected: v20.x or higher

npm --version
# Expected: 9.x or higher
```

### Quick Prerequisites Check

Run the automated setup checker:

```bash
cd deployment-package
./scripts/setup.sh
```

This will verify all prerequisites are correctly installed.

---

## Step-by-Step Deployment

### Step 1: Extract Both Repositories

Extract both ZIP files (or clone both repositories) to your local machine.

**Recommended Structure**:
```
/home/your-username/
├── deployment-package/
└── mra-mine-plans-ds/
```

**Example**:
```bash
# Extract to home directory
cd ~
unzip deployment-package.zip
unzip mra-mine-plans-ds.zip

# Or if using git
git clone <deployment-package-url>
git clone <mra-mine-plans-ds-url>
```

**Verify**:
```bash
ls -la
# You should see both directories
```

---

### Step 2: Get AWS Credentials

You need AWS credentials to deploy the application.

#### Option A: Create New IAM User (Recommended)

1. **Go to AWS IAM Console**:
   - https://console.aws.amazon.com/iam/

2. **Create User**:
   - Click **Users** → **Add users**
   - Username: `mra-mines-deployer`
   - Access type: **Programmatic access** ✓

3. **Set Permissions**:
   - **Attach existing policies directly**
   - Select: **AdministratorAccess** (or create custom policy)

4. **Create Access Key**:
   - Click on the user → **Security credentials** tab
   - Click **Create access key**
   - Choose: **Command Line Interface (CLI)**
   - Click **Create access key**

5. **Save Credentials** (IMPORTANT!):
   - **Access Key ID**: `AKIAIOSFODNN7EXAMPLE`
   - **Secret Access Key**: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
   - ⚠️ **Save these immediately** - you cannot retrieve the secret key later!

#### Option B: Use Existing IAM User

If you already have an IAM user with admin permissions:
1. Go to IAM Console → Users → Your user
2. Security credentials tab
3. Create access key
4. Save the credentials

---

### Step 3: Configure Environment (.env)

This is the **main configuration file** where you'll set AWS credentials and paths.

#### 3.1 Create .env File

```bash
cd deployment-package
cp .env.example .env
```

#### 3.2 Edit .env File

**Linux/macOS**:
```bash
nano .env
```

**Windows**:
```bash
notepad .env
```

#### 3.3 Fill in Required Information

```bash
# ==================================================
# AWS CREDENTIALS (REQUIRED)
# ==================================================
# Paste your AWS credentials from Step 2
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_DEFAULT_REGION=eu-west-2

# ==================================================
# PROCESSOR REPOSITORY (REQUIRED)
# ==================================================
# Set the FULL PATH to where you extracted mra-mine-plans-ds
# Examples:
#   macOS/Linux: /home/username/mra-mine-plans-ds
#   Windows:     C:/Users/username/mra-mine-plans-ds

PROCESSOR_REPO_PATH=/home/your-username/mra-mine-plans-ds

# ==================================================
# OPTIONAL: PROJECT CONFIGURATION
# ==================================================
# Uncomment if you want to override defaults
# PROJECT_NAME=mra-mines
# ENVIRONMENT=prod
```

**Important Notes**:
- Replace `AKIAIOSFODNN7EXAMPLE` with your actual Access Key ID
- Replace the Secret Access Key with your actual secret
- Replace `/home/your-username/mra-mine-plans-ds` with the **absolute path** to mra-mine-plans-ds on your machine
- Use **forward slashes** (/) even on Windows: `C:/Users/...` not `C:\Users\...`

**Save and close** the file:
- nano: Press `Ctrl+X`, then `Y`, then `Enter`
- notepad: Click File → Save

#### 3.4 Verify .env Configuration

Test your AWS credentials:

```bash
./scripts/configure_aws.sh
```

**Expected Output**:
```
Configuring AWS credentials...
Validating AWS credentials...
✓ AWS credentials validated successfully
  Account ID: 123456789012
  Region:     eu-west-2
  User/Role:  mra-mines-deployer
Testing AWS permissions...
✓ S3 access confirmed
✓ AWS configuration complete
```

If you see errors, review your AWS credentials in `.env` file.

---

### Step 4: Configure Infrastructure (terraform.tfvars)

This file contains AWS infrastructure settings.

#### 4.1 Create terraform.tfvars

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

#### 4.2 Edit terraform.tfvars

```bash
nano terraform.tfvars
# or
notepad terraform.tfvars
```

#### 4.3 Configure Required Settings

```hcl
# ==================================================
# AWS & PROJECT CONFIGURATION
# ==================================================
aws_region    = "eu-west-2"       # Same as in .env
project_name  = "mra-mines"
environment   = "prod"             # prod, staging, or dev

# ==================================================
# IAM ROLES
# ==================================================
# Set to false if this is first deployment
# Set to true if IAM roles already exist from previous deployment
use_existing_iam_roles = false

# ==================================================
# ADMIN USER CREDENTIALS
# ==================================================
admin_username = "admin"
admin_email    = "admin@yourcompany.com"
admin_password = "ChangeThisPassword123!"

# IMPORTANT: Change this password!
# Requirements:
#  - At least 8 characters
#  - At least one uppercase letter
#  - At least one lowercase letter
#  - At least one number
#  - At least one special character

# ==================================================
# CUSTOM DOMAIN (OPTIONAL)
# ==================================================
# Uncomment and configure if you want custom domain
enable_custom_domain = true
domain_name          = "mine-maps.yourcompany.com"

# Note: You must own this domain and be able to update nameservers
```

**Important**:
- **Change admin_password** to a strong, unique password
- **Change admin_email** to your actual email address
- **Change domain_name** if using custom domain (or set `enable_custom_domain = false`)

**Save and close** the file.

---

### Step 5: Run Deployment Script

Now you're ready to deploy everything with a single command!

#### 5.1 Start Deployment

```bash
cd ..  # Go back to deployment-package directory
./scripts/deploy.sh
```

#### 5.2 Deployment Process

The script will:

**Step 0/8**: Configure AWS credentials
- Validates your AWS credentials from `.env`
- Shows account info

**Step 1/8**: Initialize Terraform
- Downloads required providers
- Initializes backend

**Step 2/8**: Plan infrastructure
- Shows what will be created
- ~55-60 AWS resources

**Step 3/8**: Deploy infrastructure (5-10 minutes)
- Creates VPC, subnets, security groups
- Creates ALB, ECS cluster
- Creates S3 buckets, DynamoDB tables
- Creates Lambda functions
- Creates Cognito user pool
- Creates ECR repositories

**Step 4/8**: Build processor container (5-10 minutes)
- Navigates to `mra-mine-plans-ds/`
- Builds Docker image (~2.5GB)
- Pushes to AWS ECR

**Step 5/8**: Build frontend container (3-5 minutes)
- Installs Node.js dependencies
- Compiles SvelteKit application
- Builds Docker image
- Pushes to AWS ECR

**Step 6/8**: Wait for ECS deployment (2-3 minutes)
- Waits for tasks to become healthy
- Verifies ALB registration

**Step 7/8**: Verify Cognito configuration
- Confirms OAuth setup
- Shows application URL

**Step 8/8**: Create admin user
- Creates initial admin account
- Shows credentials

**Total Time**: 15-25 minutes

#### 5.3 Deployment Output

At the end, you'll see:

```
============================================
  Build and Push Complete!
============================================

Deployment completed successfully!

Application URL: https://alb-123456789.eu-west-2.elb.amazonaws.com

Admin Credentials:
  Username: admin
  Email:    admin@yourcompany.com
  Password: ChangeThisPassword123!

⚠ CHANGE THIS PASSWORD after first login!

Next Steps:
1. Visit the Application URL
2. Login with admin credentials
3. Change password immediately
4. Configure custom domain (if enabled)
```

**Save this information!**

---

## Post-Deployment Configuration

### Step 6: Access Your Application

#### 6.1 Visit Application URL

1. Copy the Application URL from deployment output
2. Open in web browser
3. **Accept certificate warning** (self-signed HTTPS)
   - Chrome: Click "Advanced" → "Proceed to site"
   - Firefox: Click "Advanced" → "Accept the Risk and Continue"
   - Safari: Click "Show Details" → "Visit this website"

#### 6.2 First Login

1. You'll see the login page
2. Click **Login** button
3. Enter admin credentials from deployment output
4. Click **Sign In**

#### 6.3 Change Password (CRITICAL!)

After first login:
1. Go to user settings/profile
2. Change password to a new, secure password
3. Save changes

---

### Step 7: Configure Custom Domain (If Enabled)

If you set `enable_custom_domain = true`:

#### 7.1 Get Route53 Nameservers

```bash
cd deployment-package/infra
terraform output route53_nameservers
```

**Output**:
```
[
  "ns-1234.awsdns-12.org",
  "ns-5678.awsdns-34.com",
  "ns-9012.awsdns-56.net",
  "ns-3456.awsdns-78.co.uk"
]
```

#### 7.2 Update Domain Registrar

1. **Log into your domain registrar** (e.g., GoDaddy, Namecheap, Google Domains)
2. **Find DNS/Nameserver settings** for your domain
3. **Replace existing nameservers** with the Route53 nameservers from above
4. **Save changes**

#### 7.3 Wait for DNS Propagation

- **Time**: 5 minutes to 48 hours (typically 1-6 hours)
- **Check progress**: Use https://www.whatsmydns.net/

#### 7.4 Verify SSL Certificate

After DNS propagates:

```bash
cd deployment-package/infra
aws acm describe-certificate \
  --certificate-arn $(terraform output -raw acm_certificate_arn) \
  --query 'Certificate.Status'
```

**Expected**: `"ISSUED"`

Once issued, you can access via your custom domain: `https://mine-maps.yourcompany.com`

---

## Testing Your Deployment

### Test 1: Verify Infrastructure

```bash
cd deployment-package/infra

# Check ECS service
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --region $AWS_DEFAULT_REGION \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'

# Expected output:
# {
#   "Status": "ACTIVE",
#   "Running": 1,
#   "Desired": 1
# }
```

### Test 2: Upload Test Map

1. Login to application
2. Go to upload page
3. Upload a test ZIP file containing:
   - `.tif` or `.png` map image
   - `.tfw` georeferencing file
4. Wait for processing (5-15 minutes)
5. Download processed `.gpkg` file

### Test 3: View Logs

**Frontend logs**:
```bash
aws logs tail /ecs/mra-mines-frontend-prod --follow --region $AWS_DEFAULT_REGION
```

**Processor logs**:
```bash
aws logs tail /ecs/mra-mines-processor-prod --follow --region $AWS_DEFAULT_REGION
```

Press `Ctrl+C` to stop viewing logs.

---

## Troubleshooting

### Common Issues & Solutions

#### Issue 1: "AWS credential validation failed"

**Symptoms**:
```
✗ AWS credential validation failed
InvalidClientTokenId: The security token included in the request is invalid
```

**Solution**:
1. Check AWS credentials in `.env`:
   ```bash
   cat .env | grep AWS_
   ```
2. Verify Access Key ID is correct (no spaces)
3. Verify Secret Access Key is correct
4. Check IAM user has active credentials
5. Try creating new access keys

#### Issue 2: "PROCESSOR_REPO_PATH not set"

**Symptoms**:
```
ERROR: PROCESSOR_REPO_PATH not set in .env
```

**Solution**:
1. Edit `.env` file:
   ```bash
   nano .env
   ```
2. Set absolute path:
   ```bash
   PROCESSOR_REPO_PATH=/home/username/mra-mine-plans-ds
   ```
3. Verify path exists:
   ```bash
   ls $PROCESSOR_REPO_PATH
   # Should show files from mra-mine-plans-ds
   ```

#### Issue 3: "Processor repository not found"

**Symptoms**:
```
⚠ Processor repository not found at: /path/to/mra-mine-plans-ds
```

**Solution**:
1. Verify path is correct:
   ```bash
   ls /path/from/your/env
   ```
2. Use absolute path (not relative):
   - ✅ Correct: `/home/username/mra-mine-plans-ds`
   - ❌ Wrong: `../mra-mine-plans-ds`
3. Check for typos in path

#### Issue 4: "Docker daemon not running"

**Symptoms**:
```
Cannot connect to the Docker daemon
```

**Solution**:
- **macOS/Windows**: Open Docker Desktop application
- **Linux**: Start Docker service:
  ```bash
  sudo systemctl start docker
  ```

#### Issue 5: "terraform.tfvars not found"

**Symptoms**:
```
ERROR: infra/terraform.tfvars not found
```

**Solution**:
```bash
cd deployment-package/infra
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
# Configure settings
```

#### Issue 6: ECS Task Not Starting

**Symptoms**: Frontend shows 0 running tasks

**Diagnosis**:
```bash
cd deployment-package/infra
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --region $AWS_DEFAULT_REGION \
  --query 'services[0].events[:5]'
```

**Common Causes**:
- ECR image not found → Re-run `./scripts/deploy.sh`
- Memory insufficient → Increase in `terraform.tfvars`
- IAM role missing → Check `use_existing_iam_roles` setting

#### Issue 7: High AWS Costs

**Check Current Costs**:
1. Go to AWS Console → Billing Dashboard
2. View by service

**Cost Optimization**:
- Stop unused ECS tasks
- Delete old S3 objects
- Use Fargate Spot for processor
- Set up AWS Budgets for alerts

---

## Maintenance & Operations

### Creating Additional Users

```bash
cd deployment-package/infra

POOL_ID=$(terraform output -raw cognito_user_pool_id)

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username newuser@company.com \
  --user-attributes Name=email,Value=newuser@company.com \
  --region $AWS_DEFAULT_REGION

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username newuser@company.com \
  --password 'SecurePassword123!' \
  --permanent \
  --region $AWS_DEFAULT_REGION
```

### Updating Frontend Code

```bash
cd deployment-package/frontend

# Make code changes
# ...

# Rebuild and deploy
npm run build
./build_and_push.sh
```

### Viewing All Terraform Outputs

```bash
cd deployment-package/infra
terraform output
```

### Destroying Deployment (Remove Everything)

**⚠️ WARNING: This will delete ALL resources and data!**

```bash
cd deployment-package
./scripts/cleanup.sh
```

Follow prompts and type `DELETE` then `YES I AM SURE`

---

## Support & Documentation

### Additional Documentation

- **Architecture Details**: `architecture.md`
- **Detailed Troubleshooting**: `troubleshooting.md`
- **Quick Start Guide**: `DEPLOYMENT_QUICKSTART.md`

### Getting Help

1. **Check logs** first (see Testing section)
2. **Run setup checker**: `./scripts/setup.sh`
3. **Test AWS config**: `./scripts/configure_aws.sh`
4. **Review this guide** for your specific issue
5. **Check AWS Service Health**: https://status.aws.amazon.com/

---

## Summary Checklist

Use this checklist to track your deployment:

- [ ] **Prerequisites installed**
  - [ ] AWS CLI v2.0+
  - [ ] Terraform v1.6.0+
  - [ ] Docker v20.0+
  - [ ] Node.js v20.0+ & npm v9.0+

- [ ] **Repositories extracted**
  - [ ] deployment-package/
  - [ ] mra-mine-plans-ds/

- [ ] **AWS credentials obtained**
  - [ ] Access Key ID
  - [ ] Secret Access Key

- [ ] **Configuration files created**
  - [ ] `.env` created and configured
  - [ ] `terraform.tfvars` created and configured

- [ ] **Deployment completed**
  - [ ] `./scripts/deploy.sh` ran successfully
  - [ ] Application URL received

- [ ] **Post-deployment**
  - [ ] Logged in successfully
  - [ ] Changed admin password
  - [ ] Custom domain configured (if applicable)

- [ ] **Testing**
  - [ ] Uploaded test map
  - [ ] Processing works
  - [ ] Downloaded results

---

**Deployment Time**: Approximately 30-45 minutes (including configuration)
**Questions?** Refer to the Troubleshooting section above.

🎉 **Congratulations on deploying MRA Mines Map!**
