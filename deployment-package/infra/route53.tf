# Route 53 DNS configuration for custom domain

# Hosted Zone - manages all DNS records for the domain
resource "aws_route53_zone" "main" {
  count = var.enable_custom_domain ? 1 : 0

  name = var.domain_name

  tags = {
    Name        = "${var.project_name}-hosted-zone-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# A Record: www subdomain → ALB
resource "aws_route53_record" "www" {
  count = var.enable_custom_domain ? 1 : 0

  zone_id = aws_route53_zone.main[0].zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.frontend.dns_name
    zone_id                = aws_lb.frontend.zone_id
    evaluate_target_health = true
  }
}

# A Record: apex domain → ALB
resource "aws_route53_record" "apex" {
  count = var.enable_custom_domain ? 1 : 0

  zone_id = aws_route53_zone.main[0].zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.frontend.dns_name
    zone_id                = aws_lb.frontend.zone_id
    evaluate_target_health = true
  }
}
