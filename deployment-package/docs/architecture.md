# MRA Mines Map Architecture

## System Overview

The MRA Mines Map application is a cloud-native SaaS platform for digitizing and processing scanned mining maps. It consists of two integrated repositories:

1. **final-mra-maps-project** (GitHub): Web application, infrastructure, and orchestration
2. **mra-mine-plans-ds** (GitLab): ML/CV processing engine for map digitization

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet (HTTPS)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   AWS ALB        │  Application Load Balancer
                    │   (SSL/TLS)      │  Health checks, HTTPS termination
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   ECS Fargate    │  Frontend Container
                    │   (SvelteKit)    │  Port 3000, Node.js 20.x
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
       ┌────▼────┐    ┌─────▼──────┐   ┌────▼────────┐
       │ Cognito │    │     S3     │   │  DynamoDB   │
       │ (Auth)  │    │ (Storage)  │   │  (Data)     │
       └─────────┘    └─────┬──────┘   └─────────────┘
                            │
                       ┌────▼──────┐
                       │  Lambda   │  Event-driven orchestrators
                       │ Functions │  (5 functions)
                       └────┬──────┘
                            │
                       ┌────▼──────────────┐
                       │   ECS Fargate     │  Processor Container
                       │ (mramineplan...)  │  ML/CV Pipeline
                       └───────────────────┘
```

## Architecture Components

### 1. Frontend Application (ECS Fargate)

**Repository**: `final-mra-maps-project/deployment-package/frontend/`

**Technology Stack**:
- **Framework**: SvelteKit 2.43.2 (reactive web framework)
- **Language**: TypeScript 5.9
- **Build Tool**: Vite 7.1
- **Runtime**: Node.js 20.x with adapter-node
- **Testing**: Vitest 2.1 with coverage
- **Container**: Docker multi-stage build

**Resources**:
- **CPU**: 512 units (0.5 vCPU)
- **Memory**: 1024 MB (1 GB)
- **Port**: 3000 (internal)
- **Scaling**: Auto-scaling 1-3 tasks (future)

**Key Features**:
- Direct-to-S3 uploads with presigned URLs
- Real-time job status polling (10-30s intervals)
- Bulk operations (multi-select download)
- Client-side validation (ZIP format, georeferencing, SHA-256 hashing)
- Duplicate detection before upload
- Search, sort, and filter capabilities
- Responsive UI with dark mode support
- User authentication via Cognito OAuth 2.0

**Main Routes**:
- `/` - Landing page with upload interface
- `/maps` - Map management dashboard
- `/auth/login` - OAuth 2.0 PKCE flow initiation
- `/auth/callback` - Cognito callback handler
- `/auth/logout` - Session termination

**API Endpoints**:
- `/api/presigned-url` - Generate S3 upload URLs
- `/api/validate-map` - Server-side georeferencing validation
- `/api/download-url` - Generate download URLs
- `/api/bulk-download` - Multi-file download
- `/api/delete-map` - Remove map data
- `/api/retry-map` - Retry failed processing
- `/api/batch-operations` - Batch actions

**AWS SDK Integration**:
- `@aws-sdk/client-s3` - S3 operations
- `@aws-sdk/lib-dynamodb` - DynamoDB document client
- `@aws-sdk/s3-request-presigner` - Presigned URL generation

### 2. Processing Engine (ECS Fargate)

**Repository**: `mra-mine-plans-ds/mramineplanextraction/`

**Technology Stack**:
- **Language**: Python 3.11
- **Container**: Docker (~2.5-3GB optimized image)
- **CI/CD**: GitLab CI with automatic ECR deployment
- **ECR Registry**: `719259376075.dkr.ecr.eu-west-2.amazonaws.com`

**Core Libraries**:
- **Computer Vision**: `opencv-python-headless` 4.10+
- **OCR**: `easyocr` 1.7+ (text detection and recognition)
- **Geospatial**: `geopandas`, `rasterio`, `shapely`, `pyproj`
- **Machine Learning**: `scikit-learn`, `scipy`, `torch` (CPU-only)
- **Data Processing**: `pandas`, `numpy`
- **Image Processing**: `Pillow`, color normalization, hue filtering

**Processing Pipeline** (`pipeline.py`):

```python
# Simplified flow
1. Extract ZIP contents (validate structure)
2. Load georeferencing data (.tfw files)
3. Normalize image (color correction, contrast)
4. Text Detection:
   - Run EasyOCR on full image
   - Extract text with pixel coordinates
   - Transform to geographic coordinates
5. Line Detection:
   - Filter image by hue ranges (geological features)
   - Apply morphological operations
   - Detect contours and fit lines
   - Transform to geographic coordinates
