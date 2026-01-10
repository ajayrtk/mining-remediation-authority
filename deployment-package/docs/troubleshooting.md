# Troubleshooting

## Common Issues

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

## Getting Help

1. Check logs first
2. Verify AWS credentials: `aws sts get-caller-identity`
3. Check Terraform state: `terraform state list`
4. Review recent changes: `git log --oneline -10`
