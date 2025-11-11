# MRA Mines Map - Infrastructure

This directory contains the Terraform infrastructure code for deploying the MRA Mines Map application to AWS.

---

## Quick Start

```bash
# 1. Configure deployment
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars  # Edit: aws_region, cognito_callback_urls

# 2. Deploy infrastructure
terraform init
terraform plan
terraform apply

# 3. Deploy frontend
cd ../frontend
./build_and_push.sh

# 4. Get application URL
cd ../infra
terraform output application_url
```

---

## Resource Naming Convention

All AWS resources follow a consistent naming pattern for multi-environment support:

```
{project_name}-{resource_name}-{environment}
```

**Examples:**
- S3 Bucket: `mra-mines-map-input-staging`
- ECS Cluster: `mra-mines-cluster-staging`
- ECR Repository: `mra-mines-frontend-staging`
- Lambda: `mra-mines-input-handler-staging`

This allows multiple environments (dev, staging, production) to coexist in the same AWS account.

---

## Configuration

**Key settings in `terraform.tfvars`:**
- `project_name` - Project identifier (default: mra-mines)
- `environment` - Environment name (default: dev) - used as suffix in all resource names
- `aws_region` - AWS region (default: eu-west-2)
- `use_existing_iam_roles` - Use existing IAM roles to avoid conflicts
- `cognito_domain_prefix` - Custom prefix for Cognito hosted UI domain

**Current Configuration:**
```bash
# View current settings
cat terraform.tfvars

# View all outputs
terraform output
```

---

## Common Commands

### Deploy/Update Infrastructure
```bash
terraform plan     # Preview changes
terraform apply    # Apply changes
```

### Check Status
```bash
# View all resources
terraform state list

# Get outputs
terraform output

# Check ECS service (example with default values: project=mra-mines, env=staging)
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --region $(terraform output -raw aws_region)
```

### Update Frontend
```bash
cd ../frontend
./build_and_push.sh

# Force ECS redeploy
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw frontend_service_name) \
  --force-new-deployment \
  --region $(terraform output -raw aws_region)
```

### View Logs
```bash
# Real-time logs (frontend)
PROJECT=$(terraform output -raw project_name 2>/dev/null || echo "mra-mines")
ENV=$(terraform output -raw environment 2>/dev/null || echo "staging")
aws logs tail "/ecs/${PROJECT}-frontend-${ENV}" \
  --follow \
  --region $(terraform output -raw aws_region)

# Processor logs
aws logs tail "/ecs/${PROJECT}-processor-${ENV}" \
  --follow \
  --region $(terraform output -raw aws_region)
```

### Cleanup
```bash
terraform destroy  # Remove all infrastructure
```

---

## Infrastructure Components

**Created Resources (~71 total):**
- VPC with public subnets (2 AZs)
- Application Load Balancer (ALB) with self-signed HTTPS
- ECS Cluster + Fargate tasks (frontend + processor)
- Cognito user pool + identity pool
- DynamoDB tables (maps, map-jobs)
- S3 buckets (input, output)
- Lambda functions (input/output handlers, pre-auth trigger)
- IAM roles (conditional)
- Security groups
- ECR repositories (frontend + processor)

**Key Files:**
- `main.tf` - Provider configuration
- `vpc.tf` - Networking
- `alb.tf` - Application Load Balancer, listeners, target groups
- `ecs.tf` - Container orchestration
- `frontend_ecs_simple.tf` - Frontend service
- `lambda.tf` - Serverless functions
- `dynamodb.tf` - Database
- `s3.tf` - Storage
- `cognito.tf` - Authentication (user pool)
- `cognito_identity.tf` - Identity pool for S3 access
- `iam.tf` - IAM roles (conditional)
- `iam_data.tf` - Existing IAM role lookups

---

## Documentation

📚 **Available documentation:**

- **[Architecture](../docs/ARCHITECTURE.md)** - System architecture and design overview
- **[Custom Domain Setup](../docs/CUSTOM_DOMAIN_SETUP.md)** - Guide for setting up custom domain + ACM certificate (production HTTPS)

**Note:** Additional documentation files referenced above may not exist yet. Current deployment uses:
- ALB with self-signed HTTPS certificate
- Direct access architecture (no CloudFront)
- See Terraform files in `infra/` for detailed configuration

---

## Quick Reference

```bash
# Get all important info
echo "Application URL: $(terraform output -raw application_url)"
echo "ALB DNS: $(terraform output -raw alb_dns_name)"
echo "Cognito Pool ID: $(terraform output -raw cognito_user_pool_id)"
echo "Cognito Client ID: $(terraform output -raw cognito_user_pool_client_id)"
echo "Input Bucket: $(terraform output -raw map_input_bucket_name)"
echo "Output Bucket: $(terraform output -raw map_output_bucket_name)"
echo "Region: $(terraform output -raw aws_region)"
```

---

## Support

- **Architecture:** See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- **Custom Domain Setup:** See [docs/CUSTOM_DOMAIN_SETUP.md](../docs/CUSTOM_DOMAIN_SETUP.md)
- **Terraform Configuration:** Review `.tf` files in this directory

---

**Last Updated:** 2025-11-11
**Terraform Version:** >= 1.6.0
**AWS Provider:** >= 5.0
**Default Region:** eu-west-2
**Naming Pattern:** {project}-{resource}-{environment}
**Architecture:** ALB-Direct with self-signed HTTPS