6. Validation:
   - Verify sheet number in extracted text
   - Check coordinate bounds
7. Output:
   - GeoPackage (.gpkg) files
   - Text layer (points with labels)
   - Line layers (colored by feature type)
```

**Key Modules**:
- `TextTools.py` - OCR processing with EasyOCR
- `ColourTools.py` - Image normalization, hue filtering
- `LineTools.py` - Geological feature detection
- `ShapefileTools.py` - Geospatial transformation
- `aws_processor.py` - AWS S3 integration wrapper

**Output Format**:
- **GeoPackage** (.gpkg): OGC standard for geospatial data
- **Layers**: Text points, geological lines (by color)
- **CRS**: EPSG:27700 (British National Grid)
- **Attributes**: Feature type, confidence, extracted text

### 3. Load Balancer (ALB)

**Type**: Application Load Balancer
**Protocol**: HTTPS (TLS 1.2+)
**Certificate**: Self-signed (or ACM with custom domain)
**Health Check**:
- Path: `/`
- Interval: 30 seconds
- Timeout: 5 seconds
- Healthy threshold: 2
- Unhealthy threshold: 3

**Features**:
- HTTPS-only traffic (redirects HTTP → HTTPS)
- Forwards to ECS frontend on port 3000
- Sticky sessions for Cognito redirects
- Cross-zone load balancing

### 4. Authentication (AWS Cognito)

**User Pool Configuration**:
- **Flow**: OAuth 2.0 with PKCE (Authorization Code Grant)
- **Hosted UI**: Custom domain prefix support
- **Token Expiration**: Access (1h), Refresh (30d), ID (1h)
- **MFA**: Optional (configurable)
- **Password Policy**: Min 8 chars, complexity requirements

**Integration**:
- Session stored in httpOnly, secure cookies
- Frontend checks session validity via `locals.user`
- Pre-authentication Lambda trigger for validation
- Email-based user identification

**Redirect Flow**:
```
1. User clicks "Login" → Redirect to Cognito Hosted UI
2. User authenticates → Cognito redirects to /auth/callback?code=...
3. Backend exchanges code for tokens (PKCE)
4. Session created with access/refresh tokens in cookies
5. User redirected to original page or dashboard
```

### 5. Storage Layer

#### S3 Buckets

| Bucket | Purpose | Lifecycle | Versioning | Size Limit |
|--------|---------|-----------|------------|------------|
| Input Bucket | Uploaded ZIP files | 5 days | Disabled | 200 MB |
| Output Bucket | Processed GeoPackage files | Permanent | Enabled | Unlimited |

**Configuration**:
- Private access (no public access)
- CORS enabled for presigned URLs
- Server-side encryption (SSE-S3)
- S3 event notifications to Lambda

**S3 Event Triggers**:
- Input bucket: `s3:ObjectCreated:*` → `input_handler` Lambda
- Output bucket: `s3:ObjectCreated:*` → `output_handler` Lambda

#### DynamoDB Tables

**Table 1: `maps` (Map Metadata)**

| Attribute | Type | Key | GSI | Description |
|-----------|------|-----|-----|-------------|
| mapId | String | Hash | - | SHA-256 hash of file content |
| mapName | String | Range | - | Sanitized filename (SeamID_SheetNumber) |
| ownerEmail | String | - | OwnerEmailIndex | User email (submitter) |
| ownerName | String | - | - | Display name from Cognito |
| ownerUsername | String | - | - | Username from Cognito |
| jobId | String | - | JobIdIndex | Batch job identifier |
| status | String | - | StatusIndex | RESERVED/QUEUED/DISPATCHED/PROCESSING/COMPLETED/FAILED |
| createdAt | String | - | - | ISO 8601 timestamp |
| processedAt | String | - | - | Completion timestamp |
| inputSizeBytes | Number | - | - | Uploaded ZIP file size |
| outputSizeBytes | Number | - | - | Processed GeoPackage size |
| outputUrl | String | - | - | S3 presigned download URL |
| ecsTaskId | String | - | - | ECS task ARN |
| errorMessage | String | - | - | Failure reason |
| retryCount | Number | - | - | Number of retry attempts |

**Table 2: `map-jobs` (Job Tracking)**

| Attribute | Type | Key | GSI | Description |
|-----------|------|-----|-----|-------------|
| jobId | String | Hash | - | Unique batch identifier |
| submittedBy | String | - | SubmittedByIndex | User email |
| batchSize | Number | - | - | Total maps in batch |
| processedCount | Number | - | - | Completed map count (with idempotency) |
| processedMaps | StringSet | - | - | Set of processed mapIds (prevents double-counting) |
| status | String | - | - | QUEUED/IN_PROGRESS/COMPLETED/PARTIAL_SUCCESS/FAILED |
| createdAt | String | - | - | Job creation timestamp |
| completedAt | String | - | - | Job completion timestamp |

**Capacity Mode**: On-demand (pay per request)

### 6. Lambda Functions

**Repository**: `final-mra-maps-project/deployment-package/infra/lambda/`

#### Function 1: `input_handler`

**Trigger**: S3 PutObject (input bucket)
**Runtime**: Python 3.x
**Timeout**: 60 seconds
**Memory**: 256 MB

**Responsibilities**:
1. Extract S3 metadata (submittedBy, mapId, jobId, ownerName, ownerUsername)
2. Validate filename format (SeamID_SheetNumber.zip)
3. Check for duplicates in DynamoDB (mapId + mapName)
4. Create/update map entry (QUEUED status)
5. Increment job batchSize counter
6. Launch ECS Fargate task with environment variables
7. Update map status to DISPATCHED with ecsTaskId

**Environment Variables**:
- `MAPS_TABLE_NAME` - DynamoDB maps table
- `MAP_JOBS_TABLE_NAME` - DynamoDB jobs table
- `ECS_CLUSTER_NAME` - ECS cluster ARN
- `ECS_TASK_DEFINITION` - Task definition ARN
- `ECS_SECURITY_GROUP` - Security group ID
- `ECS_SUBNET_IDS` - Comma-separated subnet IDs
- `MAP_OUTPUT_BUCKET` - S3 output bucket name

**Error Handling**:
- Invalid filename → Create FAILED map entry
- Duplicate map → Update existing entry (retry logic)
- ECS launch failure → Log error, create FAILED entry

#### Function 2: `output_handler`

**Trigger**: S3 PutObject (output bucket)
**Runtime**: Python 3.x
**Timeout**: 60 seconds
**Memory**: 256 MB

**Responsibilities**:
1. Parse output S3 key to extract mapId/mapName
2. Update map status to COMPLETED
3. Store output URL and file size
4. Record processedAt timestamp
5. Calculate processing duration
6. Evaluate job completion (processedCount >= batchSize)

**Status Evaluation Logic**:
```python
if processedCount >= batchSize:
    # Check for any failed maps in this job
    if any_failed_maps:
        job_status = "PARTIAL_SUCCESS"
    else:
        job_status = "COMPLETED"
    update_job(jobId, status=job_status, completedAt=now)
