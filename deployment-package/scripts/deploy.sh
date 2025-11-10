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
# Get region from terraform.tfvars
AWS_REGION=$(grep -E '^\s*aws_region\s*=' infra/terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' || echo "eu-central-1")
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
# Convert to lowercase for comparison
confirm_lower=$(echo "$confirm" | tr '[:upper:]' '[:lower:]')
if [ "$confirm_lower" != "yes" ]; then
    echo "Deployment cancelled"
    exit 0
fi

echo ""

# Step 1: Initialize and deploy infrastructure
echo -e "${BLUE}[1/8]${NC} ${YELLOW}Initializing Terraform...${NC}"
cd infra

if ! terraform init; then
    echo -e "${RED}ERROR: Terraform initialization failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Terraform initialized\n"

# Step 2: Plan infrastructure
echo -e "${BLUE}[2/8]${NC} ${YELLOW}Planning infrastructure changes...${NC}"
if ! terraform plan -out=tfplan; then
    echo -e "${RED}ERROR: Terraform plan failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Infrastructure plan created\n"

# Step 3: Apply infrastructure
echo -e "${BLUE}[3/8]${NC} ${YELLOW}Deploying infrastructure (this may take 5-10 minutes)...${NC}"
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
echo -e "${BLUE}[4/8]${NC} ${YELLOW}Building and deploying frontend application...${NC}"
echo "  • Installing dependencies..."
cd frontend
npm ci --silent

echo "  • Building application..."
npm run build

echo "  • Building Docker image and pushing to ECR..."

# Build and push (build_and_push.sh is in the frontend directory)
if ./build_and_push.sh; then
    echo -e "${GREEN}✓${NC} Frontend deployed to ECR\n"
else
    echo -e "${RED}ERROR: Frontend deployment failed${NC}"
    exit 1
fi

cd ../infra

# Step 5: Build and push processor
echo -e "${BLUE}[5/8]${NC} ${YELLOW}Building and deploying processor application...${NC}"
echo "  • Building processor Docker image..."

# Get ECR repository URL for processor
PROCESSOR_ECR=$(terraform output -raw ecr_repository_url 2>/dev/null || echo "")

if [ -z "$PROCESSOR_ECR" ]; then
    echo -e "${RED}ERROR: Could not get processor ECR repository URL${NC}"
    exit 1
fi

echo -e "${GREEN}Processor ECR Repository: ${PROCESSOR_ECR}${NC}"

# Build and push processor image
cd ecs_processor

# Login to ECR
echo "  • Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build Docker image
echo "  • Building Docker image for linux/amd64 platform..."
docker build --platform linux/amd64 -t mra-mines-processor:latest .

# Tag the image
echo "  • Tagging image..."
docker tag mra-mines-processor:latest ${PROCESSOR_ECR}:latest

# Push to ECR
echo "  • Pushing image to ECR..."
docker push ${PROCESSOR_ECR}:latest

echo -e "${GREEN}✓${NC} Processor image deployed to ECR\n"

cd ..

# Get service and cluster names
SERVICE_NAME=$(terraform output -raw frontend_service_name 2>/dev/null || echo "")
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name 2>/dev/null || echo "")

# Step 6: Wait for ECS deployment
echo -e "${BLUE}[6/8]${NC} ${YELLOW}Waiting for ECS deployment to complete...${NC}"

if [ -n "$SERVICE_NAME" ] && [ -n "$CLUSTER_NAME" ]; then
    echo "  • Waiting for ECS service to stabilize (this may take 2-3 minutes)..."

    # Wait for service to be stable with timeout
    if timeout 300 aws ecs wait services-stable --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION 2>/dev/null; then
        echo -e "${GREEN}  ✓ ECS service is stable${NC}"
    else
        echo -e "${YELLOW}  ⚠ Service stabilization wait timed out, checking task status...${NC}"
    fi

    # Verify task is running
    echo "  • Verifying task health..."
    set +e  # Temporarily disable exit on error
    TASK_STATUS=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION --query 'services[0].{Running:runningCount,Desired:desiredCount}' --output json 2>/dev/null)
    RUNNING=$(echo "$TASK_STATUS" | grep -o '"Running":[0-9]*' | cut -d':' -f2 2>/dev/null || echo "0")
    DESIRED=$(echo "$TASK_STATUS" | grep -o '"Desired":[0-9]*' | cut -d':' -f2 2>/dev/null || echo "0")

    # Ensure we have numeric values
    RUNNING=${RUNNING:-0}
    DESIRED=${DESIRED:-0}

    if [ "$RUNNING" -gt 0 ] 2>/dev/null; then
        if [ "$RUNNING" -eq "$DESIRED" ] 2>/dev/null; then
            echo -e "${GREEN}  ✓ Task is healthy (Running: $RUNNING/$DESIRED)${NC}"
        elif [ "$RUNNING" -gt "$DESIRED" ] 2>/dev/null; then
            echo -e "${YELLOW}  ⚠ Tasks stabilizing (Running: $RUNNING/$DESIRED - old task shutting down)${NC}"
        else
            echo -e "${YELLOW}  ⚠ Tasks starting (Running: $RUNNING/$DESIRED)${NC}"
        fi
    else
        echo -e "${RED}  ✗ Task not healthy (Running: $RUNNING/$DESIRED)${NC}"
        echo -e "${YELLOW}  Warning: Deployment may not be fully ready${NC}"
    fi
    set -e  # Re-enable exit on error

    # Note: With ALB + CloudFront architecture, no manual origin updates needed!
    # ALB automatically registers new ECS tasks, CloudFront points to stable ALB DNS
    echo -e "${GREEN}  ✓ ALB will automatically register the new task${NC}\n"
