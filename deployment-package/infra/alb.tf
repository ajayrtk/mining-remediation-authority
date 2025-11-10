# =====================================================
# Application Load Balancer for Frontend
# =====================================================
# ALB provides stable backend for CloudFront
# CloudFront → ALB → ECS Tasks

# Security Group for ALB
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-${var.environment}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  # Allow HTTP from anywhere (CloudFront will connect via HTTP)
  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
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
    Name        = "${var.project_name}-${var.environment}-alb-sg"
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
  name               = "${var.project_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  enable_deletion_protection = false
  enable_http2              = true

  tags = {
    Name        = "${var.project_name}-${var.environment}-frontend-alb"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# Target Group for ECS Tasks
resource "aws_lb_target_group" "frontend" {
  name        = "${var.project_name}-${var.environment}-tg"
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
    Name        = "${var.project_name}-${var.environment}-frontend-tg"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# ALB Listener - HTTP on port 80
resource "aws_lb_listener" "frontend_http" {
  load_balancer_arn = aws_lb.frontend.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-listener"
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

output "alb_arn" {
  description = "ARN of the Application Load Balancer"
  value       = aws_lb.frontend.arn
}

output "target_group_arn" {
  description = "ARN of the target group"
  value       = aws_lb_target_group.frontend.arn
}
