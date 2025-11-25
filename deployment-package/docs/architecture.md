# MRA Mines Map - System Architecture

## Overview

The MRA Mines Map application is a cloud-native web application deployed on AWS, designed for processing and visualizing mining map data. The system uses a serverless and container-based architecture for scalability, cost-efficiency, and ease of maintenance.

**Last Updated:** 2025-11-25
**Architecture Version:** 3.0 (ALB-Direct + Serverless Processing)
**AWS Region:** eu-west-2 (London)

---

## Architecture Diagram

```
                                    INTERNET USERS
                                          |
                                          | HTTPS
                                          v
                    +---------------------------------------------+
                    |        Application Load Balancer (ALB)      |
                    |  - HTTPS Listener (443) with ACM Cert       |
                    |  - HTTP Listener (80) -> HTTPS Redirect     |
                    |  - Health Checks: Port 3000, Path: /        |
                    +---------------------------------------------+
                                          |
                                          | HTTP (internal)
                                          v
                    +---------------------------------------------+
                    |         ECS Fargate (Frontend Service)      |
                    |  - SvelteKit SSR Application                |
                    |  - Port: 3000                               |
                    |  - 0.25 vCPU, 512 MB RAM                    |
                    +---------------------------------------------+
                           |              |              |
           +---------------+              |              +---------------+
           |                              |                              |
           v                              v                              v
    +-----------+               +-----------------+              +-------------+
    |  Cognito  |               |   S3 Buckets    |              |  DynamoDB   |
    | User Pool |               | Input / Output  |              |   Tables    |
    +-----------+               +-----------------+              +-------------+
                                        |
                                        | S3 Event Trigger
                                        v
                    +---------------------------------------------+
                    |          Lambda: input_handler              |
                    |  - Validates uploaded files                 |
                    |  - Creates job/map records in DynamoDB      |
                    |  - Launches ECS processor task              |
                    +---------------------------------------------+
                                        |
                                        | Triggers ECS Task
                                        v
                    +---------------------------------------------+
                    |        ECS Fargate (Processor Task)         |
                    |  - Python + EasyOCR + OpenCV                |
                    |  - 8 vCPU, 16 GB RAM                        |
                    |  - On-demand execution per file             |
                    |  - Docker Image: mra-mine-plans-ds repo     |
                    +---------------------------------------------+
                                        |
                                        | Updates status
                                        v
                    +---------------------------------------------+
                    |          Lambda: output_handler             |
                    |  - Triggered on processing complete         |
                    |  - Updates job status in DynamoDB           |
                    +---------------------------------------------+
```

---

## Project Structure

```
deployment-package/
├── frontend/                    # SvelteKit web application
│   ├── src/
│   │   ├── routes/             # SvelteKit routes & API endpoints
│   │   │   ├── +page.svelte    # Main upload interface
│   │   │   ├── maps/           # Maps management page
│   │   │   ├── auth/           # Authentication routes
│   │   │   └── api/            # API endpoints
│   │   │       ├── presigned-url/    # Generate S3 upload URLs
│   │   │       ├── delete-map/       # Delete map files
│   │   │       ├── retry-map/        # Retry failed processing
│   │   │       ├── download-url/     # Generate download URLs
│   │   │       ├── bulk-download/    # Bulk download operations
│   │   │       ├── batch-operations/ # Batch operations
│   │   │       ├── validate-map/     # Validate map files
│   │   │       └── webhooks/         # Webhook endpoints
│   │   └── lib/
│   │       ├── server/         # Server-side utilities
│   │       │   ├── dynamo.ts   # DynamoDB client
│   │       │   ├── s3.ts       # S3 client
│   │       │   ├── cognito.ts  # Cognito authentication
│   │       │   ├── circuit-breaker.ts
│   │       │   ├── rate-limit.ts
│   │       │   ├── audit-log.ts
│   │       │   └── webhook.ts
│   │       └── utils/          # Shared utilities
│   ├── Dockerfile
│   ├── build_and_push.sh       # Deploy script
│   └── package.json
│
├── infra/                       # Terraform infrastructure
│   ├── lambda/                  # Lambda function code
│   │   ├── input_handler/      # S3 upload trigger handler
│   │   ├── output_handler/     # Processing complete handler
│   │   ├── s3_copy_processor/  # S3 copy operations
│   │   └── pre_auth_trigger/   # Cognito pre-auth validation
│   ├── main.tf                 # Provider configuration
│   ├── vpc.tf                  # Networking (VPC, subnets)
│   ├── alb.tf                  # Application Load Balancer
│   ├── ecs.tf                  # ECS processor task definition
│   ├── frontend_ecs_simple.tf  # Frontend ECS service
│   ├── cognito.tf              # User authentication
│   ├── dynamodb.tf             # Database tables
│   ├── s3.tf                   # Storage buckets
│   ├── lambda.tf               # Lambda functions
│   ├── iam.tf                  # IAM roles and policies
│   ├── variables.tf            # Configuration variables
│   └── outputs.tf              # Terraform outputs
│
├── scripts/                     # Deployment scripts
│   └── deploy.sh
│
├── docs/                        # Documentation
│
└── backend/                     # (Empty - serverless architecture)
```

