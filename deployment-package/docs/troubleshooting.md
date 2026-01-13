# Troubleshooting

## Common Issues

### AWS Credential Issues

#### "AWS credential validation failed"

**Symptom**: Error during Step 0 of deployment.

```bash
✗ AWS credential validation failed
InvalidClientTokenId: The security token included in the request is invalid
```

**Diagnosis**:
```bash
# Check .env file contents
cat .env | grep AWS_

# Verify credentials manually
aws sts get-caller-identity
```

**Solutions**:
1. **Verify Access Key ID**: Check for typos or spaces
2. **Verify Secret Access Key**: Must be exact (case-sensitive)
3. **Check IAM User Status**: Ensure user exists and is active
4. **Recreate Access Keys**: In IAM Console → Users → Security Credentials
5. **Check Permissions**: User needs AdministratorAccess or equivalent

---

#### ".env file not found"

**Symptom**:
```bash
⚠ .env file not found
Creating .env from .env.example...
ERROR: Please edit .env and configure PROCESSOR_REPO_PATH
```

**Solution**:
```bash
cd deployment-package
cp .env.example .env
nano .env
# Fill in AWS credentials and PROCESSOR_REPO_PATH
```

---

#### "PROCESSOR_REPO_PATH not set in .env"

**Symptom**:
```bash
ERROR: PROCESSOR_REPO_PATH not set in .env
Please edit .env and set:
PROCESSOR_REPO_PATH=/path/to/mra-mine-plans-ds
```

**Solution**:
```bash
# Edit .env file
nano .env

# Add absolute path (not relative)
PROCESSOR_REPO_PATH=/home/username/mra-mine-plans-ds

# Verify path exists
ls $PROCESSOR_REPO_PATH
```

---

#### "Processor repository not found"

**Symptom**:
```bash
⚠ Processor repository not found at: /path/to/mra-mine-plans-ds
⚠ Skipping processor build
```

**Diagnosis**:
```bash
# Check if path exists
ls -la /path/from/your/env

# Verify mra-mine-plans-ds contents
ls /path/from/your/env/build_and_push.sh
```

**Solutions**:
1. **Check Path**: Ensure path in .env is correct
2. **Use Absolute Path**: Not relative paths like `../mra-mine-plans-ds`
3. **Extract Repository**: Ensure mra-mine-plans-ds is extracted/cloned
4. **Check Permissions**: Ensure read access to directory

**Example Correct Paths**:
- ✅ macOS/Linux: `/home/username/mra-mine-plans-ds`
- ✅ Windows Git Bash: `/c/Users/username/mra-mine-plans-ds`
- ❌ Wrong: `../mra-mine-plans-ds` (relative)
- ❌ Wrong: `~/mra-mine-plans-ds` (tilde may not expand)

---

### Docker Issues

#### "Docker daemon not running"

**Symptom**:
```bash
Cannot connect to the Docker daemon at unix:///var/run/docker.sock
Is the docker daemon running?
```

**Solution**:
- **macOS**: Open Docker Desktop application
- **Windows**: Open Docker Desktop application
- **Linux**:
  ```bash
  sudo systemctl start docker
  sudo systemctl enable docker  # Start on boot
  ```

**Verify**:
```bash
docker ps
# Should show container list (may be empty)
```

---

#### "Processor build failed"

**Symptom**: Build fails during Step 4/8.

**Diagnosis**:
```bash
# Check Docker is running
docker info

# Check ECR login
cd deployment-package/infra
AWS_REGION=$(terraform output -raw aws_region)
aws ecr get-login-password --region $AWS_REGION

# Check disk space
df -h
```

**Common Causes**:
- Insufficient disk space (processor image is ~2.5GB)
- Docker daemon not running
- ECR repository not created yet (infrastructure failed)
- Network issues during build

---

### Configuration Issues

#### "terraform.tfvars not found"

**Symptom**:
```bash
ERROR: infra/terraform.tfvars not found
Please create it from terraform.tfvars.example
```

**Solution**:
```bash
cd deployment-package/infra
cp terraform.tfvars.example terraform.tfvars
nano terraform.tfvars
# Configure settings as per deployment guide
```

---

### Certificate Warning in Browser

**Symptom**: Browser shows security warning when accessing application.

**Cause**: ALB uses self-signed certificate.

**Solution**: Click "Advanced" and "Proceed" to continue. This is expected for internal use.

---

### Login Fails with "redirect_mismatch"

