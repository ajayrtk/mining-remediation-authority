# Cost Optimization for 10 Internal Users

## Current Architecture Issues

For only 10 internal users, the current architecture is over-engineered:

- **CloudFront**: Global CDN unnecessary for small internal team
- **Cost**: ~$21-26/month just for routing layers
- **Complexity**: Extra components to manage

---

## Recommended: Remove CloudFront, Keep ALB with HTTPS

### Architecture Change

**Before:**
```
Browser → CloudFront (HTTPS) → ALB (HTTP) → ECS
Cost: ~$40-72/month
```

**After:**
```
Browser → ALB (HTTPS) → ECS
Cost: ~$32-62/month (save $8-10/month)
```

---

## Implementation Steps

### 1. Create ACM Certificate (if using custom domain)

```bash
# In infra directory
# If using custom domain, create ACM certificate
# Otherwise, use ALB's default DNS name
```

### 2. Update ALB Configuration

Create new file: `infra/alb_https.tf`

```hcl
# HTTPS Listener for ALB
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  # Option 1: Use ACM certificate for custom domain
  # certificate_arn   = aws_acm_certificate.main.arn

  # Option 2: Use default ALB certificate (self-signed)
  # Users will see certificate warning but it works for internal use

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# HTTP listener - redirect to HTTPS
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# Update ALB security group to allow HTTPS
resource "aws_security_group_rule" "alb_https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.alb.id
  description       = "Allow HTTPS traffic"
}
```

### 3. Remove CloudFront Resources

```bash
# Comment out or delete in Terraform:
# - infra/frontend_cloudfront.tf (entire file)
# - CloudFront outputs in outputs.tf
```

### 4. Update Cognito Callback URLs

In `infra/cognito.tf`:

```hcl
resource "aws_cognito_user_pool_client" "web" {
  # ... other config ...

  callback_urls = [
    "http://localhost:5173/auth/callback",
    # Change from CloudFront URL to ALB URL
    "https://${aws_lb.main.dns_name}/auth/callback"
  ]

  logout_urls = [
    "http://localhost:5173/",
    "https://${aws_lb.main.dns_name}/"
  ]
}
```

### 5. Update Frontend Environment Variables

Users will access the app via ALB DNS:

```
https://{project}-alb-{environment}-1234567890.{region}.elb.amazonaws.com
```

Or if using custom domain:
```
https://maps.yourcompany.com
```

### 6. Apply Changes

```bash
cd infra

# Review changes
terraform plan

# Apply
terraform apply

# Get new ALB URL
terraform output alb_dns_name
```

### 7. Update Cleanup Script

In `scripts/cleanup.sh`, remove CloudFront cleanup section:

```bash
# Remove or comment out CloudFront deletion section
# Steps 1-2 handle CloudFront - NO LONGER NEEDED
```

---

## Cost Comparison

| Component | Before | After | Savings |
|-----------|--------|-------|---------|
| CloudFront | $5-10 | $0 | **-$5-10** |
| ALB | $16 | $16 | $0 |
| ECS Frontend | $15-25 | $15-25 | $0 |
| DynamoDB | $2-10 | $2-10 | $0 |
| S3 | $1-5 | $1-5 | $0 |
| Lambda | $0-5 | $0-5 | $0 |
| ECR | $1 | $1 | $0 |
| **Total** | **$40-72** | **$32-62** | **-$8-10** |

**Annual Savings:** ~$96-120/year

---

## Alternative: Further Cost Reduction (Advanced)

### Option: Remove ALB Too (Save $16/month more)

If you want to save even more, you could use **ECS Service Discovery**:

**Architecture:**
```
Browser → Route53 → ECS Service (Cloud Map Service Discovery)
```

**Cost:** ~$16-46/month (save additional $16)

**Trade-offs:**
- More complex setup
- No built-in load balancing
- Need to handle HTTPS in container
- Less production-ready

**When to consider:**
- Budget is extremely tight
- Traffic is very low (< 100 requests/day)
- Team is comfortable with container SSL configuration

---

## For 10 Users: What You Actually Need

✅ **Keep:**
- ECS Fargate (runs your app)
- DynamoDB (stores data)
- S3 (file storage)
- Cognito (authentication)
- Lambda (processing)
- ALB (stable endpoint + HTTPS)

❌ **Remove:**
- CloudFront (unnecessary for 10 internal users)

⚠️ **Could Remove (but not recommended):**
- ALB (save $16/month but adds complexity)

---

## Recommendation

**For 10 internal users: Remove CloudFront, keep everything else**

This provides the best balance of:
- ✅ Cost optimization (save ~$100/year)
- ✅ Simple architecture
- ✅ Production-ready
- ✅ Easy HTTPS
- ✅ Stable endpoint

Total cost: **~$32-62/month** for a fully managed, scalable application supporting 10 users.

---

## Questions?

- **"Do we need high availability for 10 users?"**
  - ALB + ECS gives you this automatically (minimal cost difference)

- **"What if we grow to 50-100 users?"**
  - Current setup (ALB + ECS) scales easily, no changes needed

- **"Should we use a custom domain?"**
  - Optional - ALB provides a DNS name that works fine
  - Custom domain needs Route53 ($0.50/month) + domain registration

---

**Last Updated:** 2025-11-11