```

#### Function 3: `s3_copy_processor`

**Trigger**: Manual invocation (utility function)
**Runtime**: Python 3.x
**Timeout**: 300 seconds
**Memory**: 512 MB

**Responsibilities**:
1. Copy files between S3 buckets
2. Increment job processedCount with idempotency
3. Track processed maps using DynamoDB StringSet
4. Prevent double-counting on Lambda retries
5. Handle duplicate S3 events gracefully

**Idempotency Mechanism**:
```python
# Check if mapId already in processedMaps set
response = dynamodb.update_item(
    Key={'jobId': job_id},
    UpdateExpression='ADD processedMaps :mapId',
    ConditionExpression='NOT contains(processedMaps, :mapId)',
    ExpressionAttributeValues={':mapId': map_id}
)
# Only increment processedCount if set updated successfully
```

#### Function 4: `ecs_state_handler`

**Trigger**: ECS CloudWatch Events (task state changes)
**Runtime**: Python 3.x
**Timeout**: 60 seconds
**Memory**: 256 MB

**Responsibilities**:
1. Monitor ECS task lifecycle events
2. Detect abnormal terminations (STOPPED with non-zero exit)
3. Update map status to FAILED for crashed tasks
4. Log failure reasons (OOM, timeout, error)
5. Increment job processedCount for failed maps

**Handled Events**:
- `ECS Task State Change` (PROVISIONING/PENDING/RUNNING/STOPPED)
- `stoppedReason`: Task failed to start, OOM killed, etc.

#### Function 5: `pre_auth_trigger`

**Trigger**: Cognito Pre-Authentication
**Runtime**: Python 3.x
**Timeout**: 5 seconds
**Memory**: 128 MB

**Responsibilities**:
1. Validate user before authentication
2. Check user status (enabled/disabled)
3. Implement custom authentication logic
4. Return success/failure to Cognito

### 7. Networking

**VPC Configuration**:
- **CIDR Block**: 10.0.0.0/16
- **Subnets**: 2 public subnets across 2 AZs
  - Subnet 1: 10.0.1.0/24 (AZ a)
  - Subnet 2: 10.0.2.0/24 (AZ b)
- **Internet Gateway**: Attached for public internet access
- **Route Tables**: Default route to IGW

**Security Groups**:

| Group | Type | Port | Source | Purpose |
|-------|------|------|--------|---------|
| ALB SG | Ingress | 443 | 0.0.0.0/0 | HTTPS from internet |
| ALB SG | Egress | 3000 | ECS SG | Forward to frontend |
| ECS Frontend SG | Ingress | 3000 | ALB SG | Receive from ALB |
| ECS Frontend SG | Egress | 443 | 0.0.0.0/0 | AWS API calls |
| ECS Processor SG | Egress | 443 | 0.0.0.0/0 | S3/DynamoDB access |

**IAM Roles**:
- **ECS Task Execution Role**: Pull ECR images, CloudWatch logs
- **ECS Task Role**: Access S3, DynamoDB, Cognito
- **Lambda Execution Role**: CloudWatch logs, ECS API, DynamoDB, S3

## Data Flow Diagrams

### 1. Complete Upload and Processing Flow

```
┌──────────────┐
│   User       │
│  (Browser)   │
└──────┬───────┘
       │ 1. Login (OAuth 2.0 PKCE)
       ▼