**Note:** The `backend/` folder is empty because the application uses a **serverless architecture**. All backend logic is handled by:
- Lambda functions (in `infra/lambda/`)
- ECS processor tasks (Docker image from separate `mra-mine-plans-ds` repository)

---

## Quick Summary

**Current Configuration:**
- **Entry Point:** Application Load Balancer (HTTPS + HTTP redirect)
- **Frontend:** ECS Fargate (1 task, 0.25 vCPU, 512 MB, auto-refresh)
- **Authentication:** AWS Cognito (OAuth 2.0)
- **Database:** DynamoDB (2 tables, on-demand billing)
- **Storage:** S3 (2 buckets - input and output)
- **Processing:** Lambda + ECS Fargate (8 vCPU, 16 GB RAM)
- **Monthly Cost:** ~$35-60

**Key Features:**
- HTTPS with ACM certificate
- Auto-healing via ALB health checks
- OAuth 2.0 authentication with Cognito
- Event-driven processing pipeline
- Real-time UI updates (10-second auto-refresh)
- High-performance map processing (8 vCPU/16GB)
- Rate limiting and circuit breaker patterns
- Batch upload support (up to 20 files)
- Retry logic for failed processing

---

## Component Details

### 1. Frontend (ECS Fargate)

**Location:** `deployment-package/frontend/`

**Technology:** SvelteKit with TypeScript

**Specifications:**
- CPU: 0.25 vCPU (256 units)
- Memory: 512 MB
- Port: 3000
- Network: awsvpc mode with public IP

**Key Routes:**
| Route | Purpose |
|-------|---------|
| `/` | Main upload interface |
| `/maps` | Maps management and download |
| `/auth/callback` | Cognito OAuth callback |

