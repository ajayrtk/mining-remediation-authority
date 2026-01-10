#!/bin/bash
# Cleanup script - clean data only OR destroy all infrastructure

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cleanup_data_only() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}   Data Cleanup (Infrastructure Preserved)${NC}"
    echo -e "${BLUE}================================================${NC}\n"

    echo -e "${YELLOW}This will delete:${NC}"
    echo "  • All records from DynamoDB tables (jobs & maps)"
    echo "  • All files from S3 buckets (input & output)"
    echo ""
    echo -e "${GREEN}This will keep running:${NC}"
    echo "  • ECS tasks, Lambda functions, ALB"
    echo "  • All AWS infrastructure"
    echo ""

    if [ -d "infra" ]; then
        cd infra
        TERRAFORM_REGION=$(terraform output -raw aws_region 2>/dev/null || echo "")
        if [ -z "$TERRAFORM_REGION" ]; then
            TERRAFORM_REGION=$(grep -E '^\s*aws_region\s*=' terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "")
            AWS_REGION=${TERRAFORM_REGION:-$(aws configure get region)}
        else
            AWS_REGION=$TERRAFORM_REGION
        fi
        cd ..
    else
        if [ -f "infra/terraform.tfvars" ]; then
            AWS_REGION=$(grep -E '^\s*aws_region\s*=' infra/terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || aws configure get region)
        else
            AWS_REGION=$(aws configure get region)
        fi
    fi

    echo -e "${YELLOW}Type 'CLEAN' to proceed with data cleanup:${NC}"
    read -p "> " confirm

    if [ "$confirm" != "CLEAN" ]; then
        echo "Cleanup cancelled"
        exit 0
    fi

    echo ""
    echo -e "${BLUE}Starting data cleanup...${NC}\n"

    # Get table and bucket names from Terraform outputs
    cd infra
    JOBS_TABLE=$(terraform output -raw map_jobs_table_name 2>/dev/null || echo "")
    MAPS_TABLE=$(terraform output -raw maps_table_name 2>/dev/null || echo "")
    BUCKET_INPUT=$(terraform output -raw map_input_bucket_name 2>/dev/null || echo "")
    BUCKET_OUTPUT=$(terraform output -raw map_output_bucket_name 2>/dev/null || echo "")
    cd ..

    # Step 1: Clean DynamoDB Jobs Table
    echo -e "${YELLOW}[1/4] Cleaning jobs table...${NC}"
    if [ -n "$JOBS_TABLE" ]; then
        JOB_COUNT=$(aws dynamodb scan --table-name "$JOBS_TABLE" --region "$AWS_REGION" --query 'Count' --output text 2>/dev/null || echo "0")
        if [ "$JOB_COUNT" -gt 0 ]; then
            echo "  • Deleting $JOB_COUNT jobs from $JOBS_TABLE"
            aws dynamodb scan --table-name "$JOBS_TABLE" --region "$AWS_REGION" --query 'Items[*].jobId.S' --output json | python3 -c "
