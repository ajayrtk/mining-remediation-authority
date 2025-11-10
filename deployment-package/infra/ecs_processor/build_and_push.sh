#!/bin/bash
set -e

# Build and push Docker image to ECR
# Usage: ./build_and_push.sh

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get region from Terraform output (with fallback to terraform.tfvars)
cd ..
TERRAFORM_REGION=$(terraform output -raw aws_region 2>/dev/null || echo "")
if [ -z "$TERRAFORM_REGION" ]; then
    TERRAFORM_REGION=$(grep -E '^\s*aws_region\s*=' terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' 2>/dev/null || echo "")
    AWS_REGION=${TERRAFORM_REGION:-${AWS_REGION:-$(aws configure get region)}}
else
    AWS_REGION=$TERRAFORM_REGION
fi

# Get project name from terraform.tfvars
PROJECT_NAME=$(grep -E '^\s*project_name\s*=' terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' 2>/dev/null || echo "mra-mines")

echo "Using AWS Region: $AWS_REGION"
echo "Project Name: $PROJECT_NAME"
echo ""

# Get ECR repository URL from Terraform output
ECR_REPO=$(terraform output -raw ecr_repository_url 2>/dev/null || echo "")

if [ -z "$ECR_REPO" ]; then
    echo "Error: Could not get ECR repository URL from Terraform"
    echo "Run 'terraform apply' first to create the ECR repository"
    exit 1
fi

# Go back to ecs_processor directory for Docker build
cd ecs_processor

echo "Building Docker image for linux/amd64..."
docker build --platform linux/amd64 -t ${PROJECT_NAME}-processor:latest .

echo "Tagging image for ECR..."
docker tag ${PROJECT_NAME}-processor:latest ${ECR_REPO}:latest

echo "Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REPO}

echo "Pushing image to ECR..."
docker push ${ECR_REPO}:latest

echo "✅ Image pushed successfully to ${ECR_REPO}:latest"
echo ""

# Get cluster name from Terraform or construct from project name
cd ..
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name 2>/dev/null || echo "${PROJECT_NAME}-cluster")

echo "To update the ECS service (if using processor service), run:"
echo "  aws ecs update-service --cluster ${CLUSTER_NAME} --service ${PROJECT_NAME}-processor --force-new-deployment --region ${AWS_REGION}"
