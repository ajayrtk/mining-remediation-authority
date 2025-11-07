#!/bin/bash
# MRA Mines Map - Cleanup Script
# Options: Clean data only OR destroy all infrastructure

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to clean data only (keep infrastructure running)
cleanup_data_only() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}   Data Cleanup (Infrastructure Preserved)${NC}"
    echo -e "${BLUE}================================================${NC}\n"

    echo -e "${YELLOW}This will delete:${NC}"
    echo "  • All records from DynamoDB tables (jobs & maps)"
    echo "  • All files from S3 buckets (input & output)"
    echo ""
    echo -e "${GREEN}This will keep running:${NC}"
    echo "  • ECS tasks, Lambda functions, CloudFront"
    echo "  • All AWS infrastructure"
    echo ""

    # Get AWS region from config
    if [ -f "infra/terraform.tfvars" ]; then
        AWS_REGION=$(grep "aws_region" infra/terraform.tfvars | cut -d'"' -f2 | head -1 2>/dev/null || echo "eu-west-1")
    else
        AWS_REGION="eu-west-1"
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
    echo "  • CloudFront distribution"
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

    # Get AWS region from config
    AWS_REGION=$(grep "aws_region" terraform.tfvars | cut -d'"' -f2 | head -1 2>/dev/null || echo "eu-west-1")

    # Step 1: Empty S3 buckets (required before deletion)
    echo -e "${YELLOW}[1/4] Emptying S3 buckets...${NC}"
    BUCKET_INPUT=$(terraform output -raw map_input_bucket_name 2>/dev/null || echo "")
    BUCKET_OUTPUT=$(terraform output -raw map_output_bucket_name 2>/dev/null || echo "")

    if [ -n "$BUCKET_INPUT" ]; then
        echo "  • Emptying input bucket: $BUCKET_INPUT"
        aws s3 rm s3://$BUCKET_INPUT --recursive --quiet --region $AWS_REGION 2>/dev/null || true
    fi

    if [ -n "$BUCKET_OUTPUT" ]; then
        echo "  • Emptying output bucket: $BUCKET_OUTPUT"
        aws s3 rm s3://$BUCKET_OUTPUT --recursive --quiet --region $AWS_REGION 2>/dev/null || true
    fi

    echo -e "${GREEN}✓${NC} S3 buckets emptied\n"

    # Step 2: Delete CloudFront distribution (takes longest)
    echo -e "${YELLOW}[2/4] Deleting CloudFront distribution (this may take 10-15 minutes)...${NC}"
    if terraform state list | grep -q "aws_cloudfront_distribution"; then
        terraform destroy -target=aws_cloudfront_distribution.frontend -auto-approve
        echo -e "${GREEN}✓${NC} CloudFront distribution deleted\n"
    else
        echo -e "${BLUE}  No CloudFront distribution found${NC}\n"
    fi

    # Step 3: Delete ECR images (required before repository deletion)
    echo -e "${YELLOW}[3/4] Cleaning up ECR repositories...${NC}"

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
    FRONTEND_REPO="${PROJECT_NAME}-${ENVIRONMENT}-frontend"
    delete_ecr_images "$FRONTEND_REPO"

    # Clean processor ECR repository
    PROCESSOR_REPO="${PROJECT_NAME}-processor"
    delete_ecr_images "$PROCESSOR_REPO"

    echo -e "${GREEN}✓${NC} ECR cleanup complete\n"

    # Step 4: Destroy all remaining infrastructure
    echo -e "${YELLOW}[4/4] Destroying all remaining resources...${NC}"
    if terraform destroy -auto-approve; then
        echo -e "${GREEN}✓${NC} All resources destroyed\n"
    else
        echo -e "${RED}ERROR: Some resources could not be destroyed${NC}"
        echo "You may need to manually delete some resources in the AWS Console"
        echo ""
        echo "Common issues:"
        echo "  • S3 buckets not empty (re-run this script)"
        echo "  • CloudFront distribution still deleting (wait and try again)"
        echo "  • VPC dependencies (check security groups, ENIs)"
        exit 1
    fi

    cd ..

    # Final summary
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}   ✓ Infrastructure Destroyed${NC}"
    echo -e "${GREEN}================================================${NC}\n"

    echo -e "${BLUE}All infrastructure has been destroyed.${NC}"
    echo ""
    echo -e "${YELLOW}Cleanup Summary:${NC}"
    echo "  • All AWS resources deleted"
    echo "  • All data permanently removed"
    echo "  • Terraform state cleaned"
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
echo "     • Keeps ECS, Lambda, CloudFront running"
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