┌──────────────┐
│   Cognito    │
│  Hosted UI   │
└──────┬───────┘
       │ 2. Auth code + tokens
       ▼
┌──────────────────────────────────────────────────────────────┐
│   Frontend (SvelteKit on ECS Fargate)                        │
│                                                               │
│   3. User selects ZIP files                                  │
│   4. Client-side validation:                                 │
│      - ZIP structure check                                   │
│      - Filename format (SeamID_SheetNumber.zip)             │
│      - Georeferencing check (.tfw files)                     │
│      - SHA-256 hash for deduplication                        │
│   5. Request presigned URLs (/api/presigned-url)            │
│      - Passes: mapId, mapName, jobId, owner info            │
│   6. Receive presigned URLs                                  │
│   7. Direct upload to S3 (bypasses server)                   │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│   S3 Input Bucket                                             │
│   - Stores uploaded ZIP files                                │
│   - Metadata: submittedBy, mapId, jobId, ownerName, etc.    │
│   - Lifecycle: Delete after 5 days                           │
└──────┬───────────────────────────────────────────────────────┘
       │ 8. S3 Event: ObjectCreated
       ▼
┌──────────────────────────────────────────────────────────────┐
│   Lambda: input_handler                                       │
│                                                               │
│   9. Extract S3 metadata                                     │
│   10. Validate filename format                               │
│   11. Check DynamoDB for duplicates                          │
│   12. Create/update map entry (QUEUED → DISPATCHED)         │
│   13. Increment job batchSize                                │
│   14. Launch ECS Fargate task with env vars:                │
│       - INPUT_BUCKET, INPUT_KEY, OUTPUT_BUCKET              │
│       - MAP_NAME, JOB_ID, MAP_ID                            │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│   ECS Fargate Task (Processor)                               │
│   Image: mra-mines-processor:latest (from ECR)              │
│                                                               │
│   15. Download ZIP from S3 input bucket                      │
│   16. Extract and validate:                                  │
│       - Check for .tfw georeferencing files                  │
│       - Verify image format (TIFF/PNG)                       │
│   17. Image normalization:                                   │
│       - Color correction                                     │
│       - Contrast adjustment                                  │
│   18. Text extraction (EasyOCR):                            │
│       - Detect text regions                                  │
│       - OCR with confidence scores                           │
│       - Extract pixel coordinates                            │
│       - Transform to geographic coordinates                  │
│   19. Line detection:                                        │
│       - Hue-based filtering (geological features)           │
│       - Morphological operations                             │
│       - Contour detection                                    │
│       - Line fitting                                         │
│       - Coordinate transformation                            │
│   20. Validation:                                            │
│       - Verify sheet number in extracted text               │
│       - Check coordinate bounds                              │
│   21. Generate GeoPackage output (.gpkg):                   │
│       - Text layer (points with labels)                     │
│       - Line layers (colored by feature type)               │
│   22. Upload results to S3 output bucket                    │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│   S3 Output Bucket                                            │
│   - Stores GeoPackage files                                  │
│   - Permanent storage (no lifecycle)                         │
│   - Versioning enabled                                       │
└──────┬───────────────────────────────────────────────────────┘
       │ 23. S3 Event: ObjectCreated
       ▼