**Symptom**: Cognito returns redirect_mismatch error after login.

**Cause**: Callback URL doesn't match ALB DNS.

**Solution**:
```bash
cd infra
terraform output alb_dns_name
# Verify this matches Cognito callback URL
terraform output application_url
```

If mismatch, run `terraform apply` to sync.

---

### ECS Task Not Starting

**Symptom**: Service shows 0 running tasks.

**Diagnosis**:
```bash
cd infra
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw frontend_service_name)
REGION=$(terraform output -raw aws_region)

# Check service events
aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --region $REGION \
  --query 'services[0].events[:5]'

# Check stopped task reason
aws ecs list-tasks --cluster $CLUSTER --desired-status STOPPED --region $REGION
```

**Common Causes**:
- ECR image not found: Run `./build_and_push.sh`
- IAM role missing: Check `use_existing_iam_roles` setting
- Memory/CPU insufficient: Increase in `terraform.tfvars`

---

### "AccessDenied" Errors

**Symptom**: Application shows access denied errors.

**Diagnosis**:
```bash
# Check task role
aws ecs describe-task-definition \
  --task-definition mra-mines-frontend-staging \
  --query 'taskDefinition.taskRoleArn'

# Check role policies
ROLE_NAME="mra-mines-frontend-task-staging"
aws iam list-attached-role-policies --role-name $ROLE_NAME
```

**Solution**: Verify IAM roles have correct permissions for S3, DynamoDB, Cognito.

---

### Upload Fails

**Symptom**: File upload returns error.

**Diagnosis**:
1. Check browser console for errors
2. Check S3 bucket permissions
3. Check Lambda logs:
```bash
aws logs tail /aws/lambda/mra-mines-input-handler-staging --follow
```

**Common Causes**:
- Presigned URL expired (1 hour limit)
- File too large (5GB limit)
- Invalid ZIP format

---

### High Latency

**Symptom**: Application is slow.

**Diagnosis**:
```bash
# Check ECS task health
aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --query 'services[0].{CPU:cpu,Memory:memory,Running:runningCount}'

# Check ALB response times
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name TargetResponseTime \
  --dimensions Name=LoadBalancer,Value=$ALB_ARN \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average
```

**Solutions**:
- Increase ECS CPU/memory
- Check DynamoDB capacity
- Review S3 transfer speeds

---

### Custom Domain Not Working

**Symptom**: Custom domain doesn't resolve or shows certificate error.

**Diagnosis**:
```bash
# Check DNS propagation
dig mine-maps.com

# Check ACM certificate status
cd infra
aws acm describe-certificate \
  --certificate-arn $(terraform output -raw acm_certificate_arn) \
  --query 'Certificate.Status'

# Check Route53 nameservers
terraform output route53_nameservers
```

**Common Causes**:
- DNS not propagated: Wait up to 48 hours
- Nameservers not updated at registrar
- ACM certificate pending validation

**Solution**: Ensure domain registrar nameservers match Route53 output.

---

### Webhook Notifications Not Received

**Symptom**: Configured webhooks don't trigger.

**Diagnosis**:
```bash
# Check webhooks table
aws dynamodb scan --table-name mra-mines-webhooks-staging \
  --query 'Items[*].{Id:webhookId.S,URL:url.S,Status:status.S}'

# Check Lambda logs for webhook delivery
aws logs tail /aws/lambda/mra-mines-output-handler-staging --since 1h
```

**Common Causes**:
- Webhook URL unreachable
- Invalid webhook configuration
- Lambda timeout

---

## Diagnostic Commands

### Check All Services

```bash
cd infra

# ECS
echo "ECS Service:"
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --region $(terraform output -raw aws_region) \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'

# ALB
echo "ALB Health:"
aws elbv2 describe-target-health \
  --target-group-arn $(terraform output -raw frontend_target_group_arn) \
  --region $(terraform output -raw aws_region)

# Cognito
echo "Cognito Pool:"
aws cognito-idp describe-user-pool \
  --user-pool-id $(terraform output -raw cognito_user_pool_id) \
  --region $(terraform output -raw aws_region) \
  --query 'UserPool.Status'
```

### View Recent Logs

```bash
# Frontend logs
aws logs tail /ecs/mra-mines-frontend-staging --since 1h --follow

# Lambda logs
aws logs tail /aws/lambda/mra-mines-input-handler-staging --since 1h
aws logs tail /aws/lambda/mra-mines-output-handler-staging --since 1h
```

