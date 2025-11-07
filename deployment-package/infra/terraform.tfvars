# Terraform Variables Configuration
# This file is the CENTRALIZED configuration for the deployment

# ===== CORE SETTINGS (Change these for different environments) =====
project_name = "mra-mines"
environment  = "staging"          # Options: "dev", "staging", "prod"
aws_region   = "eu-central-1"    # AWS region for deployment

# ===== S3 BUCKET NAMES =====
# Use unique names to avoid conflicts with existing buckets
map_input_bucket_name  = "mra-map-input"
map_output_bucket_name = "mra-map-output"

# ===== IAM ROLES CONFIGURATION =====
# Use existing IAM roles instead of creating new ones
use_existing_iam_roles = true

# Names of existing IAM roles in AWS account (only used if use_existing_iam_roles = true)
existing_iam_role_names = {
  input_handler           = "mra-mines-input-handler"
  mock_ecs               = "mra-mines-mock-ecs"
  output_handler         = "mra-mines-output-handler"
  s3_copy_processor      = "mra-mines-s3-copy-processor"
  ecs_task_execution     = "mra-mines-ecs-task-execution"
  ecs_task               = "mra-mines-ecs-task"
  frontend_task_execution = "mra-mines-dev-frontend-task-execution"
  frontend_task          = "mra-mines-dev-frontend-task"
  pre_auth_trigger       = "mra-mines-pre-auth-trigger-role"
}

# ===== COGNITO CONFIGURATION =====
# Update these URLs after deployment with your CloudFront URL
cognito_callback_urls = [
  "http://localhost:5173/auth/callback",
  "https://dli8nj0dqq4yj.cloudfront.net/auth/callback"
]

cognito_logout_urls = [
  "http://localhost:5173/",
  "https://dli8nj0dqq4yj.cloudfront.net/"
]