┌──────────────────────────────────────────────────────────────┐
│   Lambda: output_handler                                      │
│                                                               │
│   24. Parse S3 key (extract mapId/mapName)                  │
│   25. Update map entry:                                      │
│       - status: PROCESSING → COMPLETED                       │
│       - outputUrl, outputSizeBytes                           │
│       - processedAt timestamp                                │
│   26. Increment job processedCount (idempotent)             │
│   27. Check job completion:                                  │
│       if processedCount >= batchSize:                        │
│           Evaluate job status (COMPLETED/PARTIAL_SUCCESS)    │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│   DynamoDB                                                    │
│   - maps table: Updated with COMPLETED status                │
│   - map-jobs table: Updated processedCount                   │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│   Frontend (Polling)                                          │
│                                                               │
│   28. Auto-refresh every 10-30 seconds                       │
│   29. Query DynamoDB via /maps page                          │
│   30. Display updated status to user                         │
│   31. Show download button when COMPLETED                    │
└───────────────────────────────────────────────────────────────┘
```

### 2. Failure Handling Flow

```
┌──────────────────────────────────────────────────────────────┐
│   ECS Task Failure Scenarios                                  │
└──────┬───────────────────────────────────────────────────────┘
       │
       ├─ Scenario A: Task crashes (exit code ≠ 0)
       │  ├─ CloudWatch Event: ECS Task State Change (STOPPED)
       │  └─ Lambda: ecs_state_handler
       │     ├─ Detect abnormal termination
       │     ├─ Update map status: PROCESSING → FAILED
       │     └─ Log failure reason (OOM, timeout, etc.)
       │
       ├─ Scenario B: Processing error (exception in code)
       │  ├─ Processor logs error to CloudWatch
       │  ├─ No output uploaded to S3
       │  └─ User can retry via /maps page
       │
       └─ Scenario C: Invalid filename format
          ├─ Lambda: input_handler validates filename
          ├─ Create map entry with FAILED status
          └─ Store validation error message
```

### 3. Authentication Flow (OAuth 2.0 PKCE)

```
┌──────────┐                                    ┌──────────────┐
│  User    │                                    │   Cognito    │
│ Browser  │                                    │  User Pool   │
└────┬─────┘                                    └──────┬───────┘
     │                                                  │
     │ 1. Click "Login"                                │
     ├────────────────────────────────────────────────►│
     │                                                  │
     │ 2. Generate PKCE code_verifier & code_challenge│
     │    - code_verifier: random 128 chars           │
     │    - code_challenge: base64(sha256(verifier))  │
     │                                                  │
     │ 3. Redirect to Cognito Hosted UI                │
     │    with code_challenge                          │
     ├────────────────────────────────────────────────►│
     │                                                  │
     │                                   4. Show login form
     │                                   5. User authenticates
     │                                                  │
     │ 6. Redirect to /auth/callback?code=AUTH_CODE   │
     │◄────────────────────────────────────────────────┤
     │                                                  │
     ▼                                                  │
┌─────────────────┐                                    │
│   Frontend      │                                    │
│   Server        │                                    │
│ /auth/callback  │                                    │
└────┬────────────┘                                    │
     │                                                  │
     │ 7. Exchange code for tokens                     │
     │    POST /oauth2/token                           │
     │    - code, code_verifier, client_id            │
     ├────────────────────────────────────────────────►│
     │                                                  │
     │ 8. Return tokens                                │
     │    - access_token (1h)                          │
     │    - refresh_token (30d)                        │
     │    - id_token (1h)                              │
     │◄────────────────────────────────────────────────┤
     │                                                  │
     │ 9. Store tokens in httpOnly, secure cookies    │
     │ 10. Create session (locals.user)               │
     │ 11. Redirect to dashboard                       │
     │                                                  │
     ▼                                                  │
┌─────────────────┐                                    │
│   User sees     │                                    │
│   Dashboard     │                                    │
└─────────────────┘                                    │
```

## Resource Naming Convention

All AWS resources follow a consistent naming pattern for easy identification and management:

```
{project_name}-{resource_type}-{environment}
```

**Examples**:
- `mra-mines-frontend-staging` - ECS service
- `mra-mines-map-input-staging` - S3 input bucket
- `mra-mines-maps-staging` - DynamoDB maps table
- `mra-mines-cluster-staging` - ECS cluster

**Environment Values**: `dev`, `staging`, `production`

## Multi-Repository Integration

### Repository Structure

```
Project: MRA Mines Map Application
├── Repository 1: final-mra-maps-project (GitHub)
│   ├── Purpose: Web application + infrastructure
│   ├── Technology: SvelteKit + Terraform + Lambda
│   └── Deployment: terraform apply
│
└── Repository 2: mra-mine-plans-ds (GitLab)
    ├── Purpose: Map processing engine
    ├── Technology: Python + ML/CV libraries
    └── Deployment: GitLab CI → ECR
