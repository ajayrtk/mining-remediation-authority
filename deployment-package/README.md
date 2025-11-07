# MRA Mines Map - Deployment Package

## Overview

This package contains everything needed to deploy the MRA Mines Map application to your AWS account. The system is a cloud-native web application for processing and managing mining map data, built with serverless and container-based AWS services.

### Key Features
- **Secure Authentication**: AWS Cognito with OAuth 2.0
- **Scalable Processing**: ECS Fargate for on-demand computing
- **Global CDN**: CloudFront for HTTPS and fast content delivery
- **Serverless Processing**: Lambda functions for automated workflows
- **Managed Storage**: S3 for files, DynamoDB for metadata

### Estimated Monthly Cost
**$25-56/month** for moderate usage (low traffic, ~10-50 users)

---

## Quick Start

### Prerequisites
- AWS account with admin access
- AWS CLI v2.0+ installed and configured
- Terraform v1.6.0+ installed
- Docker v20.0+ installed and running
- Node.js v20.0+ and npm v9.0+ installed

### Deployment in 3 Steps

**1. Run pre-flight checks:**
```bash
cd deployment-package
./scripts/setup.sh
```

**2. Configure settings:**
```bash
# Edit terraform.tfvars
cd infra
nano terraform.tfvars

# Minimum required changes:
# - aws_region = "eu-west-1"
# - use_existing_iam_roles = true (if IAM roles already exist)
# - cognito_callback_urls (update with CloudFront URL after deployment)
```

**3. Deploy:**
```bash
./scripts/deploy.sh
```

**Total deployment time:** 10-15 minutes

---

## What's Included

```
deployment-package/
├── infra/                          # Terraform infrastructure code
│   ├── *.tf                        # Resource definitions
│   └── build_and_push.sh           # Container build script
│
├── frontend/                       # SvelteKit web application
│   ├── src/                        # Application source code
│   └── Dockerfile                  # Container definition
│
├── backend/                        # Lambda functions
│   ├── lambda/input-handler/       # S3 upload processor
│   ├── lambda/output-handler/      # Results processor
│   └── lambda/s3-copy-processor/   # File copy utility
│
├── scripts/
│   ├── setup.sh                    # Prerequisites checker
│   ├── deploy.sh                   # Automated deployment
│   └── cleanup.sh                  # Resource cleanup/destroy
│
├── docs/
│   ├── deployment-guide.md         # Step-by-step deployment
│   ├── architecture.md             # System architecture
│   └── maintenance-guide.md        # Operations & maintenance
│
├── infra/terraform.tfvars.example  # Configuration template
└── README.md                       # This file
```

---

## Architecture Overview

```
User → CloudFront (HTTPS) → ECS Fargate (Frontend)
                                ↓
                            Cognito (Auth)
                                ↓
                    S3 ← → Lambda ← → DynamoDB
                                ↓
                        ECS Fargate (Processor)
```

**Key Components:**
- **CloudFront**: Global CDN with HTTPS
- **ECS Fargate**: Containerized frontend (SvelteKit)
- **Cognito**: User authentication
- **S3**: File storage (input/output buckets)
- **Lambda**: Serverless processing triggers
- **DynamoDB**: Job tracking and metadata
- **VPC**: Network isolation

See [docs/architecture.md](docs/architecture.md) for detailed diagrams.

---

## Documentation

### For Initial Setup
📘 **[Deployment Guide](docs/deployment-guide.md)** - Complete step-by-step instructions
- Prerequisites and requirements
- Configuration options
- Deployment process
- Post-deployment setup
- Troubleshooting common issues

### For Understanding the System
📊 **[Architecture Documentation](docs/architecture.md)** - System design and components
- Architecture diagrams
- Component specifications
- Data flow
- Security model
- Cost breakdown
- Scalability patterns

### For Day-to-Day Operations
🔧 **[Maintenance Guide](docs/maintenance-guide.md)** - Operations and maintenance
- Daily operational tasks
- Updating the application
- Monitoring and logging
- Backup and restore procedures
- Scaling resources
- Security maintenance
- Cost management
- Troubleshooting
- Emergency procedures

---

## Configuration Options

The `infra/terraform.tfvars` file controls all deployment settings. Key options:

### Required Settings
```hcl
aws_region = "eu-west-1"              # AWS region

# IAM roles configuration
use_existing_iam_roles = true         # Use existing IAM roles (recommended)

# Cognito callback URLs (update after getting CloudFront URL)
cognito_callback_urls = [
  "http://localhost:5173/auth/callback",
  "https://YOUR_CLOUDFRONT_URL/auth/callback"
]
```

### IAM Roles (if using existing)
```hcl
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

See [infra/terraform.tfvars.example](infra/terraform.tfvars.example) for all available options.

---

## Post-Deployment

After deployment completes, you'll receive:
- **CloudFront URL**: Your application endpoint (HTTPS)
- **Cognito User Pool ID**: For creating users
- **S3 Bucket Names**: For file storage

### Create Your First User

```bash
# Get Cognito User Pool ID
cd infra
POOL_ID=$(terraform output -raw cognito_user_pool_id)

# Create admin user
aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username admin@your-domain.com \
  --user-attributes Name=email,Value=admin@your-domain.com

# Set password
aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username admin@your-domain.com \
  --password 'YourSecurePassword123!' \
  --permanent
