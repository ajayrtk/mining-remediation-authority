# MRA Mines Map Application - Deployment Package

## 🎯 Quick Start

**New to this application?** Start here:

1. **Read**: `docs/CLIENT_DEPLOYMENT_GUIDE.md` - Complete step-by-step instructions
2. **Configure**: Create `.env` and `terraform.tfvars` files
3. **Deploy**: Run `./scripts/deploy.sh`
4. **Time Required**: 30-45 minutes

---

## 📚 Documentation Overview

This package contains everything needed to deploy the MRA Mines Map application to AWS.

### Start Here (Pick One)

| Document | Best For | Time to Read |
|----------|----------|--------------|
| **docs/CLIENT_DEPLOYMENT_GUIDE.md** | First-time deployment, step-by-step instructions | 10 min |
| **docs/DEPLOYMENT_QUICKSTART.md** | Quick reference, experienced users | 3 min |
| **This README** | Overview and document navigation | 2 min |

### Detailed Documentation

| Document | Purpose |
|----------|---------|
| `docs/architecture.md` | System architecture and design |
| `docs/deployment-guide.md` | Alternative deployment guide |
| `docs/troubleshooting.md` | Common issues and solutions |
| `docs/PACKAGE_CONTENTS.md` | Complete package inventory |

---

## 📦 What's Included

### Core Components

```
deployment-package/
├── README.md                           ← You are here
├── .env.example                        ← Template for configuration
├── .gitignore                          ← Security (keeps .env safe)
│
├── scripts/
│   ├── setup.sh                       ← Check prerequisites
│   ├── configure_aws.sh               ← Validate AWS credentials
│   ├── deploy.sh                      ← MAIN DEPLOYMENT SCRIPT
│   └── cleanup.sh                     ← Remove all resources
│
├── infra/
│   ├── *.tf                           ← Terraform infrastructure code
│   ├── terraform.tfvars.example       ← Infrastructure config template
│   └── lambda/                        ← AWS Lambda functions
│
├── frontend/
│   ├── src/                           ← Web application source
│   ├── Dockerfile                     ← Frontend container
│   └── build_and_push.sh              ← Frontend deployment
│
└── docs/
    ├── CLIENT_DEPLOYMENT_GUIDE.md     ← START HERE for deployment
    ├── DEPLOYMENT_QUICKSTART.md       ← Quick reference
    ├── PACKAGE_CONTENTS.md            ← Complete inventory
    ├── architecture.md                ← System design
    ├── deployment-guide.md            ← Alternative guide
    └── troubleshooting.md             ← Problem solving
```

### Additional Repository Required

