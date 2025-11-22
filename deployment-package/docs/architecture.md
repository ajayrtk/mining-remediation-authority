# MRA Mines Map - System Architecture

## Overview

The MRA Mines Map application is a cloud-native web application deployed on AWS, designed for processing and visualizing mining map data. The system uses a serverless and container-based architecture for scalability, cost-efficiency, and ease of maintenance.

**Last Updated:** 2025-11-14
**Architecture Version:** 2.1 (ALB-Direct + Performance Optimized)
**AWS Region:** eu-west-2 (London)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Internet Users                             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ HTTPS (self-signed cert)
                             │ HTTP → 301 Redirect to HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Application Load Balancer (ALB)                     │
│  • HTTPS Listener (443) - Self-signed Certificate                   │
│  • HTTP Listener (80) - Redirects to HTTPS                          │
│  • Health Checks - Port 3000, Path: /                               │
│  • Target Group - ECS Tasks (IP mode)                               │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             │ HTTP (internal)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ECS Fargate Service (Frontend)                    │
│  • Task Count: 1 (auto-healing via ALB health checks)               │
│  • Container: SvelteKit Application (Port 3000)                     │
│  • Resources: 0.25 vCPU, 512 MB RAM                                 │
│  • Network: awsvpc mode, Public IP enabled                          │
└────┬────────────────────────┬───────────────────┬──────────────────┘
     │                        │                   │
     │ API Calls              │ API Calls         │ OAuth
     ▼                        ▼                   ▼
┌────────────┐      ┌──────────────────┐   ┌──────────────┐
│  DynamoDB  │      │   S3 Buckets     │   │   Cognito    │
│  Tables    │      │  (Input/Output)  │   │  User Pool   │
└────────────┘      └──────────────────┘   └──────────────┘
     │                        │
     │ Read/Write             │ S3 Events
     ▼                        ▼
┌────────────────────────────────────────────────────────────┐
│               Lambda Functions (Event-Driven)               │
│  • input-handler: Triggered on map upload                  │
│  • output-handler: Triggered on processing complete        │
│  • mock-ecs: Simulates ECS task for testing                │
│  • s3-copy-processor: Handles S3 object operations         │
│  • pre-auth-trigger: Validates Cognito authentication      │
└───────────────────────┬────────────────────────────────────┘
                        │
                        │ Triggers ECS Tasks
                        ▼
┌────────────────────────────────────────────────────────────┐
│          ECS Fargate Tasks (Map Processor)                 │
│  • On-Demand Processing (triggered by Lambda)              │
│  • Container: Python map processing (EasyOCR + OpenCV)     │
│  • Resources: 8 vCPU, 16 GB RAM (Performance Optimized)    │
│  • Processing Time: ~5-10 minutes per map                  │
│  • Docker Image: From separate mra-mine-plans-ds repo      │
└────────────────────────────────────────────────────────────┘
```

---

## Quick Summary

**Current Configuration:**
- **Entry Point:** Application Load Balancer (HTTPS + HTTP redirect)
- **Frontend:** ECS Fargate (1 task, 0.25 vCPU, 512 MB, auto-refresh)
- **Authentication:** AWS Cognito (OAuth 2.0)
- **Database:** DynamoDB (2 tables, on-demand)
- **Storage:** S3 (2 buckets with lifecycle rules)
- **Processing:** Lambda + ECS Fargate (8 vCPU, 16 GB RAM)
- **Monthly Cost:** ~$35-60 (increased due to ECS upgrade)

**Key Features:**
- HTTPS with self-signed certificate
- Auto-healing via ALB health checks
- OAuth 2.0 authentication
- Event-driven processing
- Real-time UI updates (10-second auto-refresh)
- High-performance map processing (8 vCPU/16GB)
- Cost-optimized (no CloudFront, no NAT Gateway)

**Limitations:**
- Self-signed certificate (browser warnings)
- Single region deployment
- No global CDN

**Upgrade Path:**
See `docs/CUSTOM_DOMAIN_SETUP.md` for production-ready HTTPS with custom domain + ACM certificate (~$13/year).

---

## For Full Details

This is a summary document. For comprehensive architecture documentation including:
- Detailed component descriptions
- Data flow diagrams
- Security considerations
- Scaling strategies  
- Cost analysis
- Migration notes

See the complete architecture documentation (to be created) or refer to:
- Terraform configuration files in `infra/`
- Custom domain setup guide in `docs/CUSTOM_DOMAIN_SETUP.md`
- Individual README files in each component directory

---

---

## Processing Components

### Map Processing Pipeline

The system uses two separate but coordinated processing components:

#### 1. ECS Processor (In deployment-package/infra/)
**Location:** Defined in `deployment-package/infra/ecs.tf`

**Configuration:**
- **CPU:** 8 vCPU (8192 units)
- **Memory:** 16 GB (16384 MB)
- **Network Mode:** awsvpc
- **Launch Type:** FARGATE

**Purpose:** Runs the actual map processing Docker container

**Docker Image Source:** Built from separate repository (`mra-mine-plans-ds`)
- Contains EasyOCR for text recognition
- Uses OpenCV for image processing
- Handles map extraction and analysis

**Environment Variables:**
- `INPUT_BUCKET` - S3 bucket for uploaded maps
- `OUTPUT_BUCKET` - S3 bucket for processed results
- `JOBS_TABLE_NAME` - DynamoDB table for job tracking
- `MAPS_TABLE_NAME` - DynamoDB table for map metadata
- `AWS_DEFAULT_REGION` - Current AWS region

#### 2. Lambda Functions (In deployment-package/infra/lambda/)
**Location:** `deployment-package/infra/lambda/`

**Functions:**
1. **input-handler** (`lambda/input_handler/handler.py`)
   - Triggered by S3 upload events
   - Creates job record in DynamoDB
   - Launches ECS processor task
   - Handles initial validation

2. **output-handler** (`lambda/output_handler/`)
   - Triggered when processing completes
   - Updates job status
   - Processes final results

3. **s3-copy-processor** (`lambda/s3_copy_processor/`)
   - Handles S3 object copy operations
   - Manages file transfers between buckets

4. **pre-auth-trigger** (`lambda/pre_auth_trigger/`)
   - Cognito pre-authentication trigger
   - Validates user credentials
   - Custom authentication logic

**Resource Configuration:**
- Memory: 128-512 MB per function
- Timeout: 30-900 seconds (varies by function)
- Runtime: Python 3.11+

### Processing Flow

```
1. User uploads map file via frontend
   ↓
2. S3 upload event triggers input-handler Lambda
   ↓
3. Lambda creates job record in DynamoDB (status: "submitted")
   ↓
4. Lambda launches ECS Fargate task (processor)
   ↓
5. ECS task downloads map from S3 input bucket
   ↓
6. ECS task processes map (OCR, extraction, analysis)
   ↓
7. ECS task uploads results to S3 output bucket
   ↓
8. ECS task updates DynamoDB (status: "completed")
   ↓
9. S3 output event triggers output-handler Lambda
   ↓
10. Frontend auto-refresh displays updated status
```

### Performance Characteristics

**Processing Time (Current - 8 vCPU/16GB):**
- Small maps (<5 MB): ~2-3 minutes
- Medium maps (5-20 MB): ~5-7 minutes
- Large maps (>20 MB): ~10-15 minutes

**Improvement from Upgrade:**
- Previous: 4 vCPU / 8 GB
- Current: 8 vCPU / 16 GB
- Expected speedup: 30-50% reduction in processing time

---

**Document Version:** 2.1
**Last Updated:** 2025-11-14
**Maintained By:** MRA Mines DevOps Team
