#!/bin/bash
# Quick script to delete conflicting IAM roles
# Run this before deploying with use_existing_iam_roles = false

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Deleting conflicting IAM roles...${NC}\n"

# Get project name and environment from terraform.tfvars
if [ -f "infra/terraform.tfvars" ]; then
    PROJECT_NAME=$(grep -E '^\s*project_name\s*=' infra/terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "mra-mines")
    ENVIRONMENT=$(grep -E '^\s*environment\s*=' infra/terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "staging")
else
    echo -e "${RED}Error: infra/terraform.tfvars not found${NC}"
    echo "Please run this script from the deployment-package directory"
    exit 1
fi

echo -e "${YELLOW}Project: ${PROJECT_NAME}${NC}"
echo -e "${YELLOW}Environment: ${ENVIRONMENT}${NC}\n"

# List of IAM roles to delete (with environment suffix)
ROLES=(
    "${PROJECT_NAME}-ecs-task-execution-${ENVIRONMENT}"
    "${PROJECT_NAME}-ecs-task-${ENVIRONMENT}"
    "${PROJECT_NAME}-input-handler-${ENVIRONMENT}"
    "${PROJECT_NAME}-mock-ecs-${ENVIRONMENT}"
    "${PROJECT_NAME}-output-handler-${ENVIRONMENT}"
    "${PROJECT_NAME}-s3-copy-processor-${ENVIRONMENT}"
    "${PROJECT_NAME}-pre-auth-trigger-role-${ENVIRONMENT}"
    "${PROJECT_NAME}-frontend-task-execution-${ENVIRONMENT}"
    "${PROJECT_NAME}-frontend-task-${ENVIRONMENT}"
    "${PROJECT_NAME}-cognito-authenticated-${ENVIRONMENT}"
)

DELETED=0
SKIPPED=0

for role_name in "${ROLES[@]}"; do
    # Check if role exists
    if aws iam get-role --role-name "$role_name" >/dev/null 2>&1; then
        echo -n "  • Deleting $role_name... "

        # Detach all managed policies
        ATTACHED_POLICIES=$(aws iam list-attached-role-policies --role-name "$role_name" --query 'AttachedPolicies[*].PolicyArn' --output text 2>/dev/null || echo "")
        for policy_arn in $ATTACHED_POLICIES; do
            aws iam detach-role-policy --role-name "$role_name" --policy-arn "$policy_arn" 2>/dev/null || true
        done

        # Delete all inline policies
        INLINE_POLICIES=$(aws iam list-role-policies --role-name "$role_name" --query 'PolicyNames[*]' --output text 2>/dev/null || echo "")
        for policy_name in $INLINE_POLICIES; do
            aws iam delete-role-policy --role-name "$role_name" --policy-name "$policy_name" 2>/dev/null || true
        done

        # Delete the role
        if aws iam delete-role --role-name "$role_name" 2>/dev/null; then
            echo -e "${GREEN}✓${NC}"
            DELETED=$((DELETED + 1))
        else
            echo -e "${RED}✗${NC}"
        fi
    else
        SKIPPED=$((SKIPPED + 1))
    fi
done

echo ""
echo -e "${GREEN}Deleted: $DELETED roles${NC}"
echo -e "${YELLOW}Skipped: $SKIPPED roles (didn't exist)${NC}"
echo ""
echo -e "${GREEN}Done! You can now run terraform apply${NC}"