### Check Resource Usage

```bash
# DynamoDB
aws dynamodb describe-table --table-name mra-mines-maps-staging \
  --query 'Table.{Items:ItemCount,Size:TableSizeBytes}'

# S3
aws s3 ls s3://mra-mines-map-input-staging --summarize --recursive | tail -2
```

## Quick Diagnostic Checklist

Use this checklist to diagnose deployment issues:

### Pre-Deployment Checks

```bash
# 1. Verify prerequisites
cd deployment-package
./scripts/setup.sh

# 2. Verify .env file exists and is configured
ls -la .env
cat .env | grep -E "(AWS_|PROCESSOR_)"

# 3. Test AWS credentials
./scripts/configure_aws.sh

# 4. Verify processor repository path
ls $PROCESSOR_REPO_PATH/build_and_push.sh

# 5. Verify terraform.tfvars exists
ls infra/terraform.tfvars

# 6. Test Docker
docker ps
docker info
```

### Post-Deployment Diagnostics

```bash
cd deployment-package/infra

# 1. Check all outputs
terraform output

# 2. Check ECS service
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --region $(terraform output -raw aws_region) \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'

# 3. Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn $(terraform output -raw frontend_target_group_arn) \
  --region $(terraform output -raw aws_region)

# 4. Check recent frontend logs
aws logs tail /ecs/mra-mines-frontend-prod --since 30m --region $(terraform output -raw aws_region)

# 5. Check recent Lambda logs
aws logs tail /aws/lambda/mra-mines-input-handler-prod --since 30m --region $(terraform output -raw aws_region)
```

### Environment Validation Script

Create a quick validation script:

```bash
#!/bin/bash
# validate-deployment.sh

echo "=== Deployment Validation ==="
echo ""

# Check .env
echo "1. Checking .env configuration..."
if [ -f ".env" ]; then
    echo "  ✓ .env exists"
    if grep -q "AWS_ACCESS_KEY_ID=" .env && [ -n "$(grep AWS_ACCESS_KEY_ID= .env | cut -d'=' -f2)" ]; then
        echo "  ✓ AWS_ACCESS_KEY_ID is set"
    else
        echo "  ✗ AWS_ACCESS_KEY_ID is missing or empty"
    fi

    if grep -q "PROCESSOR_REPO_PATH=" .env && [ -n "$(grep PROCESSOR_REPO_PATH= .env | cut -d'=' -f2)" ]; then
        echo "  ✓ PROCESSOR_REPO_PATH is set"
    else
        echo "  ✗ PROCESSOR_REPO_PATH is missing or empty"
    fi
else
    echo "  ✗ .env file not found"
fi

echo ""
echo "2. Checking AWS credentials..."
if aws sts get-caller-identity &>/dev/null; then
    echo "  ✓ AWS credentials valid"
else
    echo "  ✗ AWS credentials invalid"
fi

echo ""
echo "3. Checking processor repository..."
source .env 2>/dev/null
if [ -d "$PROCESSOR_REPO_PATH" ]; then
    echo "  ✓ Processor repository found"
    if [ -f "$PROCESSOR_REPO_PATH/build_and_push.sh" ]; then
        echo "  ✓ build_and_push.sh exists"
    else
        echo "  ✗ build_and_push.sh not found"
    fi
else
    echo "  ✗ Processor repository not found at: $PROCESSOR_REPO_PATH"
fi

echo ""
echo "4. Checking Docker..."
if docker ps &>/dev/null; then
    echo "  ✓ Docker is running"
else
    echo "  ✗ Docker is not running"
fi

echo ""
echo "5. Checking terraform.tfvars..."
if [ -f "infra/terraform.tfvars" ]; then
    echo "  ✓ terraform.tfvars exists"
else
    echo "  ✗ terraform.tfvars not found"
fi

echo ""
echo "=== Validation Complete ==="
```

## Getting Help

1. **Run validation script** (above)
2. **Check logs** for specific errors
3. **Verify AWS credentials**: `./scripts/configure_aws.sh`
4. **Check Terraform state**: `cd infra && terraform state list`
5. **Review deployment output** for error messages
6. **Consult documentation**:
   - Complete guide: `CLIENT_DEPLOYMENT_GUIDE.md`
   - Quick start: `DEPLOYMENT_QUICKSTART.md`
   - This troubleshooting guide
7. **Check AWS Service Health**: https://status.aws.amazon.com/