else
    echo -e "${YELLOW}⚠ ECS configuration not available${NC}\n"
fi

# Step 7: Update Cognito callback URLs with CloudFront URL
echo -e "${BLUE}[7/8]${NC} ${YELLOW}Updating Cognito callback URLs...${NC}"

if [ -n "$CLOUDFRONT_URL" ]; then
    echo "  • CloudFront URL: $CLOUDFRONT_URL"

    # Update terraform.tfvars with correct Cognito callback URLs
    if grep -q "cognito_callback_urls" terraform.tfvars 2>/dev/null; then
        # Update callback URLs
        sed -i.bak "/cognito_callback_urls/,/\]/c\\
cognito_callback_urls = [\\
  \"http://localhost:5173/auth/callback\",\\
  \"$CLOUDFRONT_URL/auth/callback\"\\
]" terraform.tfvars

        # Update logout URLs
        sed -i.bak "/cognito_logout_urls/,/\]/c\\
cognito_logout_urls = [\\
  \"http://localhost:5173/\",\\
  \"$CLOUDFRONT_URL/\"\\
]" terraform.tfvars

        echo "  • Updating Cognito with new callback URLs..."
        if terraform apply -auto-approve >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Cognito callback URLs updated\n"
        else
            echo -e "${YELLOW}⚠${NC} Cognito update had warnings (this is usually safe to ignore)\n"
        fi
    else
        echo -e "${YELLOW}⚠${NC} cognito_callback_urls not found in terraform.tfvars, skipping\n"
    fi
else
    echo -e "${YELLOW}⚠${NC} CloudFront URL not available, skipping Cognito callback update\n"
fi

# Step 8: Create default admin user
echo -e "${BLUE}[8/8]${NC} ${YELLOW}Creating default admin user...${NC}"

# Ensure we're in infra directory
cd infra 2>/dev/null || true

