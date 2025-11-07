#!/bin/bash
# MRA Mines Map - Deployment Script
# This script automates the complete deployment process

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   MRA Mines Map - Production Deployment${NC}"
echo -e "${BLUE}================================================${NC}\n"

# Check if we're in the right directory
if [ ! -f "infra/terraform.tfvars" ]; then
    echo -e "${RED}ERROR: infra/terraform.tfvars not found${NC}"
    echo "Please run this script from the deployment-package directory"
    echo "Or create infra/terraform.tfvars from infra/terraform.tfvars.example"
    exit 1
fi

# Get deployment information
echo -e "${YELLOW}Deployment Information:${NC}"
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(grep "aws_region" infra/terraform.tfvars | cut -d'"' -f2 | head -1 || echo "eu-west-1")
AWS_USER=$(aws sts get-caller-identity --query Arn --output text | awk -F'/' '{print $NF}')

echo -e "  AWS Account: ${BLUE}${AWS_ACCOUNT}${NC}"
echo -e "  AWS Region:  ${BLUE}${AWS_REGION}${NC}"
echo -e "  Deployed by: ${BLUE}${AWS_USER}${NC}"
echo ""

# Confirmation
echo -e "${YELLOW}This will deploy the following resources:${NC}"
echo "  • VPC and networking infrastructure"
echo "  • ECS cluster and task definitions"
echo "  • CloudFront distribution with HTTPS"
echo "  • Cognito user pool for authentication"
echo "  • DynamoDB tables for data storage"
echo "  • S3 buckets for file storage"
echo "  • Lambda functions for processing"
echo "  • ECR repositories for Docker images"
echo ""
echo -e "${YELLOW}Estimated cost: $25-50/month${NC}"
echo ""

read -p "Do you want to proceed? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled"
    exit 0
fi

echo ""

# Step 1: Initialize and deploy infrastructure
echo -e "${BLUE}[1/5]${NC} ${YELLOW}Initializing Terraform...${NC}"
cd infra

if ! terraform init; then
    echo -e "${RED}ERROR: Terraform initialization failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Terraform initialized\n"

# Step 2: Plan infrastructure
echo -e "${BLUE}[2/5]${NC} ${YELLOW}Planning infrastructure changes...${NC}"
if ! terraform plan -out=tfplan; then
    echo -e "${RED}ERROR: Terraform plan failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Infrastructure plan created\n"

# Step 3: Apply infrastructure
echo -e "${BLUE}[3/5]${NC} ${YELLOW}Deploying infrastructure (this may take 5-10 minutes)...${NC}"
if ! terraform apply tfplan; then
    echo -e "${RED}ERROR: Terraform apply failed${NC}"
    exit 1
fi

# Get outputs
FRONTEND_ECR=$(terraform output -raw frontend_ecr_repository_url 2>/dev/null || echo "")
CLOUDFRONT_URL=$(terraform output -raw cloudfront_url 2>/dev/null || echo "")
COGNITO_POOL_ID=$(terraform output -raw cognito_user_pool_id 2>/dev/null || echo "")

echo -e "${GREEN}✓${NC} Infrastructure deployed\n"

cd ..

# Step 4: Build and push frontend
echo -e "${BLUE}[4/5]${NC} ${YELLOW}Building and deploying frontend application...${NC}"
echo "  • Installing dependencies..."
cd frontend
npm ci --silent

echo "  • Building application..."
npm run build

echo "  • Building Docker image..."

# Get current task DNS before deploying new version
echo "  • Checking current ECS task..."
CURRENT_TASK=$(aws ecs list-tasks --cluster mra-mines-cluster --service-name mra-mines-dev-frontend --region $AWS_REGION --query 'taskArns[0]' --output text 2>/dev/null || echo "none")

# Build and push (build_and_push.sh is in the frontend directory)
if ./build_and_push.sh; then
    echo -e "${GREEN}✓${NC} Frontend deployed to ECR\n"
else
    echo -e "${RED}ERROR: Frontend deployment failed${NC}"
    exit 1
fi

cd ../infra

# Step 5: Wait for ECS deployment and update CloudFront
echo -e "${BLUE}[5/5]${NC} ${YELLOW}Waiting for ECS deployment to complete...${NC}"
sleep 30

# Get new task DNS
echo "  • Getting new task information..."
NEW_TASK=$(aws ecs list-tasks --cluster mra-mines-cluster --service-name mra-mines-dev-frontend --region $AWS_REGION --query 'taskArns[0]' --output text 2>/dev/null || echo "")

if [ "$NEW_TASK" != "none" ] && [ -n "$NEW_TASK" ]; then
    TASK_ID=$(echo $NEW_TASK | awk -F/ '{print $NF}')
    TASK_DNS=$(aws ecs describe-tasks --cluster mra-mines-cluster --tasks $TASK_ID --region $AWS_REGION --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text | xargs -I {} aws ec2 describe-network-interfaces --network-interface-ids {} --region $AWS_REGION --query 'NetworkInterfaces[0].Association.PublicDnsName' --output text 2>/dev/null || echo "")

    if [ -n "$TASK_DNS" ]; then
        echo "  • Updating CloudFront origin..."
        # Apply with frontend_origin_domain variable
        terraform apply -var="frontend_origin_domain=$TASK_DNS" -auto-approve > /dev/null 2>&1

        echo "  • Invalidating CloudFront cache..."
        DISTRIBUTION_ID=$(terraform output -raw cloudfront_distribution_id 2>/dev/null || echo "")
        if [ -n "$DISTRIBUTION_ID" ]; then
            aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*" --region $AWS_REGION > /dev/null 2>&1
        fi

        echo -e "${GREEN}✓${NC} CloudFront updated\n"
    fi
fi

# Deployment complete
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   ✓ Deployment Complete!${NC}"
echo -e "${GREEN}================================================${NC}\n"

echo -e "${BLUE}Your application is now available at:${NC}"
echo -e "${GREEN}${CLOUDFRONT_URL}${NC}\n"

echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. Wait 2-3 minutes for CloudFront cache to clear"
echo -e "  2. Create your first admin user:"
echo -e "     ${BLUE}aws cognito-idp admin-create-user \\${NC}"
echo -e "       ${BLUE}--user-pool-id ${COGNITO_POOL_ID} \\${NC}"
echo -e "       ${BLUE}--username admin@your-domain.com \\${NC}"
echo -e "       ${BLUE}--user-attributes Name=email,Value=admin@your-domain.com \\${NC}"
echo -e "       ${BLUE}--region ${AWS_REGION}${NC}"
echo ""
echo -e "  3. Set user password:"
echo -e "     ${BLUE}aws cognito-idp admin-set-user-password \\${NC}"
echo -e "       ${BLUE}--user-pool-id ${COGNITO_POOL_ID} \\${NC}"
echo -e "       ${BLUE}--username admin@your-domain.com \\${NC}"
echo -e "       ${BLUE}--password 'YourSecurePassword123!' \\${NC}"
echo -e "       ${BLUE}--permanent \\${NC}"
echo -e "       ${BLUE}--region ${AWS_REGION}${NC}"
echo ""
echo -e "  4. Visit ${CLOUDFRONT_URL} and log in"
echo ""
echo -e "${BLUE}For troubleshooting, see: docs/troubleshooting.md${NC}"