```

### Access Your Application

Visit the CloudFront URL and log in with your admin credentials.

---

## Common Tasks

### View Application Logs
```bash
cd infra
aws logs tail /ecs/mra-mines-dev-frontend --follow
```

### Update Frontend Code
```bash
cd frontend
# Make changes, then:
npm run build
cd ../infra
./build_and_push.sh
aws ecs update-service --cluster mra-mines-cluster --service mra-mines-dev-frontend --force-new-deployment
```

### Scale Resources
```bash
# Edit terraform.tfvars (change CPU/memory)
cd infra
terraform apply
```

### Destroy Everything
```bash
cd deployment-package
./scripts/cleanup.sh
# Follow prompts (requires "DELETE" and "YES I AM SURE")
```

See [Maintenance Guide](docs/maintenance-guide.md) for detailed operational procedures.

---

## Troubleshooting

### CloudFront shows "Something went wrong"
**Solution:** Wait 2-3 minutes for cache to clear, or manually invalidate:
```bash
cd infra
DIST_ID=$(terraform output -raw cloudfront_distribution_id)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

### Login fails with "redirect_mismatch"
**Solution:** Verify CloudFront URL is in Cognito callback URLs:
```bash
cd infra
terraform output cloudfront_url
# Update terraform.tfvars if needed, then:
terraform apply
```

### "AccessDenied" errors in application
**Solution:** Check IAM roles have correct permissions:
```bash
aws ecs describe-task-definition \
  --task-definition mra-mines-dev-frontend \
  --query 'taskDefinition.taskRoleArn'
```

### High AWS costs
**Solution:** Check S3 storage and CloudFront data transfer:
```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '30 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --group-by Type=SERVICE
```

See [Deployment Guide](docs/deployment-guide.md) for comprehensive troubleshooting.

---

## Security Best Practices

✅ **Before deploying to production:**

1. **Use a dedicated AWS account** for production workloads
2. **Enable MFA** on all IAM users
3. **Enable CloudTrail** for audit logging
4. **Set up AWS Budgets** to monitor costs
5. **Review IAM policies** for least-privilege access
6. **Verify SES email** for production notifications
7. **Configure custom domain** with SSL/TLS certificate
8. **Enable DynamoDB backups** (PITR) for production data

See [Maintenance Guide - Security](docs/maintenance-guide.md#security-maintenance) for detailed security procedures.

---

## Cost Breakdown

### Default Configuration (~$25-56/month)
| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| ECS Fargate (Frontend) | $15-25 | 24/7 running task |
| CloudFront | $5-10 | Depends on traffic |
| DynamoDB | $2-10 | On-demand pricing |
| S3 Storage | $1-5 | Depends on uploads |
| Lambda | $0-5 | Usually in free tier |
| ECR | $1 | Image storage |

### Cost Optimization
- Use CloudFront caching aggressively (80%+ hit rate)
- Set S3 lifecycle policies (delete old files)
- Right-size ECS tasks (don't over-provision)
- Use DynamoDB on-demand for variable load

See [Architecture - Cost Breakdown](docs/architecture.md#cost-breakdown) for detailed analysis.

---

## Support

### Documentation
- **Deployment**: [docs/deployment-guide.md](docs/deployment-guide.md)
- **Architecture**: [docs/architecture.md](docs/architecture.md)
- **Maintenance**: [docs/maintenance-guide.md](docs/maintenance-guide.md)

### AWS Resources
- **AWS CLI Reference**: https://docs.aws.amazon.com/cli/
- **Terraform Registry**: https://registry.terraform.io/providers/hashicorp/aws/
- **SvelteKit Docs**: https://kit.svelte.dev/

### Common Commands Reference

**Check deployment status:**
```bash
cd infra
terraform output
```

**View logs:**
```bash
aws logs tail /ecs/mra-mines-dev-frontend --follow
```

**List users:**
```bash
POOL_ID=$(cd infra && terraform output -raw cognito_user_pool_id)
aws cognito-idp list-users --user-pool-id $POOL_ID
```

**Check service health:**
```bash
aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
```

---

## License

Copyright © 2025 MRA Mines Project. All rights reserved.

This deployment package is provided for authorized use only. Unauthorized copying, distribution, or use is prohibited.

---

## Changelog

### Version 1.0.0 (2025-11-06)
- Initial release
- Complete infrastructure as code (Terraform)
- Automated deployment scripts
- Comprehensive documentation
- Production-ready configuration

---

## Technical Specifications

| Component | Technology | Version |
|-----------|-----------|---------|
| Frontend | SvelteKit | Latest |
| Backend | Node.js | 20.x |
| Infrastructure | Terraform | 1.6.0+ |
| Container Runtime | Docker | 20.0+ |
| Cloud Provider | AWS | N/A |
| Authentication | Cognito | OAuth 2.0 |
| Database | DynamoDB | On-demand |
| Storage | S3 | Standard |
| CDN | CloudFront | Latest |
| Compute | ECS Fargate | Latest |

---

## Getting Help

If you encounter issues:

1. **Check the logs** first (see Common Commands above)
2. **Review troubleshooting sections** in relevant documentation
3. **Verify AWS credentials** and permissions
4. **Check AWS Service Health** dashboard
5. **Review recent changes** (git log, Terraform state)

For production issues, follow the [Emergency Procedures](docs/maintenance-guide.md#emergency-procedures) in the Maintenance Guide.

---

**Package Version:** 1.0.0
**Last Updated:** 2025-11-06
**Tested With:** AWS CLI 2.x, Terraform 1.6.x, Node.js 20.x