**API Endpoints:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/presigned-url` | POST | Generate S3 upload URLs |
| `/api/delete-map` | POST | Delete map files |
| `/api/retry-map` | POST | Retry failed processing |
| `/api/download-url` | POST | Generate download URLs |
| `/api/bulk-download` | POST | Bulk download operations |
| `/api/batch-operations` | POST | Batch delete/retry |
| `/api/validate-map` | POST | Validate map files |
| `/api/webhooks` | POST | External webhook handling |

**Server Utilities:**
- `dynamo.ts` - DynamoDB document client
- `s3.ts` - S3 client for presigned URLs
- `cognito.ts` - User authentication
- `circuit-breaker.ts` - Fault tolerance for AWS services
- `rate-limit.ts` - Request rate limiting (20 uploads/hour)
- `audit-log.ts` - Operation logging
- `tracing.ts` - Request tracing

### 2. Lambda Functions

**Location:** `deployment-package/infra/lambda/`

#### input_handler
- **Trigger:** S3 PUT event on input bucket
- **Purpose:**
  - Validate uploaded ZIP file format
  - Create job record in DynamoDB (status: QUEUED)
  - Create map record in DynamoDB
  - Launch ECS processor task
  - Handle retry scenarios for failed uploads
- **Timeout:** 60 seconds
- **Memory:** 512 MB

#### output_handler
- **Trigger:** S3 PUT event on output bucket
- **Purpose:**
  - Update job status to COMPLETED
  - Update map metadata with output location
- **Timeout:** 30 seconds
- **Memory:** 256 MB

#### s3_copy_processor
- **Trigger:** Direct Lambda invocation
- **Purpose:** Fallback processor when ECS is unavailable
- **Timeout:** 120 seconds
- **Memory:** 512 MB

#### pre_auth_trigger
- **Trigger:** Cognito pre-authentication
- **Purpose:** Custom authentication validation
- **Timeout:** 10 seconds
- **Memory:** 128 MB

### 3. ECS Processor (Map Processing)

**Location:** Defined in `deployment-package/infra/ecs.tf`
**Docker Image:** Built from separate `mra-mine-plans-ds` repository

**Specifications:**
- CPU: 8 vCPU (8192 units)
- Memory: 16 GB (16384 MB)
- Network Mode: awsvpc
- Launch Type: FARGATE

**Processing Stack:**
- Python 3.11+
- EasyOCR for text recognition
- OpenCV for image processing
- GDAL for geospatial operations

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `INPUT_BUCKET` | S3 bucket for uploaded maps |
| `OUTPUT_BUCKET` | S3 bucket for processed results |
| `JOBS_TABLE_NAME` | DynamoDB table for job tracking |
| `MAPS_TABLE_NAME` | DynamoDB table for map metadata |
| `JOB_ID` | Current job identifier |
| `MAP_ID` | Current map identifier |
| `INPUT_KEY` | S3 key of input file |
| `MAP_NAME` | Original filename |

**Processing Time:**
- Small maps (<5 MB): ~2-3 minutes
- Medium maps (5-20 MB): ~5-7 minutes
- Large maps (>20 MB): ~10-15 minutes

### 4. Storage (S3)

**Input Bucket** (`mra-mines-{env}-input`)
- Stores uploaded ZIP files
- Lifecycle: Files deleted after 90 days
- Versioning: Enabled
- S3 Event: Triggers input_handler Lambda on upload

**Output Bucket** (`mra-mines-{env}-output`)
- Stores processed results
- Lifecycle: Configurable retention
- Versioning: Enabled

### 5. Database (DynamoDB)

**maps Table**
| Attribute | Type | Description |
|-----------|------|-------------|
| `mapId` | String (PK) | Hash-based unique ID |
| `mapName` | String (SK) | Sanitized filename |
| `ownerEmail` | String | User who uploaded |
| `status` | String | QUEUED, DISPATCHED, PROCESSING, COMPLETED, FAILED |
| `jobId` | String | Reference to processing job |
| `sizeBytes` | Number | File size |
| `createdAt` | String | ISO timestamp |
| `updatedAt` | String | ISO timestamp |
| `errorMessage` | String | Error details (if failed) |
| `retryCount` | Number | Number of retry attempts |

**map-jobs Table**
| Attribute | Type | Description |
|-----------|------|-------------|
| `jobId` | String (PK) | Unique job identifier |
| `submittedBy` | String | User email |
| `status` | String | QUEUED, DISPATCHED, PROCESSING, COMPLETED, FAILED |
| `batchSize` | Number | Total files in batch |
| `processedCount` | Number | Successfully processed |
| `failedCount` | Number | Failed processing |
| `createdAt` | String | ISO timestamp |

### 6. Authentication (Cognito)

- OAuth 2.0 / OpenID Connect
- Hosted UI for login
- Pre-authentication Lambda trigger
- Session management via SvelteKit

---

## Data Flow

### Upload Flow

```
1. User visits frontend (via ALB)
   └─> SvelteKit renders upload page
       └─> User authenticates via Cognito

