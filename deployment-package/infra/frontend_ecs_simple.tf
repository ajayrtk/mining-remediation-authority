# --- Frontend ECS Infrastructure (Without Load Balancer) ---
# Simple deployment using public IP directly

# ECR Repository for Frontend Docker Image
resource "aws_ecr_repository" "frontend" {
  name                 = "${var.project_name}-${var.environment}-frontend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true  # Allow deletion even if images exist

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

# Security Group for Frontend ECS Tasks (Direct Internet Access)
resource "aws_security_group" "frontend_ecs" {
  name        = "${var.project_name}-${var.environment}-frontend-sg"
  description = "Security group for Frontend ECS tasks (direct access)"
  vpc_id      = aws_vpc.main.id

  # Allow HTTP from anywhere
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow HTTP from internet"
  }

  # Allow all outbound traffic (for DynamoDB, S3, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = merge(local.tags, {
    Name = "${var.project_name}-${var.environment}-frontend-sg"
  })
}

# IAM Role for Frontend ECS Task Execution
resource "aws_iam_role" "frontend_task_execution" {
  count = var.use_existing_iam_roles ? 0 : 1
  name  = "${var.project_name}-${var.environment}-frontend-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.tags
}

# Attach ECS Task Execution Policy
resource "aws_iam_role_policy_attachment" "frontend_task_execution" {
  count      = var.use_existing_iam_roles ? 0 : 1
  role       = aws_iam_role.frontend_task_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# IAM Role for Frontend ECS Task (Application Permissions)
resource "aws_iam_role" "frontend_task" {
  count = var.use_existing_iam_roles ? 0 : 1
  name  = "${var.project_name}-${var.environment}-frontend-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.tags
}

# Policy for Frontend Task to access DynamoDB and S3
resource "aws_iam_role_policy" "frontend_task_permissions" {
  count = var.use_existing_iam_roles ? 0 : 1
  name  = "${var.project_name}-${var.environment}-frontend-permissions"
  role  = aws_iam_role.frontend_task[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem"
        ]
        Resource = [
          aws_dynamodb_table.maps.arn,
          "${aws_dynamodb_table.maps.arn}/index/*",
          aws_dynamodb_table.map_jobs.arn,
          "${aws_dynamodb_table.map_jobs.arn}/index/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.map_input.arn,
          "${aws_s3_bucket.map_input.arn}/*",
          aws_s3_bucket.map_outputs.arn,
          "${aws_s3_bucket.map_outputs.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:GetUser"
        ]
        Resource = aws_cognito_user_pool.main.arn
      }
    ]
  })
}

# CloudWatch Log Group for Frontend
resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${var.project_name}-${var.environment}-frontend"
  retention_in_days = 7

  tags = local.tags
}

# ECS Task Definition for Frontend
resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.project_name}-${var.environment}-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"  # 0.25 vCPU (cheaper than 0.5)
  memory                   = "512"  # 512 MB (cheaper than 1 GB)
  execution_role_arn       = local.frontend_task_execution_role_arn
  task_role_arn            = local.frontend_task_role_arn

  container_definitions = jsonencode([{
    name  = "frontend"
    image = "${aws_ecr_repository.frontend.repository_url}:latest"

    portMappings = [{
      containerPort = 3000
      hostPort      = 3000
      protocol      = "tcp"
    }]

    environment = [
      {
        name  = "NODE_ENV"
        value = "production"
      },
      {
        name  = "PORT"
        value = "3000"
      },
      # Client-side (PUBLIC_) variables - available in browser
      {
        name  = "PUBLIC_AWS_REGION"
        value = var.aws_region
      },
      {
        name  = "PUBLIC_COGNITO_USER_POOL_ID"
        value = aws_cognito_user_pool.main.id
      },
      {
        name  = "PUBLIC_COGNITO_CLIENT_ID"
        value = aws_cognito_user_pool_client.web.id
      },
      {
        name  = "PUBLIC_COGNITO_IDENTITY_POOL_ID"
        value = aws_cognito_identity_pool.main.id
      },
      # Server-side variables - only available in server code
      {
        name  = "AWS_REGION"
        value = var.aws_region
      },
      {
        name  = "COGNITO_REGION"
        value = var.aws_region
      },
      {
        name  = "COGNITO_USER_POOL_ID"
        value = aws_cognito_user_pool.main.id
      },
      {
        name  = "COGNITO_CLIENT_ID"
        value = aws_cognito_user_pool_client.web.id
      },
      {
        name  = "COGNITO_DOMAIN"
        value = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
      },
      # Database and S3 configuration
      {
        name  = "MAPS_TABLE_NAME"
        value = aws_dynamodb_table.maps.name
      },
      {
        name  = "MAPS_TABLE"
        value = aws_dynamodb_table.maps.name
      },
      {
        name  = "JOBS_TABLE_NAME"
        value = aws_dynamodb_table.map_jobs.name
      },
      {
        name  = "MAP_JOBS_TABLE"
        value = aws_dynamodb_table.map_jobs.name
      },
      {
        name  = "MAP_INPUT_BUCKET"
        value = aws_s3_bucket.map_input.bucket
      },
      {
        name  = "MAP_OUTPUT_BUCKET"
        value = aws_s3_bucket.map_outputs.bucket
      },
      # SvelteKit ORIGIN - tells adapter-node the correct public URL
      # This ensures url.origin returns CloudFront URL, not ALB DNS
      {
        name  = "ORIGIN"
        value = "https://${aws_cloudfront_distribution.frontend.domain_name}"
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "frontend"
      }
    }

    essential = true
  }])

  tags = local.tags
}

# ECS Service for Frontend (With ALB Integration)
resource "aws_ecs_service" "frontend" {
  name            = "${var.project_name}-${var.environment}-frontend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.frontend_ecs.id]
    assign_public_ip = true  # Keep public IP for internet access (no NAT Gateway needed)
  }

  # Load Balancer Configuration
  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = 3000
  }

  # Wait for ALB listener before creating service
  depends_on = [
    aws_lb_listener.frontend_http,
    aws_iam_role_policy.frontend_task_permissions
  ]

  # Force new deployment when task definition changes
  force_new_deployment = true

  tags = local.tags
}

# Outputs for frontend infrastructure
output "frontend_ecr_repository_url" {
  description = "ECR repository URL for frontend Docker image"
  value       = aws_ecr_repository.frontend.repository_url
}

output "frontend_service_name" {
  description = "Name of the frontend ECS service"
  value       = aws_ecs_service.frontend.name
}

output "frontend_access_instructions" {
  description = "How to access the frontend application"
  value       = <<-EOT

  ========================================
  Frontend Application Access
  ========================================

  Application URL: https://${aws_cloudfront_distribution.frontend.domain_name}

  Architecture:
  - CloudFront (HTTPS, global CDN) → ALB (stable) → ECS Tasks (auto-healing)

  Benefits:
  ✓ HTTPS enabled (Cognito authentication works)
  ✓ Stable origin (no 504 errors on task restarts)
  ✓ Global performance (CloudFront edge caching)
  ✓ Auto-healing (ALB health checks)

  ALB DNS: ${aws_lb.frontend.dns_name}

  Check ALB target health:
  aws elbv2 describe-target-health --target-group-arn ${aws_lb_target_group.frontend.arn} --region ${var.aws_region}

  ========================================
  EOT
}
