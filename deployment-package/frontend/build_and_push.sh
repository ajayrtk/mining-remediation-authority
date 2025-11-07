#!/bin/bash

# Script to build and push frontend Docker image to ECR

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Frontend Docker Build and Push ===${NC}"

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get region from Terraform or use environment variable
cd ../infra
AWS_REGION=$(terraform output -raw aws_region 2>/dev/null || terraform output -raw aws_region 2>&1 | grep -v "Error" || echo "${AWS_REGION:-eu-west-1}")

# If we still don't have a region, try to get it from terraform state
if [ "$AWS_REGION" = "eu-west-2" ] || [ -z "$AWS_REGION" ]; then
    AWS_REGION=$(grep -r "aws_region" terraform.tfvars 2>/dev/null | cut -d'"' -f2 || echo "eu-west-1")
fi

echo -e "${YELLOW}Using AWS Region: ${AWS_REGION}${NC}"

# Get ECR repository URL from Terraform output
ECR_REPO=$(terraform output -raw frontend_ecr_repository_url 2>/dev/null || true)

if [ -z "$ECR_REPO" ]; then
    echo -e "${RED}Error: Could not get ECR repository URL from Terraform${NC}"
    echo -e "${YELLOW}Make sure you've run 'terraform apply' in the infra directory${NC}"
    exit 1
fi

echo -e "${GREEN}ECR Repository: ${ECR_REPO}${NC}"

# Login to ECR
echo -e "${YELLOW}Logging in to ECR...${NC}"
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build Docker image
cd ../frontend
echo -e "${YELLOW}Building Docker image for linux/amd64 platform...${NC}"
docker build --platform linux/amd64 -t frontend:latest .

# Tag the image
echo -e "${YELLOW}Tagging image...${NC}"
docker tag frontend:latest ${ECR_REPO}:latest

# Push to ECR
echo -e "${YELLOW}Pushing image to ECR...${NC}"
docker push ${ECR_REPO}:latest

echo -e "${GREEN}✅ Docker image successfully pushed to ECR!${NC}"
echo -e "${GREEN}Image: ${ECR_REPO}:latest${NC}"

# Update ECS service to use new image
echo -e "${YELLOW}Updating ECS service...${NC}"
cd ../infra
SERVICE_NAME=$(terraform output -raw frontend_service_name 2>/dev/null || echo "mra-mines-dev-frontend")
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name 2>/dev/null || echo "mra-mines-dev-cluster")

echo -e "${GREEN}Forcing new deployment of ECS service...${NC}"
aws ecs update-service --cluster ${CLUSTER_NAME} --service ${SERVICE_NAME} --force-new-deployment --region ${AWS_REGION} > /dev/null

echo -e "${GREEN}✅ ECS service update triggered!${NC}"
echo -e "${YELLOW}Note: It may take a few minutes for the new version to be deployed${NC}"

# Show the frontend URL (if available)
FRONTEND_URL=$(terraform output -raw frontend_url 2>/dev/null || true)
if [ -n "$FRONTEND_URL" ]; then
    echo -e "${GREEN}Frontend URL: ${FRONTEND_URL}${NC}"
fi

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
