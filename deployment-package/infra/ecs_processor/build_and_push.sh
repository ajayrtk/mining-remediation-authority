#!/bin/bash
set -e

# Build and push Docker image to ECR
# Usage: ./build_and_push.sh

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-eu-west-2}

# Get ECR repository URL from Terraform output
ECR_REPO=$(cd .. && terraform output -raw ecr_repository_url 2>/dev/null || echo "")

if [ -z "$ECR_REPO" ]; then
    echo "Error: Could not get ECR repository URL from Terraform"
    echo "Run 'terraform apply' first to create the ECR repository"
    exit 1
fi

echo "Building Docker image for linux/amd64..."
docker build --platform linux/amd64 -t mra-mines-processor:latest .

echo "Tagging image for ECR..."
docker tag mra-mines-processor:latest ${ECR_REPO}:latest

echo "Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REPO}

echo "Pushing image to ECR..."
docker push ${ECR_REPO}:latest

echo "✅ Image pushed successfully to ${ECR_REPO}:latest"
echo ""
echo "To update the ECS service, run:"
echo "  aws ecs update-service --cluster mra-mines-cluster --service mra-mines-processor --force-new-deployment --region ${AWS_REGION}"
