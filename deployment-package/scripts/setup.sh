#!/bin/bash
# Setup script - checks prerequisites and prepares environment

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}MRA Mines Map - Setup & Prerequisites Check${NC}"
echo -e "${BLUE}============================================${NC}\n"

ALL_CHECKS_PASSED=true

check_command() {
    local cmd=$1
    local name=$2
    local install_url=$3

    if command -v $cmd &> /dev/null; then
        local version=$($cmd --version 2>&1 | head -n1)
        echo -e "${GREEN}✓${NC} $name is installed: $version"
        return 0
    else
        echo -e "${RED}✗${NC} $name is NOT installed"
        echo -e "  ${YELLOW}Install from: $install_url${NC}"
        ALL_CHECKS_PASSED=false
        return 1
    fi
}

echo -e "${YELLOW}1. Checking required tools...${NC}\n"

check_command "aws" "AWS CLI" "https://aws.amazon.com/cli/"
check_command "terraform" "Terraform" "https://www.terraform.io/downloads"
check_command "docker" "Docker" "https://docs.docker.com/get-docker/"
check_command "node" "Node.js" "https://nodejs.org/"
check_command "npm" "npm" "https://www.npmjs.com/get-npm"

echo ""

echo -e "${YELLOW}2. Checking AWS credentials...${NC}\n"

if aws sts get-caller-identity &> /dev/null; then
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    AWS_USER=$(aws sts get-caller-identity --query Arn --output text)
    AWS_REGION=$(aws configure get region || echo "not set")

    echo -e "${GREEN}✓${NC} AWS credentials are configured"
    echo -e "  Account ID: $AWS_ACCOUNT"
    echo -e "  User/Role:  $AWS_USER"
    echo -e "  Region:     $AWS_REGION"
else
    echo -e "${RED}✗${NC} AWS credentials are NOT configured"
    echo -e "  ${YELLOW}Run: aws configure${NC}"
    ALL_CHECKS_PASSED=false
fi

echo ""

# Check Docker daemon
echo -e "${YELLOW}3. Checking Docker daemon...${NC}\n"

if docker ps &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker daemon is running"
else
    echo -e "${RED}✗${NC} Docker daemon is NOT running"
    echo -e "  ${YELLOW}Please start Docker Desktop or Docker daemon${NC}"
    ALL_CHECKS_PASSED=false
fi

echo ""

# Check configuration file
echo -e "${YELLOW}4. Checking configuration...${NC}\n"

if [ -f "infra/terraform.tfvars" ]; then
    echo -e "${GREEN}✓${NC} infra/terraform.tfvars exists"

    # Check key settings
    if grep -q "aws_region" infra/terraform.tfvars; then
        REGION=$(grep "aws_region" infra/terraform.tfvars | cut -d'"' -f2 | head -1)
        echo -e "  Region: ${BLUE}${REGION}${NC}"
    fi

    if grep -q "use_existing_iam_roles" infra/terraform.tfvars; then
        USE_EXISTING=$(grep "use_existing_iam_roles" infra/terraform.tfvars | awk '{print $3}' | head -1)
        echo -e "  Use existing IAM roles: ${BLUE}${USE_EXISTING}${NC}"
    fi
else
    echo -e "${YELLOW}!${NC} infra/terraform.tfvars not found"
    if [ -f "infra/terraform.tfvars.example" ]; then
        echo -e "  ${BLUE}Creating infra/terraform.tfvars from example...${NC}"
        cp infra/terraform.tfvars.example infra/terraform.tfvars
        echo -e "  ${GREEN}✓${NC} Created infra/terraform.tfvars"
        echo -e "  ${YELLOW}⚠ Please edit infra/terraform.tfvars with your settings${NC}"
    else
        echo -e "  ${RED}✗${NC} infra/terraform.tfvars.example not found"
        ALL_CHECKS_PASSED=false
    fi
fi

echo ""

# Check project structure
echo -e "${YELLOW}5. Checking project structure...${NC}\n"

REQUIRED_DIRS=("infra" "frontend" "backend" "docs" "scripts")
for dir in "${REQUIRED_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✓${NC} $dir/ directory exists"
    else
        echo -e "${RED}✗${NC} $dir/ directory NOT found"
        ALL_CHECKS_PASSED=false
    fi
done

echo ""

# Summary
echo -e "${BLUE}============================================${NC}"
if [ "$ALL_CHECKS_PASSED" = true ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo -e "${GREEN}You are ready to deploy.${NC}\n"
    echo -e "Next steps:"
    echo -e "  1. Review and edit ${BLUE}infra/terraform.tfvars${NC}"
    echo -e "  2. Run ${BLUE}./scripts/deploy.sh${NC}"
    echo -e "  3. Or deploy manually:"
    echo -e "     ${BLUE}cd infra${NC}"
    echo -e "     ${BLUE}terraform init${NC}"
    echo -e "     ${BLUE}terraform plan${NC}"
    echo -e "     ${BLUE}terraform apply${NC}"
else
    echo -e "${RED}✗ Some checks failed${NC}"
    echo -e "${YELLOW}Please fix the issues above before deploying${NC}"
    exit 1
fi
echo -e "${BLUE}============================================${NC}"