2. User selects files for upload
   └─> Frontend validates filenames (SeamID_SheetNumber.zip)
       └─> Frontend calculates file hashes for deduplication

3. Frontend requests presigned URLs
   └─> POST /api/presigned-url
       └─> Server checks rate limits (20/hour)
           └─> Server checks for duplicates in DynamoDB
               └─> Server generates presigned S3 URLs

4. Browser uploads directly to S3
   └─> PUT to presigned URL with metadata
       └─> S3 triggers input_handler Lambda

5. input_handler Lambda processes upload
   └─> Validates filename format (backend validation)
       └─> Creates/updates job record (status: QUEUED)
           └─> Creates/updates map record (status: QUEUED)
               └─> Launches ECS Fargate task

6. ECS processor runs
   └─> Downloads ZIP from S3 input bucket
       └─> Processes map (OCR, extraction, analysis)
           └─> Updates DynamoDB (status: PROCESSING)
               └─> Uploads results to S3 output bucket
                   └─> Updates DynamoDB (status: COMPLETED)

7. User views results
   └─> Frontend polls DynamoDB (10-second interval)
       └─> Displays updated status
           └─> Generates presigned URL for download
```

### Filename Validation

Files must follow the format: `SeamID_SheetNumber.zip`

- **SeamID:** Alphanumeric identifier (e.g., "16516")
- **Underscore:** Mandatory separator
- **SheetNumber:** Exactly 6 digits (e.g., "433857" or "43_3857")

Examples:
- Valid: `16516_433857.zip`, `ABC123_433857.zip`, `43_43_3857.zip`
- Invalid: `test.zip`, `map_file.zip`, `16516.zip`

Validation occurs at two levels:
1. **Frontend:** Immediate user feedback (`filenameParser.ts`)
2. **Lambda:** Backend enforcement (catches direct S3 uploads)

---

## Security Model

### Network Security
- ALB provides DDoS protection
- Security groups restrict access by port
- VPC isolates resources
- S3 buckets block public access

### Authentication & Authorization
- Cognito handles user authentication
- JWT tokens validate API requests
- Pre-auth Lambda for custom validation
- Rate limiting prevents abuse

### Data Protection
- HTTPS/TLS encryption in transit
- S3 server-side encryption (AES-256) at rest
- DynamoDB encryption enabled by default

---

## Cost Breakdown

### Monthly Cost Estimate (Moderate Usage)

| Service | Cost |
|---------|------|
| ECS Fargate (Frontend) | $15-25 |
| ECS Fargate (Processor) | $5-15 |
| DynamoDB | $2-10 |
| S3 Storage | $1-5 |
| Lambda | $0-5 |
| ALB | $16-20 |
| ECR | $1 |
| **Total** | **$35-60/month** |

---

## Terraform Infrastructure Files

| File | Purpose |
|------|---------|
| `main.tf` | AWS provider configuration |
| `vpc.tf` | VPC, subnets, internet gateway |
| `alb.tf` | Application Load Balancer, listeners, target groups |
| `ecs.tf` | Processor task definition, ECR repository |
| `frontend_ecs_simple.tf` | Frontend ECS service and task |
| `cognito.tf` | User pool, app client, domain |
| `cognito_identity.tf` | Identity pool for AWS credentials |
| `dynamodb.tf` | Maps and jobs tables |
| `s3.tf` | Input and output buckets |
| `lambda.tf` | Lambda functions and triggers |
| `lambda_pre_auth.tf` | Cognito pre-auth trigger |
| `iam.tf` | IAM roles and policies |
| `iam_data.tf` | IAM data sources |
| `acm.tf` | SSL/TLS certificates |
| `route53.tf` | DNS configuration |
| `webhooks.tf` | Webhook infrastructure |
| `variables.tf` | Input variables |
| `outputs.tf` | Output values |

---

**Document Version:** 3.0
**Last Updated:** 2025-11-25
**Maintained By:** MRA Mines DevOps Team
