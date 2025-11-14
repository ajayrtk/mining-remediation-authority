#!/bin/bash
# Imports existing AWS resources into Terraform state

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Import Existing Resources into Terraform${NC}"
echo -e "${BLUE}================================================${NC}\n"

if [ ! -f "infra/terraform.tfvars" ]; then
    echo -e "${RED}ERROR: infra/terraform.tfvars not found${NC}"
    echo "Please run this script from the deployment-package directory"
    echo "Or create infra/terraform.tfvars from infra/terraform.tfvars.example"
    exit 1
fi

cd infra

if [ ! -d ".terraform" ]; then
    echo -e "${YELLOW}Initializing Terraform...${NC}"
    terraform init
    echo ""
fi

PROJECT_NAME=$(grep -E '^\s*project_name\s*=' terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' || echo "mra-mines")
ENVIRONMENT=$(grep -E '^\s*environment\s*=' terraform.tfvars | sed 's/.*=\s*"\(.*\)".*/\1/' || echo "staging")

echo -e "${YELLOW}Configuration:${NC}"
echo -e "  Project:     ${BLUE}${PROJECT_NAME}${NC}"
echo -e "  Environment: ${BLUE}${ENVIRONMENT}${NC}"
echo ""

echo -e "${YELLOW}Checking for existing IAM roles and importing them...${NC}\n"

# List of IAM roles to check and import
declare -A IAM_ROLES=(
    ["aws_iam_role.ecs_task_execution"]="${PROJECT_NAME}-ecs-task-execution-${ENVIRONMENT}"
    ["aws_iam_role.ecs_task"]="${PROJECT_NAME}-ecs-task-${ENVIRONMENT}"
    ["aws_iam_role.input_handler"]="${PROJECT_NAME}-input-handler-${ENVIRONMENT}"
    ["aws_iam_role.mock_ecs"]="${PROJECT_NAME}-mock-ecs-${ENVIRONMENT}"
    ["aws_iam_role.output_handler"]="${PROJECT_NAME}-output-handler-${ENVIRONMENT}"
    ["aws_iam_role.s3_copy_processor"]="${PROJECT_NAME}-s3-copy-processor-${ENVIRONMENT}"
    ["aws_iam_role.pre_auth_trigger"]="${PROJECT_NAME}-pre-auth-trigger-role-${ENVIRONMENT}"
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