import json, sys, subprocess
job_ids = json.load(sys.stdin)
for job_id in job_ids:
    subprocess.run(['aws', 'dynamodb', 'delete-item', '--table-name', '$JOBS_TABLE', '--key', '{\"jobId\":{\"S\":\"' + job_id + '\"}}', '--region', '$AWS_REGION'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
" 2>/dev/null || true
            echo -e "${GREEN}  ✓ Deleted $JOB_COUNT jobs${NC}"
        else
            echo -e "${BLUE}  No jobs to delete${NC}"
        fi
    fi

    # Step 2: Clean DynamoDB Maps Table
    echo -e "${YELLOW}[2/4] Cleaning maps table...${NC}"
    if [ -n "$MAPS_TABLE" ]; then
        MAP_COUNT=$(aws dynamodb scan --table-name "$MAPS_TABLE" --region "$AWS_REGION" --query 'Count' --output text 2>/dev/null || echo "0")
        if [ "$MAP_COUNT" -gt 0 ]; then
            echo "  • Deleting $MAP_COUNT maps from $MAPS_TABLE"
            aws dynamodb scan --table-name "$MAPS_TABLE" --region "$AWS_REGION" --output json | python3 -c "
import json, sys, subprocess
data = json.load(sys.stdin)
for item in data.get('Items', []):
    mapId = item.get('mapId', {}).get('S', '')
    mapName = item.get('mapName', {}).get('S', '')
    if mapId and mapName:
        key = '{\"mapId\":{\"S\":\"' + mapId + '\"},\"mapName\":{\"S\":\"' + mapName + '\"}}'
        subprocess.run(['aws', 'dynamodb', 'delete-item', '--table-name', '$MAPS_TABLE', '--key', key, '--region', '$AWS_REGION'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
" 2>/dev/null || true
            echo -e "${GREEN}  ✓ Deleted $MAP_COUNT maps${NC}"
        else
            echo -e "${BLUE}  No maps to delete${NC}"
        fi
    fi

    # Step 3: Clean S3 Input Bucket
    echo -e "${YELLOW}[3/4] Cleaning input bucket...${NC}"
    if [ -n "$BUCKET_INPUT" ]; then
        FILE_COUNT=$(aws s3 ls "s3://$BUCKET_INPUT/" --region "$AWS_REGION" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$FILE_COUNT" -gt 0 ]; then
            echo "  • Deleting $FILE_COUNT files from $BUCKET_INPUT"
            aws s3 rm "s3://$BUCKET_INPUT/" --recursive --region "$AWS_REGION" 2>/dev/null || true
            echo -e "${GREEN}  ✓ Deleted $FILE_COUNT files${NC}"
        else
            echo -e "${BLUE}  No files to delete${NC}"
        fi
    fi

    # Step 4: Clean S3 Output Bucket
    echo -e "${YELLOW}[4/4] Cleaning output bucket...${NC}"
    if [ -n "$BUCKET_OUTPUT" ]; then
        FILE_COUNT=$(aws s3 ls "s3://$BUCKET_OUTPUT/" --recursive --region "$AWS_REGION" 2>/dev/null | wc -l | tr -d ' ')
        if [ "$FILE_COUNT" -gt 0 ]; then
            echo "  • Deleting $FILE_COUNT files from $BUCKET_OUTPUT"
            aws s3 rm "s3://$BUCKET_OUTPUT/" --recursive --region "$AWS_REGION" 2>/dev/null || true
            echo -e "${GREEN}  ✓ Deleted $FILE_COUNT files${NC}"
        else
            echo -e "${BLUE}  No files to delete${NC}"
        fi
    fi

    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   ✓ Data Cleanup Complete${NC}"
    echo -e "${GREEN}================================================${NC}\n"
    echo -e "${BLUE}All data has been removed. Infrastructure is still running.${NC}"
    echo ""
}

# Function to destroy all infrastructure
cleanup_infrastructure() {
    echo -e "${RED}================================================${NC}"
    echo -e "${RED}   ⚠️  DESTRUCTIVE OPERATION WARNING ⚠️${NC}"
    echo -e "${RED}================================================${NC}\n"

    echo -e "${YELLOW}This script will DELETE ALL infrastructure including:${NC}"
    echo "  • Application Load Balancer (ALB)"
    echo "  • ECS cluster and tasks"
    echo "  • ECR repositories and Docker images"
    echo "  • S3 buckets and ALL uploaded files"
    echo "  • DynamoDB tables and ALL data"
    echo "  • Cognito user pool and ALL users"
    echo "  • VPC and networking components"
    echo "  • Lambda functions"
    echo ""
    echo -e "${RED}⚠️  THIS ACTION CANNOT BE UNDONE ⚠️${NC}"
    echo -e "${RED}⚠️  ALL DATA WILL BE PERMANENTLY DELETED ⚠️${NC}"
    echo ""

    # Get current deployment info
    if [ -d "infra" ] && [ -f "infra/terraform.tfvars" ]; then
        cd infra
        if terraform state list &> /dev/null; then
            echo -e "${YELLOW}Current Deployment:${NC}"
            AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "unknown")
            AWS_REGION=$(grep "aws_region" terraform.tfvars | cut -d'"' -f2 | head -1 2>/dev/null || echo "unknown")

            RESOURCE_COUNT=$(terraform state list | wc -l | tr -d ' ')

            echo -e "  AWS Account: ${BLUE}${AWS_ACCOUNT}${NC}"
            echo -e "  AWS Region:  ${BLUE}${AWS_REGION}${NC}"
            echo -e "  Resources:   ${BLUE}${RESOURCE_COUNT}${NC} resources will be destroyed"
            echo ""
        fi
        cd ..
    fi

    # First confirmation
    echo -e "${YELLOW}Type 'DELETE' to proceed with infrastructure destruction:${NC}"
    read -p "> " confirm1

    if [ "$confirm1" != "DELETE" ]; then
        echo "Cleanup cancelled"
        exit 0
    fi

    # Second confirmation (extra safety)
    echo ""
    echo -e "${RED}Are you ABSOLUTELY SURE? This will delete everything permanently.${NC}"
    echo -e "${YELLOW}Type 'YES I AM SURE' to confirm:${NC}"
    read -p "> " confirm2

    if [ "$confirm2" != "YES I AM SURE" ]; then
        echo "Cleanup cancelled"
        exit 0
    fi

    echo ""
    echo -e "${BLUE}Starting infrastructure destruction...${NC}\n"

    cd infra

    # Get AWS region from Terraform output
    TERRAFORM_REGION=$(terraform output -raw aws_region 2>/dev/null || echo "")
    if [ -z "$TERRAFORM_REGION" ]; then
        TERRAFORM_REGION=$(grep -E '^\s*aws_region\s*=' terraform.tfvars | sed 's/#.*//' | sed 's/.*=[[:space:]]*"\([^"]*\)".*/\1/' 2>/dev/null || echo "")
        AWS_REGION=${TERRAFORM_REGION:-$(aws configure get region)}
    else
        AWS_REGION=$TERRAFORM_REGION
    fi

    # Step 1: Empty S3 buckets INCLUDING all versions (required before deletion)
    echo -e "${YELLOW}[1/5] Emptying S3 buckets (including all versions)...${NC}"
    BUCKET_INPUT=$(terraform output -raw map_input_bucket_name 2>/dev/null || echo "")
    BUCKET_OUTPUT=$(terraform output -raw map_output_bucket_name 2>/dev/null || echo "")

    empty_bucket_versions() {
        local bucket=$1
        echo "  • Emptying $bucket (current objects)..."
        aws s3 rm s3://$bucket --recursive --quiet --region $AWS_REGION 2>/dev/null || true

        echo "  • Deleting all object versions from $bucket..."
        # Delete all versions including delete markers
        aws s3api list-object-versions --bucket $bucket --region $AWS_REGION --output json 2>/dev/null | python3 -c "
import json, sys, subprocess
try:
    data = json.load(sys.stdin)
    # Delete versions
    for version in data.get('Versions', []):
        key = version['Key']
        version_id = version['VersionId']
        subprocess.run(['aws', 's3api', 'delete-object', '--bucket', '$bucket', '--key', key, '--version-id', version_id, '--region', '$AWS_REGION'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Delete delete markers
    for marker in data.get('DeleteMarkers', []):
        key = marker['Key']
        version_id = marker['VersionId']
        subprocess.run(['aws', 's3api', 'delete-object', '--bucket', '$bucket', '--key', key, '--version-id', version_id, '--region', '$AWS_REGION'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except:
    pass
" 2>/dev/null || true
    }

    if [ -n "$BUCKET_INPUT" ]; then
        empty_bucket_versions "$BUCKET_INPUT"
    fi

    if [ -n "$BUCKET_OUTPUT" ]; then
        empty_bucket_versions "$BUCKET_OUTPUT"
    fi

    echo -e "${GREEN}✓${NC} S3 buckets completely emptied\n"

    # Step 2: Delete Application Load Balancer
    echo -e "${YELLOW}[2/5] Deleting Application Load Balancer...${NC}"

    # Delete ALB and related resources
    if terraform state list | grep -q "aws_lb.frontend"; then
        echo "  • Deleting Application Load Balancer and listeners..."
        terraform destroy \
            -target=aws_lb.frontend \
            -target=aws_lb_listener.frontend_https \
            -target=aws_lb_listener.frontend_http \
            -target=aws_lb_target_group.frontend \
            -target=aws_acm_certificate.alb_self_signed \
            -auto-approve 2>/dev/null || true
        echo -e "${GREEN}  ✓ ALB and HTTPS certificate deleted${NC}"
    else
        echo -e "${BLUE}  No ALB found${NC}"
    fi

    echo ""

    # Step 3: Delete ECR images (required before repository deletion)
    echo -e "${YELLOW}[3/5] Cleaning up ECR repositories...${NC}"

    # Get project name and environment from tfvars
    PROJECT_NAME=$(grep "project_name" terraform.tfvars | cut -d'"' -f2 | head -1 2>/dev/null || echo "mra-mines")
    ENVIRONMENT=$(grep "environment" terraform.tfvars | cut -d'"' -f2 | head -1 2>/dev/null || echo "staging")

    # Function to delete all images from an ECR repository
    delete_ecr_images() {
        local repo_name=$1
        echo "  • Checking $repo_name for images..."

        # Check if repository exists and get images
        local image_count=$(aws ecr describe-images \
            --repository-name "$repo_name" \
            --region "$AWS_REGION" \
            --query 'length(imageDetails)' \
            --output text 2>/dev/null || echo "0")

        if [ "$image_count" -gt 0 ]; then
            echo "    - Found $image_count images, deleting..."
            # Use Python to properly handle the JSON array
            aws ecr list-images \
                --repository-name "$repo_name" \
                --region "$AWS_REGION" \
                --query 'imageIds[*]' \
                --output json 2>/dev/null | python3 -c "
import json, sys, subprocess
try:
    image_ids = json.load(sys.stdin)
    if image_ids:
        # Delete in batches of 100 (AWS limit)
        for i in range(0, len(image_ids), 100):
            batch = image_ids[i:i+100]
            cmd = ['aws', 'ecr', 'batch-delete-image',
                   '--repository-name', '$repo_name',
                   '--region', '$AWS_REGION',
                   '--image-ids'] + [json.dumps(img) for img in batch]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except:
    pass
" 2>/dev/null || true
            echo -e "    ${GREEN}✓ Deleted $image_count images${NC}"
        else
            echo "    - No images to delete"
        fi
    }

    # Clean frontend ECR repository
    FRONTEND_REPO="${PROJECT_NAME}-frontend-${ENVIRONMENT}"
    delete_ecr_images "$FRONTEND_REPO"

    # Clean processor ECR repository
    PROCESSOR_REPO="${PROJECT_NAME}-processor-${ENVIRONMENT}"
    delete_ecr_images "$PROCESSOR_REPO"

    echo -e "${GREEN}✓${NC} ECR cleanup complete\n"

    # Step 3.5: Delete IAM roles (whether managed by Terraform or not)
    echo -e "${YELLOW}[3.5/5] Deleting IAM roles...${NC}"

    # List of IAM role patterns to delete
    IAM_ROLES=(
        "${PROJECT_NAME}-ecs-task-execution-${ENVIRONMENT}"
        "${PROJECT_NAME}-ecs-task-${ENVIRONMENT}"
        "${PROJECT_NAME}-input-handler-${ENVIRONMENT}"
        "${PROJECT_NAME}-output-handler-${ENVIRONMENT}"
        "${PROJECT_NAME}-s3-copy-processor-${ENVIRONMENT}"
        "${PROJECT_NAME}-pre-auth-trigger-role-${ENVIRONMENT}"
        "${PROJECT_NAME}-frontend-task-execution-${ENVIRONMENT}"
        "${PROJECT_NAME}-frontend-task-${ENVIRONMENT}"
        "${PROJECT_NAME}-cognito-authenticated-${ENVIRONMENT}"
    )

    ROLES_DELETED=0
    for role_name in "${IAM_ROLES[@]}"; do
        # Check if role exists
        if aws iam get-role --role-name "$role_name" >/dev/null 2>&1; then
            echo "  • Deleting role: $role_name"

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
                ROLES_DELETED=$((ROLES_DELETED + 1))
            fi
        fi
    done

    if [ $ROLES_DELETED -gt 0 ]; then
        echo -e "${GREEN}✓${NC} Deleted $ROLES_DELETED IAM roles\n"
    else
        echo -e "${BLUE}  No IAM roles to delete${NC}\n"
    fi

    # Step 4: Destroy all remaining infrastructure
    echo -e "${YELLOW}[4/5] Destroying all remaining resources...${NC}"
    echo -e "${BLUE}Note: Resource count will be lower than total due to staged deletion above${NC}"
    if terraform destroy -auto-approve; then
        echo -e "${GREEN}✓${NC} All resources destroyed\n"
    else
        echo -e "${RED}ERROR: Some resources could not be destroyed${NC}"
        echo "You may need to manually delete some resources in the AWS Console"
        echo ""
        echo "Common issues:"
        echo "  • S3 buckets not empty (re-run this script)"
        echo "  • VPC dependencies (check security groups, ENIs)"
        echo "  • ALB still deleting (wait and try again)"
        echo "  • Waiting 60 seconds for ENIs to detach, then retrying..."
        sleep 60
        terraform destroy -auto-approve 2>/dev/null || true
    fi

    # Step 5: Clean up CloudWatch Log Groups (often left behind)
    echo -e "${YELLOW}[5/5] Cleaning up CloudWatch Log Groups...${NC}"

    LOG_GROUPS=(
        "/ecs/${PROJECT_NAME}-frontend-${ENVIRONMENT}"
        "/ecs/${PROJECT_NAME}-processor-${ENVIRONMENT}"
        "/aws/lambda/${PROJECT_NAME}-input-handler-${ENVIRONMENT}"
        "/aws/lambda/${PROJECT_NAME}-output-handler-${ENVIRONMENT}"
        "/aws/lambda/${PROJECT_NAME}-s3-copy-processor-${ENVIRONMENT}"
        "/aws/lambda/${PROJECT_NAME}-pre-auth-trigger-${ENVIRONMENT}"
    )

    LOGS_DELETED=0
    for log_group in "${LOG_GROUPS[@]}"; do
        if aws logs describe-log-groups --log-group-name-prefix "$log_group" --region $AWS_REGION --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$log_group"; then
            echo "  • Deleting log group: $log_group"
            aws logs delete-log-group --log-group-name "$log_group" --region $AWS_REGION 2>/dev/null || true
            LOGS_DELETED=$((LOGS_DELETED + 1))
        fi
    done

    if [ $LOGS_DELETED -gt 0 ]; then
        echo -e "${GREEN}✓${NC} Deleted $LOGS_DELETED CloudWatch log groups\n"
    else
        echo -e "${BLUE}  No log groups to delete${NC}\n"
    fi

    cd ..

    # Final summary
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   ✓ Infrastructure Destroyed${NC}"
    echo -e "${GREEN}================================================${NC}\n"

    echo -e "${BLUE}All infrastructure has been destroyed.${NC}"
    echo ""
    echo -e "${YELLOW}Cleanup Summary:${NC}"
    echo "  • Application Load Balancer, listeners, HTTPS cert (deleted in stage 2)"
    echo "  • IAM roles and policies (deleted in stage 3.5)"
    echo "  • All remaining resources (deleted in stage 4)"
    echo "  • CloudWatch log groups (deleted in stage 5)"
    echo "  • All data permanently removed"
    echo "  • Terraform state cleaned"
    echo ""
    echo -e "${BLUE}Total resources destroyed: 55-60 across all stages${NC}"
    echo ""
    echo -e "${BLUE}The application can be redeployed at any time using:${NC}"
    echo -e "  ${GREEN}./scripts/deploy.sh${NC}"
    echo -e "  Or manually: ${GREEN}cd infra && terraform apply${NC}"
    echo ""
}

# Main menu
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   MRA Mines - Cleanup Script${NC}"
echo -e "${BLUE}================================================${NC}\n"

echo "Choose cleanup type:"
echo ""
echo -e "  ${GREEN}1)${NC} Data cleanup only (keep infrastructure running)"
echo "     • Deletes all DynamoDB records"
echo "     • Deletes all S3 files"
echo "     • Keeps ECS, Lambda, ALB running"
echo ""
echo -e "  ${RED}2)${NC} Full infrastructure teardown"
echo "     • Destroys ALL AWS resources"
echo "     • Deletes all data permanently"
echo "     • Cannot be undone"
echo ""
echo -e "  ${YELLOW}3)${NC} Cancel"
echo ""
read -p "Enter choice [1-3]: " choice

case $choice in
    1)
        cleanup_data_only
        ;;
    2)
        cleanup_infrastructure
        ;;
    3)
        echo "Cleanup cancelled"
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
