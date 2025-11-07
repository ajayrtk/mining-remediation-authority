#!/bin/bash
# Import all existing AWS resources into Terraform state
set +e  # Don't exit on errors

echo "=========================================="
echo "  Importing Existing AWS Resources"
echo "=========================================="
echo ""

REGION="eu-west-1"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Track results
SUCCESS=0
FAILED=0
SKIPPED=0

import_resource() {
    local resource_address=$1
    local resource_id=$2
    local resource_name=$3

    # Check if already in state
    if terraform state show "$resource_address" &> /dev/null; then
        echo -e "${YELLOW}⊙${NC} $resource_name - Already in state (skipping)"
        SKIPPED=$((SKIPPED + 1))
        return
    fi

    # Try to import
    echo -n "  → Importing $resource_name... "
    if terraform import "$resource_address" "$resource_id" &> /dev/null; then
        echo -e "${GREEN}✓${NC}"
        SUCCESS=$((SUCCESS + 1))
    else
        echo -e "${RED}✗${NC}"
        FAILED=$((FAILED + 1))
    fi
}

echo "1. Importing ECR Repositories..."
import_resource "aws_ecr_repository.processor" "mra-mines-processor" "ECR processor repository"
import_resource "aws_ecr_repository.frontend" "mra-mines-dev-frontend" "ECR frontend repository"
echo ""

echo "2. Importing S3 Buckets..."
import_resource "aws_s3_bucket.map_input" "mra-mines-dev-mra-map-input" "S3 input bucket"
import_resource "aws_s3_bucket.map_outputs" "mra-mines-dev-mra-map-output" "S3 output bucket"
echo ""

echo "3. Importing DynamoDB Tables..."
import_resource "aws_dynamodb_table.map_jobs" "mra-mines-dev-maps-job" "DynamoDB jobs table"
import_resource "aws_dynamodb_table.maps" "mra-mines-dev-maps" "DynamoDB maps table"
echo ""

echo "4. Importing ECS Resources..."
import_resource "aws_ecs_cluster.main" "mra-mines-cluster" "ECS cluster"

# Get ECS service ARN if exists
SERVICE_ARN=$(aws ecs list-services --cluster mra-mines-cluster --region $REGION --query 'serviceArns[?contains(@, `frontend`)]' --output text 2>/dev/null | head -1)
if [ -n "$SERVICE_ARN" ]; then
    import_resource "aws_ecs_service.frontend" "$SERVICE_ARN" "ECS frontend service"
fi
echo ""

echo "5. Importing Cognito Resources..."
# Get Cognito User Pool ID
POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region $REGION --query "UserPools[?Name=='mra-mines-dev-users'].Id" --output text 2>/dev/null)
if [ -n "$POOL_ID" ]; then
    import_resource "aws_cognito_user_pool.users" "$POOL_ID" "Cognito user pool"

    # Get User Pool Client ID
    CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id $POOL_ID --region $REGION --query "UserPoolClients[0].ClientId" --output text 2>/dev/null)
    if [ -n "$CLIENT_ID" ]; then
        import_resource "aws_cognito_user_pool_client.frontend" "$POOL_ID/${CLIENT_ID}" "Cognito user pool client"
    fi
fi
echo ""

echo "6. Importing VPC Resources..."
# Get VPC ID by name tag
VPC_ID=$(aws ec2 describe-vpcs --filters "Name=tag:Name,Values=mra-mines-vpc" --region $REGION --query "Vpcs[0].VpcId" --output text 2>/dev/null)
if [ -n "$VPC_ID" ] && [ "$VPC_ID" != "None" ]; then
    import_resource "aws_vpc.main" "$VPC_ID" "VPC"

    # Import subnets
    SUBNET_IDS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --region $REGION --query "Subnets[*].SubnetId" --output text 2>/dev/null)
    for subnet_id in $SUBNET_IDS; do
        SUBNET_NAME=$(aws ec2 describe-subnets --subnet-ids $subnet_id --region $REGION --query "Subnets[0].Tags[?Key=='Name'].Value" --output text 2>/dev/null)
        if [[ "$SUBNET_NAME" == *"public-a"* ]]; then
            import_resource "aws_subnet.public_a" "$subnet_id" "Public subnet A"
        elif [[ "$SUBNET_NAME" == *"public-b"* ]]; then
            import_resource "aws_subnet.public_b" "$subnet_id" "Public subnet B"
        fi
    done

    # Import Internet Gateway
    IGW_ID=$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$VPC_ID" --region $REGION --query "InternetGateways[0].InternetGatewayId" --output text 2>/dev/null)
    if [ -n "$IGW_ID" ] && [ "$IGW_ID" != "None" ]; then
        import_resource "aws_internet_gateway.main" "$IGW_ID" "Internet Gateway"
    fi
fi
echo ""

echo "7. Importing CloudFront Distribution..."
DIST_ID=$(aws cloudfront list-distributions --region us-east-1 --query "DistributionList.Items[?Comment=='mra-mines-dev-frontend'].Id" --output text 2>/dev/null | head -1)
if [ -n "$DIST_ID" ] && [ "$DIST_ID" != "None" ]; then
    import_resource "aws_cloudfront_distribution.frontend" "$DIST_ID" "CloudFront distribution"
fi
echo ""

echo "=========================================="
echo "  Import Summary"
echo "=========================================="
echo -e "${GREEN}Successful:${NC} $SUCCESS"
echo -e "${YELLOW}Skipped:${NC}    $SKIPPED"
echo -e "${RED}Failed:${NC}     $FAILED"
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${YELLOW}⚠ Some imports failed. This is normal if those resources don't exist yet.${NC}"
fi

echo -e "${GREEN}✓ Import process complete!${NC}"
echo ""
echo "Next step: Run deployment"
echo "  cd .. && ./scripts/deploy.sh"
