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
terraform output cloudfront_url
```

---

## Configuration

**Key settings in `terraform.tfvars`:**
- `aws_region` - AWS region (default: eu-west-1)
- `use_existing_iam_roles` - Use existing IAM roles to avoid conflicts
- `cognito_callback_urls` - Update with CloudFront URL after deployment

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

# Check ECS service
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services mra-mines-dev-frontend \
  --region $(terraform output -raw aws_region)
```

### Update Frontend
```bash
cd ../frontend
./build_and_push.sh

# Force ECS redeploy
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service mra-mines-dev-frontend \
  --force-new-deployment \
  --region $(terraform output -raw aws_region)
```

### View Logs
```bash
# Real-time logs
aws logs tail "/ecs/mra-mines-dev-frontend" \
  --follow \
  --region $(terraform output -raw aws_region)
```

### Cleanup
```bash
terraform destroy  # Remove all infrastructure
```

---

## Infrastructure Components

**Created Resources (~45 total):**
- VPC with public/private subnets
- ECS Cluster + Fargate tasks
- CloudFront distribution
- Cognito user pool
- DynamoDB tables (maps, map-jobs)
- S3 buckets (input, output)
- Lambda functions (input/output handlers)
- IAM roles (conditional)
- Security groups
- ECR repositories

**Key Files:**
- `main.tf` - Provider configuration
- `vpc.tf` - Networking
- `ecs.tf` - Container orchestration
- `frontend_ecs_simple.tf` - Frontend service
- `lambda.tf` - Serverless functions
- `dynamodb.tf` - Database
- `s3.tf` - Storage
- `cognito.tf` - Authentication
- `iam.tf` - IAM roles (conditional)
- `iam_data.tf` - Existing IAM role lookups

---

## Documentation

📚 **Complete documentation is in the `docs/` directory:**

- **[Deployment Guide](../docs/deployment-guide.md)** - Complete step-by-step deployment
- **[Architecture](../docs/architecture.md)** - System design and components
- **[Maintenance Guide](../docs/maintenance-guide.md)** - Operations and monitoring
- **[Troubleshooting](../docs/troubleshooting.md)** - Common issues and solutions
- **[IAM Configuration](../docs/iam-configuration.md)** - IAM role setup
- **[Production Readiness](../docs/production-readiness.md)** - Production deployment checklist
- **[Changelog](../docs/changelog.md)** - Recent changes and updates

---

## Quick Reference

```bash
# Get all important info
echo "Application URL: $(terraform output -raw cloudfront_url)"
echo "Cognito Pool ID: $(terraform output -raw cognito_user_pool_id)"
echo "Input Bucket: $(terraform output -raw map_input_bucket_name)"
echo "Output Bucket: $(terraform output -raw map_output_bucket_name)"
echo "Region: $(terraform output -raw aws_region)"
```

---

## Support

- **Deployment Issues:** See [docs/troubleshooting.md](../docs/troubleshooting.md)
- **IAM Role Conflicts:** See [docs/iam-configuration.md](../docs/iam-configuration.md)
- **Production Setup:** See [docs/production-readiness.md](../docs/production-readiness.md)

---

**Last Updated:** 2025-11-06
**Terraform Version:** >= 1.6.0
**AWS Provider:** >= 5.0
**Region:** eu-west-1