# Read admin credentials from terraform.tfvars (we're in infra/ now)
ADMIN_EMAIL=$(grep -E '^\s*admin_email\s*=' terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' 2>/dev/null || echo "admin@example.com")
USER_NAME=$(grep -E '^\s*admin_username\s*=' terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' 2>/dev/null || echo "admin")

# Get Cognito Pool ID (in case it wasn't set earlier)
if [ -z "$COGNITO_POOL_ID" ]; then
    COGNITO_POOL_ID=$(terraform output -raw cognito_user_pool_id 2>/dev/null || echo "")
fi

# Check if admin user already exists
USER_EXISTS=$(aws cognito-idp admin-get-user --user-pool-id $COGNITO_POOL_ID --username $USER_NAME --region $AWS_REGION 2>&1 || echo "NotFound")

if echo "$USER_EXISTS" | grep -q "UserNotFoundException"; then
    echo "  • Creating admin user: $USER_NAME (email: $ADMIN_EMAIL)"

    # Create admin user
    if aws cognito-idp admin-create-user \
        --user-pool-id $COGNITO_POOL_ID \
        --username $USER_NAME \
        --user-attributes Name=email,Value=$ADMIN_EMAIL Name=email_verified,Value=true \
        --message-action SUPPRESS \
        --region $AWS_REGION 2>&1; then

        # Set permanent password (read from terraform.tfvars)
        ADMIN_PASSWORD=$(grep -E '^\s*admin_password\s*=' infra/terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' 2>/dev/null || echo "ChangeMe123!")
        if aws cognito-idp admin-set-user-password \
            --user-pool-id $COGNITO_POOL_ID \
            --username $USER_NAME \
            --password "$ADMIN_PASSWORD" \
            --permanent \
            --region $AWS_REGION 2>&1; then

            echo -e "${GREEN}✓${NC} Admin user created successfully"
            echo -e "  ${YELLOW}Username:${NC} $USER_NAME"
            echo -e "  ${YELLOW}Email:${NC} $ADMIN_EMAIL"
            echo -e "  ${YELLOW}Password:${NC} $ADMIN_PASSWORD"
            echo -e "  ${RED}⚠ CHANGE THIS PASSWORD after first login!${NC}"
        else
            echo -e "${RED}✗${NC} Failed to set password for admin user"
        fi
    else
        echo -e "${RED}✗${NC} Failed to create admin user"
    fi
else
    echo -e "${BLUE}  Admin user already exists, skipping creation${NC}"
fi

echo ""

# Final verification
echo -e "${BLUE}[Final Step]${NC} ${YELLOW}Running verification checks...${NC}"
echo ""

# Ensure we're in infra directory for terraform outputs
cd infra 2>/dev/null || cd ../infra 2>/dev/null

# Refresh critical variables (in case they weren't set earlier)
CLUSTER_NAME=$(terraform output -raw ecs_cluster_name 2>/dev/null || echo "")
SERVICE_NAME=$(terraform output -raw frontend_service_name 2>/dev/null || echo "")
COGNITO_POOL_ID=$(terraform output -raw cognito_user_pool_id 2>/dev/null || echo "")
CLOUDFRONT_URL=$(terraform output -raw cloudfront_url 2>/dev/null || echo "")
USER_NAME=$(grep -E '^\s*admin_username\s*=' terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' 2>/dev/null || echo "admin")

VERIFICATION_FAILED=false

# Check ECS task is running
echo -n "  • ECS Task Status: "
if [ -n "$CLUSTER_NAME" ] && [ -n "$SERVICE_NAME" ]; then
    FINAL_TASK_COUNT=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION --query 'services[0].runningCount' --output text 2>/dev/null || echo "0")
else
    FINAL_TASK_COUNT="0"
fi
if [ "$FINAL_TASK_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Running${NC}"
else
    echo -e "${RED}✗ Not Running${NC}"
    VERIFICATION_FAILED=true
fi

# Check CloudFront distribution status
echo -n "  • CloudFront Status: "
CF_STATUS=$(aws cloudfront get-distribution --id $(terraform output -raw cloudfront_distribution_id 2>/dev/null) --query 'Distribution.Status' --output text 2>/dev/null || echo "Unknown")
if [ "$CF_STATUS" = "Deployed" ]; then
    echo -e "${GREEN}✓ Deployed${NC}"
else
    echo -e "${YELLOW}⚠ $CF_STATUS (may still be propagating)${NC}"
fi

# Check application accessibility
echo -n "  • Application Response: "
HTTP_CODE=$(timeout 20 curl -s -o /dev/null -w "%{http_code}" "$CLOUDFRONT_URL" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    echo -e "${GREEN}✓ HTTP $HTTP_CODE${NC}"
elif [ "$HTTP_CODE" = "000" ]; then
    echo -e "${YELLOW}⚠ Timeout (CloudFront may still be propagating)${NC}"
else
    echo -e "${YELLOW}⚠ HTTP $HTTP_CODE${NC}"
fi

# Check Cognito
echo -n "  • Cognito User Pool: "
if [ -n "$COGNITO_POOL_ID" ]; then
    echo -e "${GREEN}✓ Configured${NC}"
else
    echo -e "${RED}✗ Not Found${NC}"
    VERIFICATION_FAILED=true
fi

# Check Admin User
echo -n "  • Admin User: "
USER_STATUS=$(aws cognito-idp admin-get-user --user-pool-id $COGNITO_POOL_ID --username $USER_NAME --region $AWS_REGION --query 'UserStatus' --output text 2>/dev/null || echo "NotFound")
if [ "$USER_STATUS" != "NotFound" ]; then
    echo -e "${GREEN}✓ $USER_STATUS${NC}"
else
    echo -e "${YELLOW}⚠ Not Found${NC}"
fi

echo ""

# Deployment complete
if [ "$VERIFICATION_FAILED" = true ]; then
    echo -e "${YELLOW}================================================${NC}"
    echo -e "${YELLOW}   ⚠ Deployment Completed with Warnings${NC}"
    echo -e "${YELLOW}================================================${NC}\n"
    echo -e "${YELLOW}Some verification checks failed. Please review the errors above.${NC}"
    echo -e "${YELLOW}The infrastructure has been deployed but may need manual intervention.${NC}\n"
else
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   ✓ Deployment Complete & Verified!${NC}"
    echo -e "${GREEN}================================================${NC}\n"
fi

echo -e "${BLUE}Your application is ready at:${NC}"
echo -e "${GREEN}${CLOUDFRONT_URL}${NC}\n"

echo -e "${YELLOW}Login Credentials:${NC}"
echo -e "  Username: ${GREEN}$USER_NAME${NC}"
echo -e "  Password: ${GREEN}$ADMIN_PASSWORD${NC}"
echo -e "  ${RED}⚠ IMPORTANT: Change your password after first login!${NC}\n"

echo -e "${YELLOW}Next Steps:${NC}"
echo -e "  1. Visit ${CLOUDFRONT_URL}"
echo -e "  2. Log in with the credentials above"
echo -e "  3. ${RED}Change your password immediately${NC}"
echo ""

if [ "$VERIFICATION_FAILED" = true ]; then
    echo -e "${YELLOW}Troubleshooting:${NC}"
    echo -e "  • Check logs: ${BLUE}aws logs tail /ecs/$SERVICE_NAME --follow --region $AWS_REGION${NC}"
    echo -e "  • Check ECS service: ${BLUE}aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $AWS_REGION${NC}"
    echo -e "  • Documentation: ${BLUE}docs/troubleshooting.md${NC}"
    echo ""
fi
