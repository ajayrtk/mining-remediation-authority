#!/bin/bash
set -e

# Build and push Docker image to ECR
# Usage: ./build_and_push.sh

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Determine script directory and navigate appropriately
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Get region from Terraform output (with fallback to terraform.tfvars)
TERRAFORM_REGION=$(terraform output -raw aws_region 2>/dev/null || echo "")
if [ -z "$TERRAFORM_REGION" ]; then
    TERRAFORM_REGION=$(grep -E '^\s*aws_region\s*=' terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "")
    AWS_REGION=${TERRAFORM_REGION:-${AWS_REGION:-$(aws configure get region)}}
else
    AWS_REGION=$TERRAFORM_REGION
fi

# Get project name and environment from terraform.tfvars
PROJECT_NAME=$(grep -E '^\s*project_name\s*=' terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "mra-mines")
ENVIRONMENT=$(grep -E '^\s*environment\s*=' terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "staging")

echo "Using AWS Region: $AWS_REGION"
echo "Project Name: $PROJECT_NAME"
echo "Environment: $ENVIRONMENT"
echo ""

# Get ECR repository URL from Terraform output
ECR_REPO=$(terraform output -raw ecr_repository_url 2>/dev/null || echo "")

if [ -z "$ECR_REPO" ]; then
    echo "Error: Could not get ECR repository URL from Terraform"
    echo "Run 'terraform apply' first to create the ECR repository"
    exit 1
fi

# Navigate to ecs_processor directory for Docker build
cd "$SCRIPT_DIR"

echo "Building Docker image for linux/amd64..."
docker build --platform linux/amd64 -t ${PROJECT_NAME}-processor:latest .

echo "Tagging image for ECR..."
docker tag ${PROJECT_NAME}-processor:latest ${ECR_REPO}:latest

# Extract registry URL from ECR_REPO (removes repository name)
ECR_REGISTRY=$(echo ${ECR_REPO} | cut -d'/' -f1)

echo "Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

echo "Pushing image to ECR..."
docker push ${ECR_REPO}:latest

echo "✅ Image pushed successfully to ${ECR_REPO}:latest"
echo ""

# Get cluster name from Terraform or construct from project name
cd "$SCRIPT_DIR/.."
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name 2>/dev/null || echo "${PROJECT_NAME}-cluster-${ENVIRONMENT}")

echo "To update the ECS service (if using processor service), run:"
echo "  aws ecs update-service --cluster ${CLUSTER_NAME} --service ${PROJECT_NAME}-processor-${ENVIRONMENT} --force-new-deployment --region ${AWS_REGION}"