```

### Integration Points

1. **Docker Image Reference** (`infra/ecs.tf`):
   ```hcl
   container_definitions = jsonencode([{
     name  = "processor"
     image = "719259376075.dkr.ecr.eu-west-2.amazonaws.com/mra-mines-processor:latest"
     ...
   }])
   ```

2. **Environment Variables** (Lambda → ECS):
   ```python
   environment = [
     {"name": "INPUT_BUCKET", "value": input_bucket},
     {"name": "INPUT_KEY", "value": s3_key},
     {"name": "OUTPUT_BUCKET", "value": output_bucket},
     {"name": "MAP_NAME", "value": map_name},
     {"name": "JOB_ID", "value": job_id},
     {"name": "MAP_ID", "value": map_id}
   ]
   ```

3. **Data Contract** (S3 + DynamoDB):
   - Input: ZIP files in S3 with specific metadata
   - Output: GeoPackage files with standardized naming
   - Status updates: DynamoDB map entries

### Deployment Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  Developer Workflow                                          │
└─────────────────────────────────────────────────────────────┘

1. Code Changes in mra-mine-plans-ds (GitLab)
   ├─ Push to main branch
   ├─ GitLab CI triggered (.gitlab-ci.yml)
   ├─ Docker build (multi-stage, optimized)
   ├─ Docker tag: mra-mines-processor:latest
   └─ Push to ECR: 719259376075.dkr.ecr.eu-west-2.amazonaws.com

2. Code Changes in final-mra-maps-project (GitHub)
   ├─ Modify frontend or infrastructure code
   ├─ Test locally (npm run dev, terraform plan)
   ├─ Commit and push to dev/main branch
   └─ Deploy: ./scripts/deploy.sh
      ├─ Build frontend Docker image
      ├─ Push to ECR
      ├─ terraform apply (updates ECS task definition)
      └─ ECS pulls latest images on next task launch

3. Coordinated Deployment (Breaking Changes)
   ├─ Step 1: Deploy processor (mra-mine-plans-ds)
   │  └─ Wait for ECR image push to complete
   ├─ Step 2: Update infrastructure (final-mra-maps-project)
   │  ├─ Update ECS task definition if needed
   │  └─ Deploy frontend with compatible API changes
   └─ Step 3: Verify integration
      ├─ Upload test map
      └─ Confirm processing completes successfully
```

## Security Architecture

### Defense in Depth

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Network Security                                   │
├─────────────────────────────────────────────────────────────┤
│  - VPC with private subnets (ECS tasks)                     │
│  - Security groups (least-privilege ingress/egress)         │
│  - ALB with HTTPS-only (TLS 1.2+)                           │
│  - No public IPs on ECS tasks (NAT Gateway for egress)     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Authentication & Authorization                     │
├─────────────────────────────────────────────────────────────┤
│  - AWS Cognito User Pool (OAuth 2.0 PKCE)                   │
│  - Session tokens in httpOnly, secure cookies               │
│  - IAM roles with least-privilege policies                  │
│  - Resource-based policies on S3 buckets                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Data Protection                                    │
├─────────────────────────────────────────────────────────────┤
│  - S3 buckets: Private (no public access)                   │
│  - S3 encryption: SSE-S3 (server-side encryption)          │
│  - DynamoDB: Encryption at rest (AWS managed keys)          │
│  - Presigned URLs: 1-hour expiration                        │
│  - HTTPS for all data in transit                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Application Security                              │
├─────────────────────────────────────────────────────────────┤
│  - Input validation (client & server)                       │
│  - Rate limiting on API endpoints                           │
│  - CORS configuration (whitelisted origins)                 │
│  - Content Security Policy (CSP) headers                    │
│  - SQL injection prevention (parameterized queries)         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Monitoring & Auditing                             │
├─────────────────────────────────────────────────────────────┤
│  - CloudWatch Logs (all Lambda & ECS)                       │
│  - Audit logging for user actions                           │
│  - Failed authentication tracking                           │
│  - Anomaly detection (future: CloudWatch Alarms)           │
└─────────────────────────────────────────────────────────────┘
```

### IAM Policy Examples

**ECS Task Role** (Frontend):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::mra-mines-map-input-staging/*",
        "arn:aws:s3:::mra-mines-map-output-staging/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/mra-mines-maps-staging",
        "arn:aws:dynamodb:*:*:table/mra-mines-maps-staging/index/*"
      ]
    }
  ]
}
```

## Performance & Scalability

### Current Configuration

