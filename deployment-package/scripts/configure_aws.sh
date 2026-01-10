#!/bin/bash
# AWS Configuration Script - Loads AWS credentials from .env
# This script validates and configures AWS credentials for deployment

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}Configuring AWS credentials...${NC}"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}ERROR: .env file not found${NC}"
    echo -e "${YELLOW}Please create .env from .env.example and configure AWS credentials${NC}"
    echo -e "${YELLOW}Run: cp .env.example .env${NC}"
    exit 1
fi

# Load environment variables from .env
set -a  # Export all variables
source .env
set +a

# Validate required AWS credentials
MISSING_VARS=()

if [ -z "$AWS_ACCESS_KEY_ID" ]; then
    MISSING_VARS+=("AWS_ACCESS_KEY_ID")
fi

if [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    MISSING_VARS+=("AWS_SECRET_ACCESS_KEY")
fi

if [ -z "$AWS_DEFAULT_REGION" ]; then
    MISSING_VARS+=("AWS_DEFAULT_REGION")
fi

# Check if any required variables are missing
if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}ERROR: Missing required AWS credentials in .env${NC}"
    echo -e "${YELLOW}Please set the following variables:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo -e "  - ${var}"
    done
    echo ""
    echo -e "${YELLOW}Example:${NC}"
    echo -e "  AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
    echo -e "  AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    echo -e "  AWS_DEFAULT_REGION=eu-west-2"
    echo ""
    echo -e "${YELLOW}Get credentials from: https://console.aws.amazon.com/iam/${NC}"
    exit 1
fi

# Export AWS credentials as environment variables
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION

# Validate AWS credentials by attempting to get caller identity
echo -e "${YELLOW}Validating AWS credentials...${NC}"
if AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>&1); then
    AWS_USER=$(aws sts get-caller-identity --query Arn --output text | awk -F'/' '{print $NF}')
    echo -e "${GREEN}✓${NC} AWS credentials validated successfully"
    echo -e "  Account ID: ${BLUE}${AWS_ACCOUNT}${NC}"
    echo -e "  Region:     ${BLUE}${AWS_DEFAULT_REGION}${NC}"
    echo -e "  User/Role:  ${BLUE}${AWS_USER}${NC}"
    echo ""
else
    echo -e "${RED}✗ AWS credential validation failed${NC}"
    echo -e "${YELLOW}Error:${NC}"
    echo "$AWS_ACCOUNT"
    echo ""
    echo -e "${YELLOW}Please check your AWS credentials in .env:${NC}"
    echo -e "  1. Verify AWS_ACCESS_KEY_ID is correct"
    echo -e "  2. Verify AWS_SECRET_ACCESS_KEY is correct"
    echo -e "  3. Ensure the IAM user has necessary permissions"
    echo -e "  4. Check the credentials haven't expired"
    exit 1
fi

# Check if AWS CLI is configured (optional - we're using env vars)
if [ -f ~/.aws/credentials ]; then
    echo -e "${YELLOW}Note: Existing AWS CLI configuration found at ~/.aws/credentials${NC}"
    echo -e "${YELLOW}Environment variables from .env will take precedence${NC}"
    echo ""
fi

# Test S3 access (optional but recommended)
echo -e "${YELLOW}Testing AWS permissions...${NC}"
if aws s3 ls > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} S3 access confirmed"
else
    echo -e "${YELLOW}⚠${NC} Warning: Cannot list S3 buckets (may be due to permissions)"
    echo -e "${YELLOW}  Deployment may fail if IAM user lacks required permissions${NC}"
fi

echo -e "${GREEN}✓${NC} AWS configuration complete\n"
