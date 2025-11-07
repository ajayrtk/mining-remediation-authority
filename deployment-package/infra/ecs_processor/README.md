# ECS Map Processor

This directory contains the Docker container that processes map files uploaded to the S3 input bucket.

## Documentation

For complete context, see:
- **[ARCHITECTURE.md](../../ARCHITECTURE.md)** - ECS component architecture
- **[DETAILED_FLOWS.md](../../../DETAILED_FLOWS.md)** - Processing flow (Phase 5)
- **[INFRASTRUCTURE.md](../INFRASTRUCTURE.md)** - Why we chose ECS

This document focuses on **building and deploying the ECS processor**.

## Overview

The ECS processor:
1. Runs as a Fargate task triggered by the input_handler Lambda
2. Reads the input ZIP file from S3
3. Performs processing (currently dummy processing with 5-second delay)
4. Copies the processed file to the output bucket with "-output" suffix
5. Updates DynamoDB tables (MAPJOBS and MAPS) with status and output location

## Files

- `processor.py` - Python script that does the processing
- `Dockerfile` - Container definition
- `requirements.txt` - Python dependencies
- `build_and_push.sh` - Script to build and push image to ECR

## Setup

### 1. Create Infrastructure

First, apply the Terraform configuration to create the ECS cluster, task definition, and ECR repository:

```bash
cd ../
terraform apply
```

### 2. Build and Push Docker Image

Build the Docker image and push it to ECR:

```bash
cd ecs_processor/
./build_and_push.sh
```

This script will:
- Build the Docker image
- Tag it for ECR
- Authenticate with ECR
- Push the image

## How It Works

### Triggering

When a ZIP file is uploaded to the S3 input bucket:
1. S3 notification triggers the `input_handler` Lambda
2. Lambda creates a job record in DynamoDB
3. Lambda launches an ECS Fargate task with environment variables:
   - `JOB_ID` - Unique job identifier
   - `MAP_ID` - Map identifier (hash-based)
   - `INPUT_KEY` - S3 key of the input file

### Processing

The ECS task:
1. Updates job status to "PROCESSING"
2. Downloads the file from the input bucket
3. Performs processing (simulated with sleep)
4. Uploads result to output bucket
5. Updates job status to "COMPLETED"
6. Updates MAPS table with output location

### Monitoring

View logs in CloudWatch:
```bash
aws logs tail /ecs/mra-mines-processor --follow
```

List running tasks:
```bash
aws ecs list-tasks --cluster mra-mines-cluster
```

## Environment Variables

The container receives these environment variables:

- `INPUT_BUCKET` - S3 bucket containing input files
- `OUTPUT_BUCKET` - S3 bucket for processed files
- `JOBS_TABLE` - DynamoDB table for job tracking
- `MAPS_TABLE` - DynamoDB table for map metadata
- `JOB_ID` - Specific job ID (passed at runtime)
- `MAP_ID` - Map identifier (passed at runtime)
- `INPUT_KEY` - S3 key of input file (passed at runtime)

## Customizing Processing

To add your own processing logic, modify `processor.py` in the `process_file()` function:

```python
def process_file(input_bucket: str, input_key: str, output_bucket: str, output_key: str):
    # Download file
    s3_client.download_file(input_bucket, input_key, '/tmp/input.zip')

    # YOUR PROCESSING HERE
    # ...

    # Upload result
    s3_client.upload_file('/tmp/output.zip', output_bucket, output_key)
```

After making changes, rebuild and push:
```bash
./build_and_push.sh
```

## Troubleshooting

### Task fails immediately

Check CloudWatch logs:
```bash
aws logs tail /ecs/mra-mines-processor --follow
```

### Image not found

Make sure you've pushed the image to ECR:
```bash
./build_and_push.sh
```

### Permission errors

Verify the ECS task role has permissions for S3 and DynamoDB in `infra/iam.tf`.

## Cost Optimization

The current configuration uses:
- **CPU**: 0.25 vCPU
- **Memory**: 512 MB

Adjust these in `infra/ecs.tf` based on your processing requirements.

For long-running or memory-intensive processing, increase the values:
```terraform
cpu    = "1024"  # 1 vCPU
memory = "2048"  # 2 GB
```
