# Application Load Balancer - handles incoming HTTPS traffic and routes to ECS tasks

# Security group for the ALB
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb-sg-${var.environment}"
  description = "Security group for Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  # Allow HTTP from anywhere (will redirect to HTTPS)
  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Allow HTTPS from anywhere
  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Allow all outbound traffic to ECS tasks
  egress {
    description = "All traffic to ECS tasks"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-alb-sg-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Update ECS security group to allow traffic from ALB
resource "aws_security_group_rule" "ecs_from_alb" {
  type                     = "ingress"
  from_port                = 3000
  to_port                  = 3000
  protocol                 = "tcp"
  security_group_id        = aws_security_group.frontend_ecs.id
  source_security_group_id = aws_security_group.alb.id
  description              = "Allow traffic from ALB"
}

# Application Load Balancer
resource "aws_lb" "frontend" {
  name               = "${var.project_name}-alb-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  enable_deletion_protection = false
  enable_http2              = true

  tags = {
    Name        = "${var.project_name}-frontend-alb-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Target Group for ECS Tasks
resource "aws_lb_target_group" "frontend" {
  name        = "${var.project_name}-tg-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # Required for Fargate

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  tags = {
    Name        = "${var.project_name}-frontend-tg-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Self-signed certificate for HTTPS (used when custom domain is NOT enabled)
resource "tls_private_key" "alb" {
  count = var.enable_custom_domain ? 0 : 1

  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "alb" {
  count = var.enable_custom_domain ? 0 : 1

  private_key_pem = tls_private_key.alb[0].private_key_pem

  subject {
    common_name  = "${var.project_name}-${var.environment}.local"
    organization = var.project_name
  }

  validity_period_hours = 87600 # 10 years

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

resource "aws_acm_certificate" "alb_self_signed" {
  count = var.enable_custom_domain ? 0 : 1

  private_key      = tls_private_key.alb[0].private_key_pem
  certificate_body = tls_self_signed_cert.alb[0].cert_pem

  tags = {
    Name        = "${var.project_name}-alb-cert-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ALB Listener - HTTPS on port 443 (primary)
# Uses ACM certificate when custom domain is enabled, otherwise uses self-signed certificate
resource "aws_lb_listener" "frontend_https" {
  load_balancer_arn = aws_lb.frontend.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.enable_custom_domain ? aws_acm_certificate.main[0].arn : aws_acm_certificate.alb_self_signed[0].arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }

  tags = {
    Name        = "${var.project_name}-https-listener-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# ALB Listener - HTTP on port 80 (redirects to HTTPS)
resource "aws_lb_listener" "frontend_http" {
  load_balancer_arn = aws_lb.frontend.arn
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

  tags = {
    Name        = "${var.project_name}-http-listener-${var.environment}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Outputs
output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.frontend.dns_name
}

output "alb_url" {
  description = "HTTPS URL of the Application Load Balancer (main application URL)"
  value       = "https://${aws_lb.frontend.dns_name}"
}

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.frontend.arn
}

output "target_group_arn" {
  description = "ARN of the target group"
  value       = aws_lb_target_group.frontend.arn
}