**mra-mine-plans-ds/** - Map processor engine (ML/CV)
- Must be extracted alongside deployment-package
- Contains Python processing code
- Built and deployed automatically by `deploy.sh`

---

## 🚀 Quick Deployment Steps

### 1. Prerequisites

Install required tools (run checker):
```bash
./scripts/setup.sh
```

**Required**:
- AWS CLI v2.0+
- Terraform v1.6.0+
- Docker v20.0+
- Node.js v20.0+ & npm v9.0+

### 2. Get AWS Credentials

Create IAM user in AWS Console:
- Go to: https://console.aws.amazon.com/iam/
- Create user with **AdministratorAccess**
- Create **Access Keys** (save immediately!)

### 3. Configure Environment

**Create `.env` file**:
```bash
cp .env.example .env
nano .env
```

**Add your credentials**:
```bash
AWS_ACCESS_KEY_ID=your-key-here
AWS_SECRET_ACCESS_KEY=your-secret-here
AWS_DEFAULT_REGION=eu-west-2
PROCESSOR_REPO_PATH=/path/to/mra-mine-plans-ds
```

**Create `terraform.tfvars`**:
```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
```

### 4. Deploy

```bash
cd ..  # Back to deployment-package
./scripts/deploy.sh
```

**Duration**: 15-25 minutes

### 5. Access

Visit the Application URL shown at the end of deployment.

---

## 🎓 Deployment Workflow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    DEPLOYMENT FLOW                       │
└─────────────────────────────────────────────────────────┘

1. Prerequisites Check (./scripts/setup.sh)
   ├─ AWS CLI ✓
   ├─ Terraform ✓
   ├─ Docker ✓
   └─ Node.js ✓

2. Configuration
   ├─ Create .env (AWS credentials + paths)
   └─ Create terraform.tfvars (infrastructure settings)

3. Run Deployment (./scripts/deploy.sh)
   ├─ [0/8] Configure AWS credentials
   ├─ [1/8] Initialize Terraform
   ├─ [2/8] Plan infrastructure
   ├─ [3/8] Deploy infrastructure (~5-10 min)
   │   ├─ VPC, Subnets, Security Groups
   │   ├─ ALB, ECS Cluster
   │   ├─ S3 Buckets, DynamoDB Tables
   │   ├─ Lambda Functions
   │   ├─ Cognito User Pool
   │   └─ ECR Repositories
   ├─ [4/8] Build processor container (~5-10 min)
   │   └─ Docker build + push to ECR
   ├─ [5/8] Build frontend container (~3-5 min)
   │   └─ Docker build + push to ECR
   ├─ [6/8] Wait for ECS deployment (~2-3 min)
   ├─ [7/8] Verify Cognito configuration
   └─ [8/8] Create admin user

4. Post-Deployment
   ├─ Login to application
   ├─ Change admin password
   └─ Configure custom domain (optional)

5. Testing
   ├─ Upload test map
   ├─ Verify processing
   └─ Check logs
```

---

## 🎯 Key Features

This deployment creates a **production-ready** cloud application with:

✅ **Serverless Architecture**
- AWS ECS Fargate (containers)
- AWS Lambda (event processing)
- DynamoDB (NoSQL database)
- S3 (file storage)

✅ **Secure by Default**
- HTTPS/TLS encryption
- OAuth 2.0 authentication (Cognito)
- IAM role-based permissions
- VPC network isolation

✅ **Scalable**
- Auto-scaling containers
- On-demand processing
- Distributed architecture

✅ **Cost-Optimized**
- Pay-per-use pricing
- Fargate Spot for batch jobs
- Estimated: $50-100/month

---

## 🔒 Security Best Practices

### Before Deployment

1. ✅ **Use dedicated AWS account** for production
2. ✅ **Enable MFA** on AWS root account
3. ✅ **Review IAM permissions** (least privilege)

### During Configuration

1. ✅ **Strong passwords** (admin user)
2. ✅ **Secure .env file** (never commit to git)
3. ✅ **Valid email** for admin user

### After Deployment

1. ✅ **Change default admin password immediately**
2. ✅ **Enable CloudTrail** (audit logging)
3. ✅ **Set up AWS Budgets** (cost monitoring)
4. ✅ **Configure backups** (DynamoDB PITR)
5. ✅ **Review security groups** (network access)

---

## 💰 Cost Estimation

**Production Environment** (moderate usage):

| Service | Monthly Cost |
|---------|--------------|
| ECS Fargate (Frontend) | $20-35 |
| ALB | $16-22 |
| DynamoDB | $5-15 |
| S3 Storage | $2-10 |
| Lambda | $0-5 |
| ECR | $1-2 |
| Route53 | $0.50 |
| **Total** | **$50-100** |

**Cost varies based on**:
- Number of maps processed
- Storage usage
- Number of users
- Data transfer

---

## 🛠️ Useful Commands

### Check Deployment Status

```bash
cd infra
terraform output
```

### View Application Logs

```bash
# Frontend
aws logs tail /ecs/mra-mines-frontend-prod --follow

# Processor
aws logs tail /ecs/mra-mines-processor-prod --follow
```

### Create New User

```bash
cd infra
POOL_ID=$(terraform output -raw cognito_user_pool_id)

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username newuser@company.com \
  --user-attributes Name=email,Value=newuser@company.com

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username newuser@company.com \
  --password 'SecurePassword123!' \
  --permanent
```

### Check Infrastructure Health

```bash
cd infra

# ECS Service
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --query 'services[0].{Status:status,Running:runningCount}'

# ALB Health
aws elbv2 describe-target-health \
  --target-group-arn $(terraform output -raw frontend_target_group_arn)
```

### Destroy Everything

```bash
./scripts/cleanup.sh
```

---

## 📞 Getting Help

### Self-Service Resources

1. **Troubleshooting Guide**: `docs/troubleshooting.md`
2. **Architecture Docs**: `docs/architecture.md`
3. **AWS Service Health**: https://status.aws.amazon.com/

### Common Issues

| Issue | Solution |
|-------|----------|
| AWS credentials invalid | Check `.env` file, verify in IAM console |
| Docker not running | Start Docker Desktop or service |
| Processor path not found | Set absolute path in `.env` |
| terraform.tfvars missing | Copy from terraform.tfvars.example |
| ECS task not starting | Check CloudWatch logs, verify ECR image |

### Diagnostic Scripts

```bash
# Check prerequisites
./scripts/setup.sh

# Test AWS credentials
./scripts/configure_aws.sh

# View all Terraform outputs
cd infra && terraform output
```

---

## 🔄 Maintenance

### Regular Tasks

**Weekly**:
- Review CloudWatch logs for errors
- Check AWS costs in Billing Dashboard

**Monthly**:
- Update admin user password
- Review IAM permissions
- Check S3 storage usage

**Quarterly**:
- Update Docker images
- Review and update documentation
- Test disaster recovery

### Updating the Application

**Frontend updates**:
```bash
cd frontend
# Make changes...
npm run build
./build_and_push.sh
```

**Infrastructure updates**:
```bash
cd infra
# Edit .tf files...
terraform plan
terraform apply
```

---

## 📝 Important Files

### Must Configure (Before Deployment)

| File | Purpose | Create From |
|------|---------|-------------|
| `.env` | AWS credentials & paths | `.env.example` |
| `infra/terraform.tfvars` | Infrastructure settings | `terraform.tfvars.example` |

### Generated (During Deployment)

| File | Purpose | Location |
|------|---------|----------|
| `terraform.tfstate` | Infrastructure state | `infra/` |
| `.terraform/` | Provider plugins | `infra/` |

### Never Commit (Protected by .gitignore)

- `.env` - Contains AWS credentials
- `terraform.tfstate` - May contain sensitive data
- `infra/.terraform/` - Provider binaries

---

## 🎉 Next Steps

After successful deployment:

1. **Immediate** (First Hour):
   - ✅ Change admin password
   - ✅ Test map upload and processing
   - ✅ Verify ECS tasks are healthy

2. **Short Term** (First Day):
   - ✅ Create additional user accounts
   - ✅ Set up monitoring alerts
   - ✅ Configure cost budgets

3. **Medium Term** (First Week):
   - ✅ Enable DynamoDB backups
   - ✅ Configure CloudTrail
   - ✅ Train team on application

4. **Long Term** (Ongoing):
   - ✅ Monitor costs and optimize
   - ✅ Regular security audits
   - ✅ Performance tuning

---

## 📄 License & Support

**Copyright © 2025 MRA Mines Project**

This deployment package is provided for authorized use only.

**Package Version**: 2.0.0
**Last Updated**: January 2025
**Tested With**: AWS CLI 2.x, Terraform 1.6.x, Node.js 20.x

---

## 🚀 Ready to Deploy?

**Follow these steps**:

1. ✅ Read `docs/CLIENT_DEPLOYMENT_GUIDE.md`
2. ✅ Run `./scripts/setup.sh`
3. ✅ Configure `.env` and `terraform.tfvars`
4. ✅ Run `./scripts/deploy.sh`
5. ✅ Access your application!

**Questions?** Check the troubleshooting guide or review the documentation.

---

**Happy Deploying! 🎉**
