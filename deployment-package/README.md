# MRA Mines Map - Deployment Package

## Overview

This package contains everything needed to deploy the MRA Mines Map application to your AWS account. The system is a cloud-native web application for processing and managing mining map data, built with serverless and container-based AWS services.

### Key Features
- **Secure Authentication**: AWS Cognito with OAuth 2.0
- **Scalable Processing**: ECS Fargate for on-demand computing
- **HTTPS Access**: Application Load Balancer with SSL/TLS
- **Serverless Processing**: Lambda functions for automated workflows
- **Managed Storage**: S3 for files, DynamoDB for metadata

### Estimated Monthly Cost
**$32-62/month** for moderate usage (low traffic, ~10-50 users)

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
# - aws_region = "eu-west-2"
# - use_existing_iam_roles = true (if IAM roles already exist)
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
│   ├── lambda/                     # Lambda function source code
│   │   ├── input_handler/          # S3 upload processor
│   │   ├── output_handler/         # Results processor
│   │   ├── s3_copy_processor/      # File copy utility
│   │   ├── ecs_state_handler/      # ECS event handler
│   │   └── pre_auth_trigger/       # Cognito pre-auth Lambda
│   └── terraform.tfvars.example    # Configuration template
│
├── frontend/                       # SvelteKit web application
│   ├── src/                        # Application source code
│   ├── Dockerfile                  # Container definition
│   └── build_and_push.sh           # Frontend container build script
│
├── scripts/
│   ├── setup.sh                    # Prerequisites checker
│   ├── deploy.sh                   # Automated deployment
│   └── cleanup.sh                  # Resource cleanup/destroy
│
├── docs/
│   ├── architecture.md             # System architecture
│   ├── deployment-guide.md         # Detailed deployment steps
│   └── troubleshooting.md          # Common issues and solutions
│
└── README.md                       # This file
```

---

## Architecture Overview

```
User → ALB (HTTPS) → ECS Fargate (Frontend)
                           ↓
                       Cognito (Auth)
                           ↓
               S3 ← → Lambda ← → DynamoDB
                           ↓
                   ECS Fargate (Processor)
```

**Key Components:**
- **ALB**: Application Load Balancer with HTTPS (self-signed cert)
- **ECS Fargate**: Containerized frontend (SvelteKit) and processor
- **Cognito**: User authentication
- **S3**: File storage (input/output buckets)
- **Lambda**: Serverless processing triggers
- **DynamoDB**: Job tracking and metadata
- **VPC**: Network isolation

See [docs/architecture.md](docs/architecture.md) for detailed architecture documentation.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System design, components, data flow |
| [Deployment Guide](docs/deployment-guide.md) | Step-by-step deployment instructions |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

---

## Configuration Options

The `infra/terraform.tfvars` file controls all deployment settings. Key options:

### Required Settings
```hcl
aws_region = "eu-west-2"              # AWS region

# IAM roles configuration
use_existing_iam_roles = true         # Use existing IAM roles (recommended)
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

### Custom Domain (Optional)
```hcl
enable_custom_domain = true
domain_name = "mine-maps.com"
```

This enables ACM SSL certificate and Route53 DNS. See [Deployment Guide](docs/deployment-guide.md#custom-domain-setup-optional) for setup instructions.

See [infra/terraform.tfvars.example](infra/terraform.tfvars.example) for all available options.

---

## Post-Deployment

After deployment completes, you'll receive:
- **Application URL**: ALB endpoint with HTTPS (self-signed certificate)
- **Cognito User Pool ID**: For creating users
- **S3 Bucket Names**: For file storage

> **Note**: Browser will show a certificate warning (self-signed cert). Click "Advanced" → "Proceed" to access the application.

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

Visit the Application URL and log in with your admin credentials.

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


---

## Troubleshooting

### Certificate warning in browser
**Expected behavior:** The ALB uses a self-signed certificate. Click "Advanced" → "Proceed" to continue.

### Login fails with "redirect_mismatch"
**Solution:** Verify ALB URL is correctly configured in Cognito:
```bash
cd infra
terraform output alb_url
```

### "AccessDenied" errors in application
**Solution:** Check IAM roles have correct permissions:
```bash
aws ecs describe-task-definition \
  --task-definition mra-mines-dev-frontend \
  --query 'taskDefinition.taskRoleArn'
```

See [docs/troubleshooting.md](docs/troubleshooting.md) for more solutions.


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


---

## Cost Breakdown

### Default Configuration (~$32-62/month)
| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| ECS Fargate (Frontend) | $15-25 | 24/7 running task |
| ALB | $16-22 | Load balancer + LCU |
| DynamoDB | $2-10 | On-demand pricing |
| S3 Storage | $1-5 | Depends on uploads |
| Lambda | $0-5 | Usually in free tier |
| ECR | $1 | Image storage |

### Cost Optimization
- Set S3 lifecycle policies (delete old files)
- Right-size ECS tasks (don't over-provision)
- Use DynamoDB on-demand for variable load


---

## Support

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
| Load Balancer | ALB | Latest |
| Compute | ECS Fargate | Latest |

---

## Getting Help

If you encounter issues:

1. **Check the logs** first (see Common Commands above)
2. **Review troubleshooting sections** in relevant documentation
3. **Verify AWS credentials** and permissions
4. **Check AWS Service Health** dashboard
5. **Review recent changes** (git log, Terraform state)


---

**Package Version:** 1.0.1
**Last Updated:** 2025-11-26
**Tested With:** AWS CLI 2.x, Terraform 1.6.x, Node.js 20.x