| Component | Scaling Strategy | Current Limits |
|-----------|-----------------|----------------|
| ALB | Auto-scales | No limit |
| ECS Frontend | Auto-scaling (1-3 tasks) | 3 concurrent users/task |
| ECS Processor | On-demand | 1 task per map |
| Lambda | Auto-scales | 1000 concurrent (AWS limit) |
| DynamoDB | On-demand capacity | No limit |
| S3 | Unlimited | No limit |

### Performance Metrics

**Upload Performance**:
- 10 MB file: ~5-10 seconds (presigned URL upload)
- 100 MB file: ~30-60 seconds
- Concurrent uploads: Up to 10 per user

**Processing Performance**:
- Simple map (text only): ~2-5 minutes
- Complex map (text + lines): ~5-15 minutes
- Factors: Image size, text density, line complexity

**Query Performance**:
- Map list (50 items): ~500ms
- Map search: ~200-500ms (GSI query)
- Job status check: ~100-200ms (GetItem)

### Scaling Considerations

**Horizontal Scaling**:
- Frontend: Increase ECS task count (1 → 10+)
- Processor: Parallel task execution (limited by ECS quota)
- Lambda: Automatic (up to account limits)

**Vertical Scaling**:
- Frontend: Increase CPU/memory (512/1024 → 1024/2048)
- Processor: Increase CPU/memory for faster processing

**Cost Optimization**:
- Use Fargate Spot for processor tasks (70% discount)
- Enable DynamoDB auto-scaling (on-demand → provisioned)
- Use S3 Intelligent-Tiering for long-term storage

## Monitoring & Observability

### CloudWatch Logs

**Log Groups**:
- `/ecs/mra-mines-frontend-staging` - Frontend application logs
- `/ecs/mra-mines-processor-staging` - Processor logs
- `/aws/lambda/input_handler` - Input handler Lambda
- `/aws/lambda/output_handler` - Output handler Lambda
- `/aws/lambda/ecs_state_handler` - ECS state handler Lambda

**Log Retention**: 7 days (configurable)

### Metrics

**Custom Metrics** (Future):
- Processing duration per map
- Upload success rate
- Authentication failures
- API endpoint latency

**AWS Metrics** (Built-in):
- ECS: CPU utilization, memory utilization
- ALB: Request count, target response time, 5xx errors
- Lambda: Invocations, errors, duration, throttles
- DynamoDB: Read/write capacity, throttled requests

### Distributed Tracing

**Correlation IDs**:
- Generated for each request: `x-correlation-id` header
- Passed through: Frontend → Lambda → ECS → DynamoDB
- Logged at each stage for end-to-end tracing

**X-Ray Integration** (Future):
- Service map visualization
- Latency analysis
- Error rate tracking

## Disaster Recovery

### Backup Strategy

| Component | Backup Method | Frequency | Retention |
|-----------|--------------|-----------|-----------|
| DynamoDB | Point-in-time recovery (PITR) | Continuous | 35 days |
| S3 Output | Versioning enabled | On update | Unlimited |
| S3 Input | No backup (temporary) | N/A | 5 days |
| Terraform State | S3 versioning | On change | Unlimited |

### Recovery Procedures

**Scenario 1: Regional Outage**
- Primary Region: eu-west-2 (London)
- DR Region: eu-central-1 (Frankfurt) - manual failover
- RTO: 4 hours (rebuild infrastructure in DR region)
- RPO: 24 hours (DynamoDB exports, S3 replication)

**Scenario 2: Data Corruption**
- DynamoDB: Restore from PITR (select timestamp)
- S3: Restore from version history

**Scenario 3: Accidental Deletion**
- Infrastructure: `terraform plan` before `terraform apply`
- S3: Enable MFA delete (future)
- DynamoDB: Enable deletion protection (future)

## Cost Estimation

### Monthly Cost Breakdown (Moderate Usage)

| Service | Usage | Cost (USD) |
|---------|-------|-----------|
| ECS Fargate (Frontend) | 730 hours × 0.5 vCPU, 1 GB | $15-20 |
| ECS Fargate (Processor) | 100 hours × 1 vCPU, 2 GB | $8-12 |
| ALB | 1 ALB + data processing | $16-22 |
| DynamoDB | 1M reads, 500K writes (on-demand) | $2-10 |
| S3 Storage | 100 GB output bucket | $2-3 |
| S3 Requests | 10K PUT, 100K GET | $1-2 |
| Lambda | 10K invocations, 256 MB, 30s avg | $0-2 (free tier) |
| CloudWatch Logs | 10 GB ingestion, 7-day retention | $5-8 |
| ECR | 20 GB image storage | $2 |
| Data Transfer | 100 GB out to internet | $9 |
| **Total** | | **$60-90/month** |

