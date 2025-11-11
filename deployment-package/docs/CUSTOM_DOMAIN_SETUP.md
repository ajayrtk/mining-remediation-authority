# Custom Domain + ACM Certificate Setup Guide

## Overview

This guide provides step-by-step instructions for setting up a custom domain with AWS Certificate Manager (ACM) SSL certificate for the MRA Mines application. This replaces the self-signed certificate with a trusted SSL certificate that works on all networks, including corporate networks with strict SSL policies.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Step 1: Register Domain in Route 53](#step-1-register-domain-in-route-53)
4. [Step 2: Request ACM Certificate](#step-2-request-acm-certificate)
5. [Step 3: Validate Certificate](#step-3-validate-certificate)
6. [Step 4: Update Terraform Configuration](#step-4-update-terraform-configuration)
7. [Step 5: Deploy Changes](#step-5-deploy-changes)
8. [Step 6: Verify Setup](#step-6-verify-setup)
9. [Troubleshooting](#troubleshooting)
10. [Cost Analysis](#cost-analysis)

---

## Prerequisites

- AWS Account with administrative access
- Current MRA Mines infrastructure deployed
- AWS CLI configured with appropriate credentials
- Terraform installed (already in use)
- Domain name decided (e.g., `mra-mines.com` or `maps.yourcompany.com`)

---

## Architecture Overview

### Current Setup
```
User → ALB (self-signed HTTPS) → ECS Tasks
        ❌ Certificate warning on corporate networks
```

### New Setup
```
User → Custom Domain (maps.yourdomain.com)
     → Route 53 DNS
     → ALB (ACM HTTPS Certificate - Trusted)
     → ECS Tasks
        ✅ No certificate warnings anywhere
```

**Key Changes:**
- Add Route 53 Hosted Zone
- Register/configure custom domain
- Replace self-signed certificate with ACM certificate
- Update Cognito callback URLs
- Update application ORIGIN configuration

---

## Step 1: Register Domain in Route 53

### Option A: Register New Domain in Route 53

1. **Navigate to Route 53**
   ```
   AWS Console → Route 53 → Registered domains → Register domain
   ```

2. **Search and Select Domain**
   - Search for your desired domain (e.g., `mra-mines.com`)
   - Check availability
   - Add to cart
   - Cost: $12-13/year for .com domain

3. **Complete Registration**
   - Fill in contact information
   - Enable auto-renewal (recommended)
   - Review and complete purchase
   - **Wait time: 5-10 minutes for registration to complete**

4. **Verify Hosted Zone Created**
   ```
   Route 53 → Hosted zones → Verify zone exists for your domain
   ```
   - Route 53 automatically creates a hosted zone upon domain registration
   - Note down the **Hosted Zone ID** and **Name Servers**

### Option B: Use Existing External Domain

If you already have a domain registered elsewhere (Namecheap, GoDaddy, etc.):

1. **Create Hosted Zone in Route 53**
   ```
   Route 53 → Hosted zones → Create hosted zone
   ```
   - Domain name: `yourdomain.com`
   - Type: Public hosted zone
   - Click "Create hosted zone"

2. **Update Domain Name Servers**
   - Route 53 will provide 4 name servers (e.g., `ns-123.awsdns-12.com`)
   - Go to your domain registrar (Namecheap, GoDaddy, etc.)
   - Update domain name servers to use Route 53's name servers
   - **Wait time: 24-48 hours for DNS propagation**

### Option C: Use Subdomain of Company Domain

If using a subdomain of existing company domain (e.g., `maps.companyname.com`):

1. **Contact IT/DNS Administrator**
   - Request subdomain: `maps.companyname.com`
   - Request NS record delegation to Route 53

2. **Create Hosted Zone for Subdomain**
   ```
   Route 53 → Hosted zones → Create hosted zone
   ```
   - Domain name: `maps.companyname.com`
   - Type: Public hosted zone

3. **Provide Name Servers to IT**
   - Share the 4 Route 53 name servers with IT
   - IT will add NS records in parent domain DNS

---

## Step 2: Request ACM Certificate

### Important Note
ACM certificates for ALB **MUST** be requested in the **same region as the ALB**.

Current region: **eu-west-2** (London)

### Steps

1. **Navigate to Certificate Manager**
   ```
   AWS Console → Certificate Manager
   ```
   - **CRITICAL: Ensure you're in eu-west-2 region** (top-right corner)

2. **Request Certificate**
   - Click "Request certificate"
   - Select "Request a public certificate"
   - Click "Next"

3. **Add Domain Names**

   **For main domain:**
   ```
   Fully qualified domain name: yourdomain.com
   Add another name to this certificate: www.yourdomain.com
   ```

   **For subdomain:**
   ```
   Fully qualified domain name: maps.yourdomain.com
   ```

   **Pro tip:** Add wildcard for flexibility (optional)
   ```
   Fully qualified domain name: yourdomain.com
   Add another name: *.yourdomain.com
   ```

4. **Select Validation Method**
   - Choose **DNS validation** (recommended)
   - Reason: Automatic and works with Route 53
   - Click "Request"

5. **Certificate Status**
   - Status will show "Pending validation"
   - Note the Certificate ARN (you'll need this later)
   - **Do not close this page yet - proceed to Step 3**

---

## Step 3: Validate Certificate

### Automatic Validation (If domain is in Route 53)

1. **View Certificate Details**
   - Click on the certificate ID
   - Scroll to "Domains" section
   - You'll see CNAME records needed for validation

2. **Create DNS Records in Route 53**
   - Click "Create records in Route 53" button
   - AWS will automatically add validation records
   - Click "Create records"
   - **Wait time: 5-30 minutes for validation**

3. **Monitor Validation Status**
   ```bash
   # Using AWS CLI
   aws acm describe-certificate \
     --certificate-arn arn:aws:acm:eu-west-2:ACCOUNT_ID:certificate/CERT_ID \
     --region eu-west-2 \
     --query 'Certificate.Status'
   ```

   Expected output: `"ISSUED"`

### Manual Validation (If domain is external)

1. **Get Validation Records**
   - Certificate Manager → Your certificate → Domains section
   - Copy the CNAME name and value

   Example:
   ```
   Name: _abc123def.yourdomain.com
   Value: _xyz789uvw.acm-validations.aws.
   ```

2. **Add Records to Route 53**
   ```
   Route 53 → Hosted zones → Your domain → Create record
   ```
   - Record name: `_abc123def` (without domain)
   - Record type: CNAME
   - Value: `_xyz789uvw.acm-validations.aws.`
   - TTL: 300
   - Click "Create records"

3. **Wait for Validation**
   - Refresh certificate status page
   - Usually takes 5-30 minutes
   - **Certificate must show "Issued" status before proceeding**

---

## Step 4: Update Terraform Configuration

### File 1: `infra/variables.tf`

Add new variable for domain configuration:

```hcl
variable "domain_name" {
  description = "Custom domain name for the application (leave empty to use ALB DNS)"
  type        = string
  default     = ""

  validation {
    condition     = var.domain_name == "" || can(regex("^[a-z0-9][a-z0-9-\\.]*[a-z0-9]$", var.domain_name))
    error_message = "Domain name must be a valid DNS name"
  }
}

variable "route53_zone_id" {
  description = "Route 53 Hosted Zone ID (required if domain_name is set)"
  type        = string
  default     = ""
}

variable "use_route53_alias" {
  description = "Use Route 53 alias record instead of CNAME (recommended for apex domain)"
  type        = bool
  default     = true
}
```

### File 2: `infra/terraform.tfvars`

Add your domain configuration:

```hcl
# Custom Domain Configuration (uncomment and fill when ready)
domain_name       = "maps.yourdomain.com"     # Your domain here
route53_zone_id   = "Z1234567890ABC"          # Your hosted zone ID
use_route53_alias = true
```

**To find your Hosted Zone ID:**
```bash
aws route53 list-hosted-zones --query 'HostedZones[?Name==`yourdomain.com.`].Id' --output text
```

### File 3: `infra/locals.tf`

Create new file or add to existing locals:

```hcl
locals {
  # Application domain logic
  app_domain = var.domain_name != "" ? var.domain_name : aws_lb.frontend.dns_name

  # Cognito region
  cognito_region = var.aws_region

  # Common tags
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}
```

### File 4: `infra/acm.tf`

Create new file for ACM certificate lookup:

```hcl
# =====================================================
# ACM Certificate Configuration
# =====================================================
# Looks up existing ACM certificate if domain is configured
# Falls back to self-signed certificate if no domain

# Data source to lookup ACM certificate
data "aws_acm_certificate" "alb" {
  count    = var.domain_name != "" ? 1 : 0
  domain   = var.domain_name
  statuses = ["ISSUED"]

  # Ensure certificate is in the same region as ALB
  provider = aws
}

# Output certificate details for verification
output "acm_certificate_arn" {
  description = "ARN of the ACM certificate being used"
  value       = var.domain_name != "" ? data.aws_acm_certificate.alb[0].arn : aws_acm_certificate.alb_self_signed.arn
}

output "acm_certificate_status" {
  description = "Status of ACM certificate"
  value       = var.domain_name != "" ? "Using ACM Certificate" : "Using Self-Signed Certificate"
}
```

### File 5: `infra/route53.tf`

Create new file for Route 53 DNS configuration:

```hcl
# =====================================================
# Route 53 DNS Configuration
# =====================================================
# Creates DNS records pointing to ALB

# Data source for Route 53 hosted zone
data "aws_route53_zone" "main" {
  count   = var.domain_name != "" ? 1 : 0
  zone_id = var.route53_zone_id
}

# A record (Alias) pointing to ALB
resource "aws_route53_record" "app" {
  count   = var.domain_name != "" && var.use_route53_alias ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.frontend.dns_name
    zone_id                = aws_lb.frontend.zone_id
    evaluate_target_health = true
  }
}

# CNAME record pointing to ALB (alternative to Alias)
resource "aws_route53_record" "app_cname" {
  count   = var.domain_name != "" && !var.use_route53_alias ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = 300
  records = [aws_lb.frontend.dns_name]
}

# Outputs
output "dns_records_created" {
  description = "DNS records created for the application"
  value = var.domain_name != "" ? {
    domain      = var.domain_name
    record_type = var.use_route53_alias ? "A (Alias)" : "CNAME"
    target      = aws_lb.frontend.dns_name
  } : null
}
```

### File 6: `infra/alb.tf`

Update HTTPS listener to use ACM certificate:

**Find this section (around line 147):**
```hcl
# ALB Listener - HTTPS on port 443 (primary)
resource "aws_lb_listener" "frontend_https" {
  load_balancer_arn = aws_lb.frontend.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.alb_self_signed.arn
```

**Replace with:**
```hcl
# ALB Listener - HTTPS on port 443 (primary)
resource "aws_lb_listener" "frontend_https" {
  load_balancer_arn = aws_lb.frontend.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  # Use ACM certificate if domain configured, otherwise self-signed
  certificate_arn = var.domain_name != "" ? data.aws_acm_certificate.alb[0].arn : aws_acm_certificate.alb_self_signed.arn
```

### File 7: `infra/cognito.tf`

Update Cognito callback URLs to use custom domain:

**Find the callback_urls section (around line 71):**
```hcl
callback_urls = [
  "http://localhost:5173/auth/callback",
  "https://${aws_lb.frontend.dns_name}/auth/callback"
]
logout_urls = [
  "http://localhost:5173/",
  "https://${aws_lb.frontend.dns_name}/"
]
```

**Replace with:**
```hcl
callback_urls = [
  "http://localhost:5173/auth/callback",
  "https://${local.app_domain}/auth/callback"
]
logout_urls = [
  "http://localhost:5173/",
  "https://${local.app_domain}/"
]
```

### File 8: `infra/frontend_ecs_simple.tf`

Update ECS task ORIGIN environment variable (around line 246):

**Find:**
```hcl
{
  name  = "ORIGIN"
  value = "https://${aws_lb.frontend.dns_name}"
}
```

**Replace with:**
```hcl
{
  name  = "ORIGIN"
  value = "https://${local.app_domain}"
}
```

### File 9: `infra/outputs.tf`

Update application URL output:

**Find (around line 102):**
```hcl
output "application_url" {
  value       = "https://${aws_lb.frontend.dns_name}"
  description = "⭐ Main application URL (HTTPS) - Use this to access the application"
}
```

**Replace with:**
```hcl
output "application_url" {
  value       = "https://${local.app_domain}"
  description = "⭐ Main application URL (HTTPS) - Use this to access the application"
}

output "application_alb_url" {
  value       = "https://${aws_lb.frontend.dns_name}"
  description = "🔧 ALB direct URL (for debugging)"
}

output "domain_configuration" {
  description = "Domain and certificate configuration status"
  value = {
    using_custom_domain = var.domain_name != ""
    domain              = var.domain_name != "" ? var.domain_name : "Using ALB DNS"
    certificate_type    = var.domain_name != "" ? "ACM Certificate" : "Self-Signed Certificate"
    dns_configured      = var.domain_name != "" && var.route53_zone_id != ""
  }
}
```

---

## Step 5: Deploy Changes

### 5.1 Validate Terraform Configuration

```bash
cd /Users/ajay.rawat/Projects-Hartree/MRA-Mines/final-mra-maps-project/deployment-package/infra

# Format Terraform files
terraform fmt -recursive

# Validate configuration
terraform validate
```

Expected output:
```
Success! The configuration is valid.
```

### 5.2 Review Terraform Plan

```bash
terraform plan
```

**Review carefully - you should see:**
- ✅ ACM certificate data source lookup
- ✅ Route 53 A/CNAME record creation
- ✅ ALB listener certificate_arn update
- ✅ Cognito client callback URLs update
- ✅ ECS task definition update (ORIGIN variable)

**Important changes to verify:**
```
# aws_lb_listener.frontend_https will be updated in-place
~ certificate_arn = "arn:aws:acm:...:certificate/OLD_CERT_ID" -> "arn:aws:acm:...:certificate/NEW_CERT_ID"

# aws_route53_record.app will be created
+ resource "aws_route53_record" "app" {
    + name    = "maps.yourdomain.com"
    + type    = "A"
    ...
  }

# aws_cognito_user_pool_client.web will be updated in-place
~ callback_urls = [
    "http://localhost:5173/auth/callback",
  - "https://mra-mines-alb-dev-123.eu-west-2.elb.amazonaws.com/auth/callback"
  + "https://maps.yourdomain.com/auth/callback"
  ]

# aws_ecs_task_definition.frontend must be replaced
~ environment {
    name  = "ORIGIN"
  - value = "https://mra-mines-alb-dev-123.eu-west-2.elb.amazonaws.com"
  + value = "https://maps.yourdomain.com"
  }
```

### 5.3 Apply Changes

```bash
terraform apply
```

Type `yes` when prompted.

**Expected output:**
```
Apply complete! Resources: 1 added, 3 changed, 0 destroyed.

Outputs:
application_url = "https://maps.yourdomain.com"
domain_configuration = {
  certificate_type    = "ACM Certificate"
  dns_configured      = true
  domain              = "maps.yourdomain.com"
  using_custom_domain = true
}
```

### 5.4 Redeploy Frontend Service

The ECS task definition will be updated, but you need to force a new deployment:

```bash
# Get cluster and service names
cd /Users/ajay.rawat/Projects-Hartree/MRA-Mines/final-mra-maps-project/deployment-package/infra

CLUSTER_NAME=$(terraform output -raw ecs_cluster_name)
SERVICE_NAME=$(terraform output -raw frontend_service_name)
AWS_REGION=$(terraform output -raw aws_region)

# Force new deployment
aws ecs update-service \
  --cluster $CLUSTER_NAME \
  --service $SERVICE_NAME \
  --force-new-deployment \
  --region $AWS_REGION

echo "✅ Frontend service redeployment initiated"
```

**Wait for deployment:**
```bash
# Monitor deployment status
aws ecs describe-services \
  --cluster $CLUSTER_NAME \
  --services $SERVICE_NAME \
  --region $AWS_REGION \
  --query 'services[0].deployments[*].[status,desiredCount,runningCount]' \
  --output table
```

Wait until:
- Old deployment shows `0` running count
- New deployment shows desired count = running count
- Typically takes 3-5 minutes

---

## Step 6: Verify Setup

### 6.1 DNS Propagation Check

```bash
# Check if DNS is resolving
dig maps.yourdomain.com

# Should show:
# ANSWER SECTION:
# maps.yourdomain.com.    300    IN    A    ALB_IP_ADDRESS
```

Or check online: https://dnschecker.org/

**Wait time:** DNS propagation can take 5 minutes to 48 hours, typically 1-2 hours

### 6.2 SSL Certificate Check

```bash
# Check SSL certificate
openssl s_client -connect maps.yourdomain.com:443 -servername maps.yourdomain.com < /dev/null 2>/dev/null | openssl x509 -noout -text | grep -A 2 "Subject:"
```

Should show your domain in Subject Alternative Names.

### 6.3 ALB Target Health

```bash
cd /Users/ajay.rawat/Projects-Hartree/MRA-Mines/final-mra-maps-project/deployment-package/infra

TARGET_GROUP_ARN=$(terraform output -raw target_group_arn)
AWS_REGION=$(terraform output -raw aws_region)

aws elbv2 describe-target-health \
  --target-group-arn $TARGET_GROUP_ARN \
  --region $AWS_REGION \
  --query 'TargetHealthDescriptions[*].[Target.Id,TargetHealth.State]' \
  --output table
```

All targets should show `healthy`.

### 6.4 Application Access Test

1. **Test from browser:**
   ```
   https://maps.yourdomain.com
   ```

   ✅ Should show NO certificate warnings
   ✅ Lock icon should show "Secure"
   ✅ Application should load

2. **Test SSL grade:**
   - Visit: https://www.ssllabs.com/ssltest/
   - Enter: maps.yourdomain.com
   - Should get A or A+ rating

3. **Test from corporate network:**
   - Access from your company network
   - Should work without certificate errors

### 6.5 Cognito Authentication Test

1. Navigate to: `https://maps.yourdomain.com`
2. Click "Login" or attempt to access protected page
3. Should redirect to Cognito hosted UI
4. Login with test user:
   - Username: `ajay`
   - Password: `Ajay@1234`
5. Should redirect back to application successfully

---

## Troubleshooting

### Issue 1: DNS Not Resolving

**Symptom:**
```
dig maps.yourdomain.com
# Returns NXDOMAIN or no results
```

**Solutions:**

1. **Verify Route 53 record exists:**
   ```bash
   aws route53 list-resource-record-sets \
     --hosted-zone-id Z1234567890ABC \
     --query "ResourceRecordSets[?Name=='maps.yourdomain.com.']" \
     --output table
   ```

2. **Check name servers (if using external registrar):**
   ```bash
   dig NS yourdomain.com
   ```
   Should match Route 53 name servers.

3. **Wait for propagation:**
   - Can take up to 48 hours for external domains
   - Route 53 registered domains: usually 5-10 minutes

### Issue 2: Certificate Not Found by Terraform

**Error:**
```
Error: no matching ACM Certificate found
```

**Solutions:**

1. **Verify certificate is in correct region:**
   ```bash
   aws acm list-certificates \
     --region eu-west-2 \
     --query 'CertificateSummaryList[*].[DomainName,Status]' \
     --output table
   ```

2. **Check certificate status:**
   ```bash
   aws acm describe-certificate \
     --certificate-arn arn:aws:acm:eu-west-2:ACCOUNT:certificate/CERT_ID \
     --region eu-west-2 \
     --query 'Certificate.Status'
   ```

   Must be `"ISSUED"`, not `"PENDING_VALIDATION"`

3. **Verify domain name matches exactly:**
   - Certificate domain: `maps.yourdomain.com`
   - Terraform variable: `maps.yourdomain.com`
   - Must match exactly (case-insensitive but be careful)

### Issue 3: ALB Still Using Old Certificate

**Symptom:**
Browser shows old self-signed certificate warning.

**Solutions:**

1. **Verify ALB listener certificate:**
   ```bash
   aws elbv2 describe-listeners \
     --load-balancer-arn $(terraform output -raw alb_arn) \
     --region eu-west-2 \
     --query 'Listeners[?Port==`443`].Certificates[0].CertificateArn' \
     --output text
   ```

   Should show ACM certificate ARN, not self-signed.

2. **Check terraform state:**
   ```bash
   terraform state show aws_lb_listener.frontend_https | grep certificate_arn
   ```

3. **Force refresh and reapply:**
   ```bash
   terraform refresh
   terraform apply
   ```

### Issue 4: Cognito OAuth Redirect Error

**Error:**
```
redirect_uri_mismatch
or
The redirect URI provided is not in the list of allowed URIs
```

**Solutions:**

1. **Verify callback URLs in Cognito:**
   ```bash
   aws cognito-idp describe-user-pool-client \
     --user-pool-id $(terraform output -raw cognito_user_pool_id) \
     --client-id $(terraform output -raw cognito_user_pool_client_id) \
     --query 'UserPoolClient.CallbackURLs' \
     --output json
   ```

   Should include: `https://maps.yourdomain.com/auth/callback`

2. **Check browser URL during error:**
   - Look for `redirect_uri` parameter in URL
   - Ensure it matches one of the configured callback URLs

3. **Update Cognito client:**
   ```bash
   terraform taint aws_cognito_user_pool_client.web
   terraform apply
   ```

### Issue 5: ECS Tasks Not Healthy

**Symptom:**
Target group shows unhealthy targets.

**Solutions:**

1. **Check ECS task logs:**
   ```bash
   aws logs tail /ecs/mra-mines-frontend-dev \
     --follow \
     --region eu-west-2 \
     --format short
   ```

2. **Verify ORIGIN environment variable:**
   ```bash
   aws ecs describe-task-definition \
     --task-definition mra-mines-frontend-dev \
     --region eu-west-2 \
     --query 'taskDefinition.containerDefinitions[0].environment[?name==`ORIGIN`].value' \
     --output text
   ```

   Should show: `https://maps.yourdomain.com`

3. **Force new deployment:**
   ```bash
   aws ecs update-service \
     --cluster $(terraform output -raw ecs_cluster_name) \
     --service $(terraform output -raw frontend_service_name) \
     --force-new-deployment \
     --region eu-west-2
   ```

### Issue 6: SSL Labs Shows Poor Rating

**Symptom:**
SSL Labs test shows B or C rating.

**Solutions:**

1. **Update SSL policy in ALB:**
   Edit `infra/alb.tf`:
   ```hcl
   ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"  # Already using best policy
   ```

2. **Enable HTTP to HTTPS redirect:**
   Already configured in `aws_lb_listener.frontend_http`

3. **Wait for SSL Labs cache:**
   - SSL Labs caches results for 24 hours
   - Request fresh scan

---

## Cost Analysis

### Monthly Costs (with Custom Domain)

| Service | Usage | Cost/Month |
|---------|-------|------------|
| **Route 53 Hosted Zone** | 1 zone | $0.50 |
| **Route 53 Queries** | ~1M queries | $0.40 |
| **ACM Certificate** | SSL certificate | FREE |
| **ALB** | 730 hours + processing | $16-24 |
| **ECS Fargate** | 1 task, 0.25 vCPU, 512 MB | $8-12 |
| **Other** | S3, DynamoDB, Lambda | $2-5 |
| **Total** | | **$27-42/month** |

### Annual Costs

| Item | Cost |
|------|------|
| Domain registration (Route 53) | $12-13/year |
| Infrastructure (monthly × 12) | $324-504/year |
| **Total Annual** | **$336-517/year** |

### Cost Comparison

| Setup | Certificate | Monthly Cost | Works on Corporate Network |
|-------|-------------|--------------|----------------------------|
| Current (Self-signed) | Free | $26-37 | ❌ No |
| Custom Domain + ACM | Free cert + $0.90/mo | $27-42 | ✅ Yes |
| CloudFront + ACM | Free cert + $8-10/mo | $34-52 | ✅ Yes |

**Additional cost for custom domain: ~$1/month + $12/year domain**

---

## Rollback Plan

If you need to rollback to self-signed certificate:

### 1. Update terraform.tfvars

```hcl
# Comment out domain configuration
# domain_name       = "maps.yourdomain.com"
# route53_zone_id   = "Z1234567890ABC"
domain_name = ""
route53_zone_id = ""
```

### 2. Apply Changes

```bash
cd /Users/ajay.rawat/Projects-Hartree/MRA-Mines/final-mra-maps-project/deployment-package/infra
terraform apply
```

### 3. Force Frontend Redeployment

```bash
aws ecs update-service \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --service $(terraform output -raw frontend_service_name) \
  --force-new-deployment \
  --region eu-west-2
```

Application will revert to:
- Self-signed certificate
- ALB DNS name
- Original Cognito callback URLs

---

## Best Practices

### Security

1. **Enable DNSSEC for domain** (if using Route 53):
   ```
   Route 53 → Hosted zones → Your zone → Enable DNSSEC signing
   ```

2. **Enable Certificate Transparency logging:**
   - ACM certificates automatically included in CT logs
   - No action needed

3. **Monitor certificate expiration:**
   - ACM automatically renews certificates
   - Set up CloudWatch alarms for certificate expiration

### Monitoring

1. **Create CloudWatch Dashboard:**
   ```bash
   # Monitor ALB target health
   aws cloudwatch put-metric-alarm \
     --alarm-name mra-mines-alb-unhealthy-targets \
     --alarm-description "Alert when ALB targets are unhealthy" \
     --metric-name UnHealthyHostCount \
     --namespace AWS/ApplicationELB \
     --statistic Average \
     --period 300 \
     --evaluation-periods 2 \
     --threshold 1 \
     --comparison-operator GreaterThanThreshold
   ```

2. **Monitor DNS query count:**
   ```
   CloudWatch → Route 53 → Hosted Zone Metrics
   ```

3. **Monitor ACM certificate expiration:**
   ```
   CloudWatch → Certificate Manager → DaysToExpiry
   ```

### Performance

1. **Consider CloudFront for global users:**
   - If users are outside EU, add CloudFront
   - Cache static assets
   - Reduce latency

2. **Enable ALB access logs:**
   ```hcl
   # Add to alb.tf
   resource "aws_lb" "frontend" {
     # ... existing config ...

     access_logs {
       bucket  = aws_s3_bucket.alb_logs.id
       enabled = true
     }
   }
   ```

3. **Set appropriate DNS TTL:**
   - For stable setup: 300-3600 seconds
   - For testing: 60 seconds
   - Currently: 300 seconds (good balance)

---

## Additional Resources

### AWS Documentation
- [Route 53 Documentation](https://docs.aws.amazon.com/route53/)
- [ACM Documentation](https://docs.aws.amazon.com/acm/)
- [ALB Documentation](https://docs.aws.amazon.com/elasticloadbalancing/)

### Tools
- [DNS Checker](https://dnschecker.org/) - Check DNS propagation
- [SSL Labs](https://www.ssllabs.com/ssltest/) - Test SSL configuration
- [AWS Calculator](https://calculator.aws/) - Estimate costs

### Support
- AWS Support: https://console.aws.amazon.com/support/
- Route 53 Forum: https://forums.aws.amazon.com/forum.jspa?forumID=87

---

## Appendix

### A. Quick Reference Commands

```bash
# Get Hosted Zone ID
aws route53 list-hosted-zones \
  --query 'HostedZones[?Name==`yourdomain.com.`].Id' \
  --output text

# Check ACM certificate status
aws acm list-certificates --region eu-west-2

# Get ALB DNS name
terraform output alb_dns_name

# Get application URL
terraform output application_url

# Check ECS service status
aws ecs describe-services \
  --cluster $(terraform output -raw ecs_cluster_name) \
  --services $(terraform output -raw frontend_service_name) \
  --region eu-west-2

# View CloudWatch logs
aws logs tail /ecs/mra-mines-frontend-dev --follow --region eu-west-2
```

### B. DNS Record Examples

**A Record (Alias) - Recommended:**
```
Name: maps.yourdomain.com
Type: A
Value: Alias to ALB (dualstack.mra-mines-alb-dev-123.eu-west-2.elb.amazonaws.com)
```

**CNAME Record - Alternative:**
```
Name: maps.yourdomain.com
Type: CNAME
Value: mra-mines-alb-dev-123.eu-west-2.elb.amazonaws.com
TTL: 300
```

### C. Terraform Variable Reference

Complete terraform.tfvars with domain configuration:

```hcl
# Project Configuration
project_name = "mra-mines"
environment  = "dev"
aws_region   = "eu-west-2"

# Custom Domain Configuration
domain_name       = "maps.yourdomain.com"
route53_zone_id   = "Z1234567890ABC"
use_route53_alias = true

# Cognito Configuration
cognito_domain_prefix = "mra-mines-auth"
ses_sender_email      = "no-reply@yourdomain.com"

# Other existing variables...
use_existing_iam_roles = false
```

---

## Summary Checklist

Before starting:
- [ ] Domain name decided
- [ ] AWS CLI configured
- [ ] Current infrastructure deployed
- [ ] Estimated 2-4 hours for complete setup

Step-by-step:
- [ ] Domain registered or subdomain requested
- [ ] Route 53 hosted zone created
- [ ] ACM certificate requested in eu-west-2
- [ ] ACM certificate validated and showing "ISSUED"
- [ ] Terraform files updated
- [ ] Terraform plan reviewed
- [ ] Terraform apply completed successfully
- [ ] Frontend service redeployed
- [ ] DNS propagation completed
- [ ] SSL certificate verified in browser
- [ ] Application accessible via custom domain
- [ ] Cognito authentication tested
- [ ] Works on corporate network

---

**Document Version:** 1.0
**Last Updated:** 2025-11-11
**Maintained By:** MRA Mines DevOps Team
