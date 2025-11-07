#!/bin/bash
# Import existing AWS resources into Terraform state
# This allows Terraform to manage resources that were created outside of Terraform

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Import Existing Resources into Terraform${NC}"
echo -e "${BLUE}================================================${NC}\n"

# Check if we're in the right directory
if [ ! -f "infra/terraform.tfvars" ]; then
    echo -e "${RED}ERROR: infra/terraform.tfvars not found${NC}"
    echo "Please run this script from the deployment-package directory"
    echo "Or create infra/terraform.tfvars from infra/terraform.tfvars.example"
    exit 1
fi

cd infra

# Initialize Terraform if not already done
if [ ! -d ".terraform" ]; then
    echo -e "${YELLOW}Initializing Terraform...${NC}"
    terraform init
    echo ""
fi

echo -e "${YELLOW}Checking for existing IAM roles and importing them...${NC}\n"

# List of IAM roles to check and import
declare -A IAM_ROLES=(
    ["aws_iam_role.ecs_task_execution"]="mra-mines-ecs-task-execution"
    ["aws_iam_role.ecs_task"]="mra-mines-ecs-task"
    ["aws_iam_role.input_handler"]="mra-mines-input-handler"
    ["aws_iam_role.mock_ecs"]="mra-mines-mock-ecs"
    ["aws_iam_role.output_handler"]="mra-mines-output-handler"
    ["aws_iam_role.s3_copy_processor"]="mra-mines-s3-copy-processor"
    ["aws_iam_role.pre_auth_trigger"]="mra-mines-pre-auth-trigger-role"
)

IMPORTED_COUNT=0
SKIPPED_COUNT=0
FAILED_COUNT=0

for tf_resource in "${!IAM_ROLES[@]}"; do
    role_name="${IAM_ROLES[$tf_resource]}"

    # Check if already in Terraform state
    if terraform state show "$tf_resource" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $role_name - Already in Terraform state (skipping)"
        SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
        continue
    fi

    # Check if role exists in AWS
    if aws iam get-role --role-name "$role_name" &> /dev/null; then
        echo -e "${YELLOW}→${NC} Importing $role_name..."

        if terraform import "$tf_resource" "$role_name" &> /dev/null; then
            echo -e "${GREEN}✓${NC} $role_name - Successfully imported"
            IMPORTED_COUNT=$((IMPORTED_COUNT + 1))
        else
            echo -e "${RED}✗${NC} $role_name - Import failed"
            FAILED_COUNT=$((FAILED_COUNT + 1))
        fi
    else
        echo -e "${BLUE}○${NC} $role_name - Does not exist (will be created)"
    fi
done

echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Import Summary${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "Imported:       ${GREEN}$IMPORTED_COUNT${NC}"
echo -e "Already managed: ${GREEN}$SKIPPED_COUNT${NC}"
echo -e "Failed:         ${RED}$FAILED_COUNT${NC}"
echo ""

if [ $FAILED_COUNT -gt 0 ]; then
    echo -e "${YELLOW}Some imports failed. You may need to manually resolve conflicts.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Import complete!${NC}"
echo ""
echo -e "${YELLOW}Next step:${NC}"
echo -e "  Run ${GREEN}cd infra && terraform apply${NC} to update resources"
echo ""

cd ..