**Cost Optimization Tips**:
- Use Fargate Spot for processor (save 70%)
- Enable S3 lifecycle policies (archive old outputs)
- Switch DynamoDB to provisioned capacity (predictable workload)
- Use CloudWatch Logs export to S3 (cheaper long-term storage)

## Optional: Custom Domain Setup

When `enable_custom_domain = true` in `terraform.tfvars`:

### Components

| Component | Purpose | Cost |
|-----------|---------|------|
| Route 53 Hosted Zone | DNS management | $0.50/month |
| ACM Certificate | Free SSL/TLS certificate | $0 |
| ALB Listener | HTTPS with ACM cert | Included |

### Configuration

```hcl
# terraform.tfvars
enable_custom_domain = true
domain_name          = "mine-maps.example.com"
hosted_zone_id       = "Z1234567890ABC"  # Existing Route 53 zone
```

### DNS Records

```
mine-maps.example.com.  A  ALIAS  mra-mines-alb-123456.eu-west-2.elb.amazonaws.com
```

### Certificate Validation

- **Method**: DNS validation (automatic with Route 53)
- **Issuance Time**: 5-10 minutes
- **Renewal**: Automatic (AWS managed)

## Recent Architecture Improvements

### December 2024 - January 2025

1. **Data Integrity Enhancement** (Dec 22, 2024):
   - Added idempotency to `s3_copy_processor` Lambda
   - Prevent `processedCount` from exceeding `batchSize`
   - Track processed maps using DynamoDB StringSet
   - Display warning badge for inconsistent job counts

2. **Failure Detection** (Dec 5, 2024):
   - Enhanced `ecs_state_handler` to detect abnormal task terminations
   - Mark maps as FAILED when ECS tasks crash/stop unexpectedly
   - Log failure reasons (OOM, timeout, etc.)

3. **User Identity Tracking** (Jan 7, 2025):
   - Store `ownerName` and `ownerUsername` from Cognito
   - Display human-readable usernames in UI
   - Improve search functionality with user fields

4. **UI/UX Improvements**:
   - Real-time status updates with auto-refresh
   - Bulk download functionality
   - Search and filter enhancements
   - Processing timeline visualization
   - Dark mode support

## Future Enhancements

### Short-Term (Q1 2025)

- [ ] Implement CloudWatch Alarms for critical metrics
- [ ] Add email notifications (SES integration)
- [ ] Webhook support for job completion
- [ ] Admin dashboard for system monitoring
- [ ] Enhanced error messages with troubleshooting tips

### Mid-Term (Q2-Q3 2025)

- [ ] Multi-region deployment (DR in eu-central-1)
- [ ] Advanced search (full-text search with OpenSearch)
- [ ] Map preview thumbnails (generate on upload)
- [ ] Batch retry functionality
- [ ] Cost analytics dashboard

### Long-Term (Q4 2025+)

- [ ] Machine learning model improvements (higher accuracy)
- [ ] Support for additional file formats (PDF, GeoTIFF)
- [ ] API key management for programmatic access
- [ ] Advanced geospatial analysis features
- [ ] Mobile app for on-site map capture

## Appendix

### Technology Versions

| Technology | Version | EOL Date |
|------------|---------|----------|
| Node.js | 20.x | 2026-04-30 |
| Python | 3.11 | 2027-10 |
| SvelteKit | 2.43.2 | N/A (rolling) |
| Terraform | 1.6.0+ | N/A (rolling) |
| AWS Services | Latest | N/A (managed) |

### Useful Commands

**Deploy Infrastructure**:
```bash
cd deployment-package
./scripts/deploy.sh
```

**Build Frontend Locally**:
```bash
cd deployment-package/frontend
npm install
npm run build
```

**Tail CloudWatch Logs**:
```bash
aws logs tail /ecs/mra-mines-frontend-staging --follow --region eu-west-2
```

**Rebuild Processor Image**:
```bash
cd mra-mine-plans-ds
docker build -t mra-mines-processor:latest .
docker tag mra-mines-processor:latest 719259376075.dkr.ecr.eu-west-2.amazonaws.com/mra-mines-processor:latest
docker push 719259376075.dkr.ecr.eu-west-2.amazonaws.com/mra-mines-processor:latest
```

### Support & Documentation

- **Architecture Doc**: `docs/architecture.md` (this file)
- **Deployment Guide**: `docs/deployment-guide.md`
- **Troubleshooting**: `docs/troubleshooting.md`
- **README**: `README.md`

---

**Document Version**: 2.0
**Last Updated**: January 7, 2025
**Maintained By**: Development Team
