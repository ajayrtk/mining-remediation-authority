# MRA Mines Map - Maintenance Guide

## Resource Naming Convention

All AWS resources follow this naming pattern:
```
{project_name}-{resource_name}-{environment}
```

**Set these variables for commands in this guide:**
```bash
# Navigate to infra directory
cd infra

# Set variables from terraform.tfvars
export PROJECT=$(terraform output -raw project_name 2>/dev/null || echo "mra-mines")
export ENV=$(terraform output -raw environment 2>/dev/null || echo "staging")
export REGION=$(terraform output -raw aws_region)

# Verify
echo "Project: $PROJECT"
echo "Environment: $ENV"
echo "Region: $REGION"
```

**Common resource names will be:**
- ECS Cluster: `${PROJECT}-cluster-${ENV}`
- Frontend Service: `${PROJECT}-frontend-${ENV}`
- Processor: `${PROJECT}-processor-${ENV}`
- Lambda Functions: `${PROJECT}-{function-name}-${ENV}`

---

## Table of Contents
1. [Daily Operations](#daily-operations)
2. [Updating the Application](#updating-the-application)
3. [Monitoring and Logging](#monitoring-and-logging)
4. [Backup and Restore](#backup-and-restore)
5. [Scaling Resources](#scaling-resources)
6. [Security Maintenance](#security-maintenance)
7. [Cost Management](#cost-management)
8. [Performance Optimization](#performance-optimization)
9. [Troubleshooting](#troubleshooting)
10. [Emergency Procedures](#emergency-procedures)

---

## Daily Operations

### Health Checks

Perform these checks daily or set up automated monitoring:

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster ${PROJECT}-cluster-${ENV} \
  --services ${PROJECT}-frontend-${ENV} \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table \
  --region $REGION

# Check CloudFront distribution status
aws cloudfront get-distribution \
  --id $(cd infra && terraform output -raw cloudfront_distribution_id) \
  --query 'Distribution.Status' \
  --output text

# Check recent errors in logs
aws logs filter-log-events \
  --log-group-name /ecs/${PROJECT}-frontend-${ENV} \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern "ERROR" \
  --region $REGION
```

### User Management

**Add a new user:**
```bash
POOL_ID=$(cd infra && terraform output -raw cognito_user_pool_id)

aws cognito-idp admin-create-user \
  --user-pool-id $POOL_ID \
  --username user@example.com \
  --user-attributes Name=email,Value=user@example.com \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id $POOL_ID \
  --username user@example.com \
  --password 'TempPassword123!' \
  --permanent
```

**Disable a user:**
```bash
aws cognito-idp admin-disable-user \
  --user-pool-id $POOL_ID \
  --username user@example.com
```

**Delete a user:**
```bash
aws cognito-idp admin-delete-user \
  --user-pool-id $POOL_ID \
  --username user@example.com
```

**List all users:**
```bash
aws cognito-idp list-users \
  --user-pool-id $POOL_ID \
  --query 'Users[*].{Username:Username,Email:Attributes[?Name==`email`].Value|[0],Status:UserStatus}' \
  --output table
```

### Data Management

**Check storage usage:**
```bash
# Check S3 bucket sizes
aws s3 ls s3://$(cd infra && terraform output -raw map_input_bucket_name) \
  --recursive --summarize --human-readable

aws s3 ls s3://$(cd infra && terraform output -raw map_output_bucket_name) \
  --recursive --summarize --human-readable

# Check DynamoDB table sizes
aws dynamodb describe-table \
  --table-name maps \
  --query 'Table.{Name:TableName,ItemCount:ItemCount,SizeBytes:TableSizeBytes}' \
  --output table
```

**Clean up old uploads:**
```bash
# Delete files older than 90 days from input bucket
aws s3 ls s3://$(cd infra && terraform output -raw map_input_bucket_name) \
  --recursive | \
  awk -v date="$(date -d '90 days ago' +%Y-%m-%d)" '$1 < date {print $4}' | \
  xargs -I {} aws s3 rm s3://$(cd infra && terraform output -raw map_input_bucket_name)/{}
```

---

## Updating the Application

### Frontend Updates

When you need to update the frontend code:

```bash
cd frontend

# 1. Make your code changes
# 2. Test locally
npm install
npm run dev

# 3. Build and deploy
npm run build
cd ../infra
./build_and_push.sh

# 4. Force ECS service update
aws ecs update-service \
  --cluster ${PROJECT}-cluster-${ENV} \
  --service ${PROJECT}-frontend-${ENV} \
  --force-new-deployment \
  --region $REGION

# 5. Wait for deployment (2-3 minutes)
aws ecs wait services-stable \
  --cluster ${PROJECT}-cluster-${ENV} \
  --services ${PROJECT}-frontend-${ENV} \
  --region $REGION

# 6. Get new task DNS and update CloudFront
NEW_TASK=$(aws ecs list-tasks --cluster ${PROJECT}-cluster-${ENV} --service-name ${PROJECT}-frontend-${ENV} --query 'taskArns[0]' --output text --region $REGION)
TASK_ID=$(echo $NEW_TASK | awk -F/ '{print $NF}')
TASK_DNS=$(aws ecs describe-tasks --cluster ${PROJECT}-cluster-${ENV} --tasks $TASK_ID --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text --region $REGION | xargs -I {} aws ec2 describe-network-interfaces --network-interface-ids {} --query 'NetworkInterfaces[0].Association.PublicDnsName' --output text --region $REGION)

# Apply with new origin
terraform apply -var="frontend_origin_domain=$TASK_DNS" -auto-approve

# 7. Invalidate CloudFront cache
DIST_ID=$(terraform output -raw cloudfront_distribution_id)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

### Lambda Function Updates

To update Lambda functions:

```bash
cd backend/lambda/<function-name>

# 1. Make code changes
# 2. Update function code (example: input-handler)
zip -r function.zip .
aws lambda update-function-code \
  --function-name ${PROJECT}-input-handler-${ENV} \
  --zip-file fileb://function.zip \
  --region $REGION

# 3. Wait for update to complete
aws lambda wait function-updated \
  --function-name ${PROJECT}-input-handler-${ENV} \
  --region $REGION

# 4. Verify
aws lambda get-function \
  --function-name ${PROJECT}-input-handler-${ENV} \
  --query 'Configuration.LastModified' \
  --region $REGION
```

### Infrastructure Updates

For Terraform infrastructure changes:

```bash
cd infra

# 1. Make changes to .tf files
# 2. Validate syntax
terraform validate

# 3. Plan changes
terraform plan -out=tfplan

# 4. Review plan carefully
# 5. Apply changes
terraform apply tfplan

# 6. Verify outputs
terraform output
```

**Important**: Some infrastructure changes (like VPC changes) may cause downtime. Schedule during maintenance windows.

### Database Schema Updates

DynamoDB is schemaless, but if you need to add attributes:

```bash
# Add a new Global Secondary Index (if needed)
aws dynamodb update-table \
  --table-name maps \
  --attribute-definitions AttributeName=newAttribute,AttributeType=S \
  --global-secondary-index-updates \
    "[{\"Create\":{\"IndexName\":\"newIndex\",\"KeySchema\":[{\"AttributeName\":\"newAttribute\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"ALL\"},\"ProvisionedThroughput\":{\"ReadCapacityUnits\":5,\"WriteCapacityUnits\":5}}}]"
```

**Caution**: Index creation can take several minutes. Monitor progress:
```bash
aws dynamodb describe-table --table-name maps --query 'Table.GlobalSecondaryIndexes[*].IndexStatus'
```

---

## Monitoring and Logging

### CloudWatch Dashboards

Create a custom dashboard:

```bash
# Create dashboard (save as dashboard.json first)
aws cloudwatch put-dashboard \
  --dashboard-name MRA-Mines-Dashboard \
  --dashboard-body file://dashboard.json
```

**Sample dashboard.json:**
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/ECS", "CPUUtilization", { "stat": "Average" } ],
          [ ".", "MemoryUtilization", { "stat": "Average" } ]
        ],
        "period": 300,
        "stat": "Average",
        "region": "eu-west-1",
        "title": "ECS Resource Utilization"
      }
    }
  ]
}
```

### Log Analysis

**View real-time logs:**
```bash
# Frontend logs
aws logs tail /ecs/${PROJECT}-frontend-${ENV} --follow --region $REGION

# Processor logs
aws logs tail /ecs/${PROJECT}-processor-${ENV} --follow --region $REGION

# Lambda logs (example: input-handler)
aws logs tail /aws/lambda/${PROJECT}-input-handler-${ENV} --follow --region $REGION

# Filter for errors
aws logs tail /ecs/${PROJECT}-frontend-${ENV} --follow --filter-pattern "ERROR" --region $REGION
```

**Search logs:**
```bash
# Search for specific text in frontend logs
aws logs filter-log-events \
  --log-group-name /ecs/${PROJECT}-frontend-${ENV} \
  --start-time $(date -u -d '24 hours ago' +%s)000 \
  --filter-pattern "AccessDenied" \
  --region $REGION

# Export logs to S3
aws logs create-export-task \
  --log-group-name /ecs/${PROJECT}-frontend-${ENV} \
  --from $(date -u -d '7 days ago' +%s)000 \
  --to $(date -u +%s)000 \
  --destination YOUR_BUCKET_NAME \
  --destination-prefix logs/ \
  --region $REGION
```

### CloudWatch Alarms

Set up automated alerts:

```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name ${PROJECT}-high-cpu-${ENV} \
  --alarm-description "Alert when CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --region $REGION

# Lambda errors alarm
aws cloudwatch put-metric-alarm \
  --alarm-name ${PROJECT}-lambda-errors-${ENV} \
  --alarm-description "Alert on Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 60 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --region $REGION
```

### Performance Monitoring

**Check CloudFront performance:**
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name Requests \
  --dimensions Name=DistributionId,Value=$(cd infra && terraform output -raw cloudfront_distribution_id) \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --output table
```

**Check DynamoDB performance:**
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=maps \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --output table
```

---

## Backup and Restore

### DynamoDB Backups

**Create on-demand backup:**
```bash
# Backup maps table
aws dynamodb create-backup \
  --table-name maps \
  --backup-name maps-backup-$(date +%Y%m%d-%H%M%S)

# Backup map-jobs table
aws dynamodb create-backup \
  --table-name map-jobs \
  --backup-name map-jobs-backup-$(date +%Y%m%d-%H%M%S)

# List backups
aws dynamodb list-backups --table-name maps
```

**Restore from backup:**
```bash
# Get backup ARN
BACKUP_ARN=$(aws dynamodb list-backups --table-name maps --query 'BackupSummaries[0].BackupArn' --output text)

# Restore to new table
aws dynamodb restore-table-from-backup \
  --target-table-name maps-restored \
  --backup-arn $BACKUP_ARN

# Wait for restore to complete
aws dynamodb wait table-exists --table-name maps-restored
```

**Enable Point-in-Time Recovery (PITR):**
```bash
aws dynamodb update-continuous-backups \
  --table-name maps \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

**Cost**: PITR adds ~$0.20/GB-month to DynamoDB costs.

### S3 Backups

S3 versioning is already enabled. To restore a deleted file:

```bash
# List versions
aws s3api list-object-versions \
  --bucket $(cd infra && terraform output -raw map_input_bucket_name) \
  --prefix path/to/file.zip

# Restore specific version
aws s3api copy-object \
  --copy-source BUCKET/path/to/file.zip?versionId=VERSION_ID \
  --bucket BUCKET \
  --key path/to/file.zip
```

### Terraform State Backup

**CRITICAL**: Always backup Terraform state before major changes:

```bash
cd infra

# Backup state file
cp terraform.tfstate terraform.tfstate.backup-$(date +%Y%m%d-%H%M%S)

# For remote state (recommended for production):
terraform state pull > terraform.tfstate.backup-$(date +%Y%m%d-%H%M%S)
```

**Restore state:**
```bash
# Local state
cp terraform.tfstate.backup-TIMESTAMP terraform.tfstate

# Remote state
terraform state push terraform.tfstate.backup-TIMESTAMP
```

---

## Scaling Resources

### ECS Service Scaling

**Manual scaling:**
```bash
# Scale up
aws ecs update-service \
  --cluster ${PROJECT}-cluster-${ENV} \
  --service ${PROJECT}-frontend-${ENV} \
  --desired-count 3 \
  --region $REGION

# Scale down
aws ecs update-service \
  --cluster ${PROJECT}-cluster-${ENV} \
  --service ${PROJECT}-frontend-${ENV} \
  --desired-count 1 \
  --region $REGION
```

**Auto-scaling (via Terraform):**

Edit `infra/frontend_ecs_simple.tf`:
```hcl
resource "aws_appautoscaling_target" "ecs_target" {
  max_capacity       = 10
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.frontend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_policy" {
  name               = "ecs-scale-policy"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_target.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_target.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
  }
}
```

### Increase ECS Task Resources

Edit `terraform.tfvars`:
```hcl
# Increase CPU/Memory
ecs_frontend_cpu    = "512"   # from 256
ecs_frontend_memory = "1024"  # from 512
```

Apply changes:
```bash
cd infra
terraform apply
```

**Cost impact**: ~$15/month increase

### DynamoDB Capacity

For high-traffic scenarios, switch to provisioned capacity:

Edit `terraform.tfvars`:
```hcl
dynamodb_billing_mode = "PROVISIONED"
dynamodb_read_capacity = 10
dynamodb_write_capacity = 10
```

**Monitor throttling:**
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name UserErrors \
  --dimensions Name=TableName,Value=maps \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

---

## Security Maintenance

### Regular Security Tasks

**Weekly:**
- Review CloudWatch logs for suspicious activity
- Check failed login attempts in Cognito
- Review IAM policies for unnecessary permissions

**Monthly:**
- Rotate AWS access keys
- Review user access (remove inactive users)
- Update dependencies (`npm audit` in frontend)
- Review S3 bucket permissions

**Quarterly:**
- Security audit of all IAM roles
- Review and update security groups
- Penetration testing (if required)

### Security Checks

**Check for public S3 buckets:**
```bash
aws s3api get-public-access-block \
  --bucket $(cd infra && terraform output -raw map_input_bucket_name)

# Should show: BlockPublicAcls: true
```

**Check security group rules:**
```bash
# List all security groups
aws ec2 describe-security-groups \
  --filters "Name=tag:Project,Values=mra-mines" \
  --query 'SecurityGroups[*].{ID:GroupId,Name:GroupName,Ingress:IpPermissions}' \
  --output table
```

**Enable CloudTrail (for audit logging):**
```bash
aws cloudtrail create-trail \
  --name mra-mines-audit \
  --s3-bucket-name your-cloudtrail-bucket

aws cloudtrail start-logging --name mra-mines-audit
```

### Update Dependencies

**Frontend:**
```bash
cd frontend

# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix

# Update packages
npm update

# Rebuild and redeploy
npm run build
cd ../infra
./build_and_push.sh
```

**Lambda:**
```bash
cd backend/lambda/input-handler

# Update Node.js runtime (if needed)
aws lambda update-function-configuration \
  --function-name mra-mines-dev-input-handler \
  --runtime nodejs20.x
```

---

## Cost Management

### Monitor Costs

**Get current month costs:**
```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
  --granularity DAILY \
  --metrics "UnblendedCost" \
  --group-by Type=SERVICE \
  --output table
```

**Set up cost alerts:**
```bash
# Create budget
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget file://budget.json \
  --notifications-with-subscribers file://notifications.json
```

**budget.json:**
```json
{
  "BudgetName": "MRA-Mines-Monthly",
  "BudgetLimit": {
    "Amount": "100",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
```

### Cost Optimization Tips

**1. CloudFront caching:**
```bash
# Check cache hit rate
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=$(cd infra && terraform output -raw cloudfront_distribution_id) \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Average
```

Target: >80% cache hit rate

**2. S3 lifecycle policies:**

Already configured, but verify:
```bash
aws s3api get-bucket-lifecycle-configuration \
  --bucket $(cd infra && terraform output -raw map_input_bucket_name)
```

**3. Clean up old ECR images:**
```bash
# Delete untagged images
aws ecr describe-images \
  --repository-name mra-mines-dev-frontend \
  --query 'imageDetails[?imageTags==null].imageDigest' \
  --output text | \
  xargs -I {} aws ecr batch-delete-image \
    --repository-name mra-mines-dev-frontend \
    --image-ids imageDigest={}
```

**4. Stop non-production resources:**

For dev/staging environments:
```bash
# Stop ECS service (keeps infrastructure, stops tasks)
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --desired-count 0
```

---

## Performance Optimization

### Frontend Performance

**Enable compression in CloudFront:**

Already enabled via `compress = true` in Terraform.

**Optimize images:**

If users upload large images, consider adding image optimization:
```bash
# Install Sharp in Lambda
cd backend/lambda/processor
npm install sharp

# Add image optimization code
```

**Monitor page load times:**

Use CloudWatch RUM (Real User Monitoring):
```bash
aws rum create-app-monitor \
  --name mra-mines-monitor \
  --domain d3n47138ce9sz5.cloudfront.net \
  --app-monitor-configuration '{
    "AllowCookies": true,
    "EnableXRay": true,
    "SessionSampleRate": 1.0,
    "Telemetries": ["errors", "performance", "http"]
  }'
```

### Database Performance

**Add indexes for common queries:**

If you frequently query by ownerEmail:
```bash
aws dynamodb update-table \
  --table-name maps \
  --attribute-definitions AttributeName=ownerEmail,AttributeType=S \
  --global-secondary-index-updates \
    "[{\"Create\":{\"IndexName\":\"ownerEmailIndex\",\"KeySchema\":[{\"AttributeName\":\"ownerEmail\",\"KeyType\":\"HASH\"}],\"Projection\":{\"ProjectionType\":\"ALL\"}}}]"
```

**Monitor hot partitions:**
```bash
aws dynamodb describe-table-replica-auto-scaling \
  --table-name maps
```

### Lambda Optimization

**Increase memory for faster execution:**
```bash
aws lambda update-function-configuration \
  --function-name mra-mines-dev-input-handler \
  --memory-size 1024  # from 512
```

**Note**: More memory = more CPU = faster execution, potentially lower cost overall.

---

## Troubleshooting

### Frontend Not Accessible

**Check ECS task status:**
```bash
aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --query 'services[0].events[0:5]'
```

**Common issues:**
- Task failing health checks → Check logs
- No running tasks → Check desired count
- Wrong security group → Verify port 3000 is open

**Quick fix:**
```bash
# Force new deployment
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --force-new-deployment
```

### Login Not Working

**Verify Cognito configuration:**
```bash
POOL_ID=$(cd infra && terraform output -raw cognito_user_pool_id)
aws cognito-idp describe-user-pool --user-pool-id $POOL_ID \
  --query 'UserPool.{Domain:Domain,CallbackURLs:UserPoolAddOns}'
```

**Check callback URLs match:**
- Should include CloudFront URL
- Should use HTTPS

**Fix:**
```bash
cd infra
terraform apply
```

### File Upload Failing

**Check S3 bucket:**
```bash
aws s3 ls s3://$(cd infra && terraform output -raw map_input_bucket_name)
```

**Check Lambda logs:**
```bash
aws logs tail /aws/lambda/mra-mines-dev-input-handler --follow
```

**Common issues:**
- Bucket permission denied → Check IAM role
- Lambda timeout → Increase timeout
- File too large → Check size limits

### High Costs

**Identify cost drivers:**
```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '30 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics "UnblendedCost" "UsageQuantity" \
  --group-by Type=SERVICE \
  --output table
```

**Common causes:**
- CloudFront data transfer (optimize caching)
- ECS over-provisioned (reduce CPU/memory)
- DynamoDB throughput (switch to on-demand)
- Old S3 files (check lifecycle policies)

---

## Emergency Procedures

### Complete System Outage

**1. Check AWS Service Health:**
```bash
aws health describe-events --filter eventTypeCategories=issue
```

**2. Verify core services:**
```bash
# ECS
aws ecs describe-services --cluster mra-mines-cluster --services mra-mines-dev-frontend

# CloudFront
aws cloudfront get-distribution --id $(cd infra && terraform output -raw cloudfront_distribution_id)

# DynamoDB
aws dynamodb describe-table --table-name maps
```

**3. Rollback to previous version:**
```bash
cd infra
# Get previous task definition
PREV_TASK_DEF=$(aws ecs describe-services \
  --cluster mra-mines-cluster \
  --services mra-mines-dev-frontend \
  --query 'services[0].deployments[-2].taskDefinition' \
  --output text)

# Update service to use previous definition
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --task-definition $PREV_TASK_DEF
```

### Data Corruption

**1. Stop all writes:**
```bash
# Scale service to 0 (stops accepting uploads)
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --desired-count 0
```

**2. Restore from backup:**
```bash
# List recent backups
aws dynamodb list-backups --table-name maps --time-range-lower-bound $(date -d '7 days ago' +%s)

# Restore (see Backup section)
```

**3. Verify data:**
```bash
# Scan restored table
aws dynamodb scan --table-name maps-restored --max-items 10
```

**4. Resume operations:**
```bash
# Scale service back up
aws ecs update-service \
  --cluster mra-mines-cluster \
  --service mra-mines-dev-frontend \
  --desired-count 1
```

### Security Breach

**1. Immediate actions:**
```bash
# Disable compromised user
aws cognito-idp admin-disable-user --user-pool-id $POOL_ID --username compromised@example.com

# Rotate access keys
aws iam delete-access-key --access-key-id COMPROMISED_KEY_ID --user-name IAM_USER

# Review CloudTrail logs
aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=COMPROMISED_USER
```

**2. Containment:**
```bash
# Block public access to S3
aws s3api put-public-access-block \
  --bucket $(cd infra && terraform output -raw map_input_bucket_name) \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

**3. Investigation:**
```bash
# Export logs for forensics
aws logs create-export-task \
  --log-group-name /ecs/mra-mines-dev-frontend \
  --from $(date -d '7 days ago' +%s)000 \
  --to $(date +%s)000 \
  --destination security-investigation-bucket
```

---

## Support and Escalation

### Internal Support Tiers

**Tier 1**: Application issues
- Check logs
- Restart services
- Review recent changes

**Tier 2**: Infrastructure issues
- Review Terraform state
- Check AWS service limits
- Analyze performance metrics

**Tier 3**: Critical outages
- AWS Support (if you have a support plan)
- Emergency rollback procedures
- Disaster recovery activation

### AWS Support

If you have AWS Support:
```bash
# Open support case
aws support create-case \
  --subject "MRA Mines Map Production Issue" \
  --service-code "elastic-compute-cloud" \
  --severity-code "urgent" \
  --category-code "performance" \
  --communication-body "Description of issue..."
```

### Contact Information

Keep an updated contact list:
- AWS Account Admin
- Infrastructure Team
- Application Developers
- Security Team
- Business Stakeholders

---

## Maintenance Schedule

### Daily
- [ ] Check service health
- [ ] Review error logs
- [ ] Monitor costs

### Weekly
- [ ] Review user activity
- [ ] Check storage usage
- [ ] Review security logs
- [ ] Test backup restoration

### Monthly
- [ ] Update dependencies
- [ ] Review IAM permissions
- [ ] Clean up old resources
- [ ] Review and optimize costs
- [ ] Performance testing
- [ ] Security audit

### Quarterly
- [ ] Disaster recovery drill
- [ ] Capacity planning review
- [ ] Security penetration testing
- [ ] Infrastructure optimization review
- [ ] Documentation updates

---

**Maintenance guide last updated:** 2025-11-06
