# --- CloudFront Distribution for Frontend (Direct to ECS) ---
# Provides HTTPS access without needing an ALB
# Note: Origin IP needs to be updated when ECS task restarts

# Data source to get current frontend task details
data "aws_ecs_service" "frontend" {
  service_name = aws_ecs_service.frontend.name
  cluster_arn  = aws_ecs_cluster.main.arn
}

# Variable for frontend origin (can be overridden)
variable "frontend_origin_domain" {
  type        = string
  description = "Domain or IP of the frontend origin (ECS task public IP or DNS)"
  default     = ""  # Will be populated after first deployment
}

locals {
  # Use variable if set, otherwise use a placeholder
  # After first deployment, run: terraform apply -var="frontend_origin_domain=<PUBLIC_IP>"
  frontend_origin = var.frontend_origin_domain != "" ? var.frontend_origin_domain : "placeholder.example.com"
}

# CloudFront Origin Request Policy
resource "aws_cloudfront_origin_request_policy" "frontend" {
  name    = "${var.project_name}-${var.environment}-frontend-policy"
  comment = "Policy for frontend ECS origin"

  cookies_config {
    cookie_behavior = "all"
  }

  headers_config {
    header_behavior = "allViewer"
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

# CloudFront Cache Policy
resource "aws_cloudfront_cache_policy" "frontend" {
  name        = "${var.project_name}-${var.environment}-frontend-cache"
  comment     = "Cache policy for frontend with session support"
  default_ttl = 0
  max_ttl     = 31536000
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "all"
    }

    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Host", "CloudFront-Forwarded-Proto"]
      }
    }

    query_strings_config {
      query_string_behavior = "all"
    }

    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "CloudFront distribution for ${var.project_name} frontend (direct to ECS)"
  default_root_object = ""
  price_class         = "PriceClass_100" # Use only North America and Europe

  origin {
    domain_name = local.frontend_origin
    origin_id   = "frontend-ecs"

    custom_origin_config {
      http_port              = 3000
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    target_origin_id       = "frontend-ecs"
    compress               = true
    viewer_protocol_policy = "redirect-to-https"

    cache_policy_id          = aws_cloudfront_cache_policy.frontend.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.frontend.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  # Custom error responses for SvelteKit
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/"
  }

  tags = merge(local.tags, {
    Name = "${var.project_name}-${var.environment}-frontend-cf"
  })
}

# Outputs
output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name (use this to access your frontend)"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_url" {
  description = "Full HTTPS URL for accessing the frontend"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (for cache invalidation)"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cognito_callback_url" {
  description = "Callback URL to configure in Cognito"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}/auth/callback"
}

output "cognito_logout_url" {
  description = "Logout URL to configure in Cognito"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}/"
}

output "update_cloudfront_origin_command" {
  description = "Command to update CloudFront origin when ECS task IP changes"
  value       = <<-EOT

  ========================================
  Updating CloudFront Origin
  ========================================

  When the ECS task restarts and gets a new IP, run:

  1. Get the new public IP:
     ${aws_ecs_service.frontend.name}

  2. Update CloudFront origin:
     cd infra
     terraform apply -var="frontend_origin_domain=<NEW_PUBLIC_IP>"

  3. Invalidate CloudFront cache:
     aws cloudfront create-invalidation --distribution-id ${aws_cloudfront_distribution.frontend.id} --paths "/*"

  ========================================
  EOT
}
