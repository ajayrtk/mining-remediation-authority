# Developer Onboarding Guide

Welcome to the MRA Mine Maps Processing System! This guide will help you get up to speed with the codebase, architecture, and development workflow.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Overview](#project-overview)
3. [Project Structure](#project-structure)
4. [Local Development Setup](#local-development-setup)
5. [Architecture Overview](#architecture-overview)
6. [Development Workflow](#development-workflow)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Common Tasks](#common-tasks)
10. [Troubleshooting](#troubleshooting)
11. [Code Style Guidelines](#code-style-guidelines)
12. [Useful Resources](#useful-resources)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18+ and npm
- **Docker** (for local container testing)
- **AWS CLI** v2 configured with appropriate credentials
- **Terraform** v1.5+
- **Python** 3.11+ (for Lambda development)
- **Git**
- **Code Editor** (VS Code recommended)

### AWS Access

You'll need AWS credentials with permissions for:
- S3 (read/write)
- DynamoDB (read/write)
- ECS (task management)
- Lambda (function invocation)
- CloudWatch Logs (read)

Ask your team lead to provision an IAM user with the `mra-developer` policy.

## Project Overview

The MRA Mine Maps Processing System is a serverless application that:

1. **Accepts** user-uploaded mine map ZIP files via web interface
2. **Validates** filename format and ZIP contents
3. **Processes** mine plan PDFs using EasyOCR/OpenCV in ECS
4. **Stores** processed maps in S3 and metadata in DynamoDB
5. **Provides** download and management interface

**Tech Stack:**
- **Frontend:** SvelteKit + TypeScript
- **Backend:** AWS Lambda (Python) + ECS Fargate (Python)
- **Storage:** S3 + DynamoDB
- **Infrastructure:** Terraform
- **Deployment:** Docker + AWS ECS

## Project Structure

```
deployment-package/
├── frontend/                    # SvelteKit web application
│   ├── src/
│   │   ├── routes/             # SvelteKit routes & API endpoints
│   │   │   ├── +page.svelte    # Main upload interface
│   │   │   ├── +page.server.ts # Server-side data loading
│   │   │   ├── +layout.svelte  # Root layout
│   │   │   ├── maps/           # Maps management page
│   │   │   │   └── +page.svelte
│   │   │   ├── auth/           # Authentication routes
│   │   │   │   └── callback/   # OAuth callback
│   │   │   └── api/            # API endpoints
│   │   │       ├── presigned-url/    # Generate S3 upload URLs
│   │   │       ├── delete-map/       # Delete map files
│   │   │       ├── retry-map/        # Retry failed processing
│   │   │       ├── download-url/     # Generate download URLs
│   │   │       ├── bulk-download/    # Bulk download
│   │   │       ├── batch-operations/ # Batch delete/retry
│   │   │       ├── validate-map/     # Validate map files
│   │   │       └── webhooks/         # External webhooks
│   │   └── lib/
│   │       ├── server/         # Server-side utilities
│   │       │   ├── dynamo.ts   # DynamoDB client
│   │       │   ├── s3.ts       # S3 client
│   │       │   ├── cognito.ts  # Cognito authentication
│   │       │   ├── circuit-breaker.ts  # Fault tolerance
│   │       │   ├── rate-limit.ts       # Request limiting
│   │       │   ├── audit-log.ts        # Logging
│   │       │   ├── tracing.ts          # Request tracing
│   │       │   └── webhook.ts          # Webhook handling
│   │       ├── utils/          # Shared utilities
│   │       │   ├── filenameParser.ts   # Filename validation
│   │       │   └── zipValidator.ts     # ZIP file validation
│   │       ├── components/     # Svelte components
│   │       ├── stores/         # Svelte stores
│   │       └── styles/         # CSS styles
│   ├── Dockerfile
│   ├── build_and_push.sh       # Deploy script
│   ├── package.json
│   └── svelte.config.js
│
├── infra/                       # Terraform infrastructure
│   ├── lambda/                  # Lambda function code
│   │   ├── input_handler/      # S3 upload trigger
│   │   │   └── handler.py      # Validates uploads, launches ECS
│   │   ├── output_handler/     # Processing complete handler
│   │   │   └── handler.py
│   │   ├── s3_copy_processor/  # S3 copy operations (fallback)
│   │   │   └── handler.py
│   │   └── pre_auth_trigger/   # Cognito validation
│   ├── main.tf                 # Provider configuration
│   ├── vpc.tf                  # Networking
│   ├── alb.tf                  # Application Load Balancer
│   ├── ecs.tf                  # Processor task definition
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
├── docs/                        # Documentation (you are here)
│
└── backend/                     # (Empty - serverless architecture)
```

**Important:** The `backend/` folder is empty because the application uses a **serverless architecture**:
- Backend API logic is in `frontend/src/routes/api/` (SvelteKit API routes)
- Processing logic is in Lambda functions (`infra/lambda/`)
- Heavy processing runs on ECS Fargate (Docker image from separate `mra-mine-plans-ds` repository)

## Local Development Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd final-mra-maps-project/deployment-package
```

### 2. Frontend Setup

```bash
cd frontend
npm install
```

Create `.env.local` with your development AWS credentials:

```env
AWS_REGION=eu-west-2
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
MAPS_TABLE=mra-mines-staging-maps
JOBS_TABLE=mra-mines-staging-jobs
MAP_INPUT_BUCKET=mra-mines-staging-input
MAP_OUTPUT_BUCKET=mra-mines-staging-output
COGNITO_USER_POOL_ID=eu-west-2_XXXXX
COGNITO_CLIENT_ID=your_client_id
```

Start the development server:

```bash
npm run dev
# Visit http://localhost:5173
```

### 3. Lambda Functions

Lambda functions are in `infra/lambda/`. Each function has its own directory with a `handler.py`:

```bash
cd infra/lambda/input_handler
# Review the handler.py file
```

To test locally, you can invoke Lambda functions using AWS SAM or direct Python execution with test events.

### 4. ECS Processor

The ECS processing task is in a **separate repository**: `mra-mine-plans-ds`

**Important:** Do NOT modify this repository directly unless coordinating with the data science team. The processor Docker image:
- Contains EasyOCR for text recognition
- Uses OpenCV for image processing
- Uses GDAL for geospatial operations
- Is built and pushed separately

### 5. Infrastructure Setup

The Terraform configuration is in `infra/`:

```bash
cd infra
terraform init
terraform plan -var-file="terraform.tfvars"
```

**Important:** Never commit `terraform.tfvars` with real credentials.

## Architecture Overview

### High-Level Flow

```
User Browser
    ↓ (1. Upload request)
Frontend (SvelteKit on ECS)
    ↓ (2. Generate presigned URL)
    ↓ (3. Browser uploads directly to S3)
S3 Input Bucket
    ↓ (4. S3 Event triggers Lambda)
Lambda: input_handler
    ↓ (5. Validate & create job record)
DynamoDB (Maps + Jobs tables)
    ↓ (6. Lambda launches ECS task)
ECS Task (Python + EasyOCR + OpenCV)
    ↓ (7. Process map -> results)
S3 Output Bucket
    ↓ (8. Update status)
DynamoDB
    ↓ (9. User downloads)
Frontend -> S3 Output (presigned URL)
```

### Key Components

**Frontend (`frontend/`):**
- **SvelteKit app** with SSR and API routes
- **Routes:** Upload interface (`/`), Maps management (`/maps`)
- **API Endpoints:** `/api/presigned-url`, `/api/delete-map`, `/api/retry-map`, etc.
- **Server utilities:** DynamoDB client, S3 client, circuit breaker, rate limiting

**Lambda Functions (`infra/lambda/`):**
- **input_handler:** Validates uploads, creates DynamoDB entries, triggers ECS
- **output_handler:** Updates status when processing completes
- **s3_copy_processor:** Fallback processor (Lambda-based)
- **pre_auth_trigger:** Cognito authentication validation

**ECS Processor (separate repo):**
- **Python processing engine** using EasyOCR, OpenCV, GDAL
- Extracts mine plan data from maps
- Uploads results to S3 output bucket

**Infrastructure (`infra/`):**
- **Terraform modules** for all AWS resources
- **State management** via local state (consider S3 backend for production)

## Development Workflow

### 1. Branching Strategy

We use **feature branches** with PR reviews:

```bash
# Create feature branch
git checkout -b feature/add-bulk-download

# Make changes, commit
git add .
git commit -m "Add bulk download endpoint"

# Push and create PR
git push origin feature/add-bulk-download
```

**Branch Naming:**
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation updates

### 2. Making Changes

**Frontend Changes:**

1. Start dev server: `npm run dev`
2. Make changes to `.svelte` or `.ts` files
3. Hot reload will reflect changes automatically
4. Test in browser at `http://localhost:5173`

**Lambda Changes:**

1. Edit handler code in `infra/lambda/*/handler.py`
2. Test locally with sample events
3. Deploy via Terraform (see Deployment section)

**Infrastructure Changes:**

1. Edit `.tf` files in `infra/`
2. Run `terraform plan` to preview changes
3. Get approval before applying
4. Apply with `terraform apply`

### 3. Code Review

All changes require PR review before merging:

1. **Create PR** with clear description
2. **Run tests** locally: `npm test`
3. **Request review** from team member
4. **Address feedback** and update PR
5. **Merge** after approval

## Testing

### Running Tests

**Frontend Unit Tests:**

```bash
cd frontend
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Generate coverage report
```

### Writing Tests

Create test files alongside source files with `.test.ts` extension:

```typescript
// src/lib/utils/filenameParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseMapFilename } from './filenameParser';

describe('parseMapFilename', () => {
  it('should parse valid filename', () => {
    const result = parseMapFilename('16516_433857.zip');
    expect(result.valid).toBe(true);
  });

  it('should reject invalid extension', () => {
    const result = parseMapFilename('16516_433857.pdf');
    expect(result.valid).toBe(false);
  });
});
```

## Deployment

### Environments

- **staging** - Pre-production testing (eu-west-2)
- **production** - Live system (manual deployment with approval)

### Frontend Deployment

Frontend is deployed as Docker container to ECS:

```bash
cd frontend
./build_and_push.sh
```

This script:
1. Builds Docker image
2. Pushes to ECR
3. Updates ECS service
4. Forces new deployment

**Manual deployment:**

```bash
# Build and tag image
docker build -t mra-frontend .
docker tag mra-frontend:latest <ECR_URI>:latest

# Push to ECR
aws ecr get-login-password --region eu-west-2 | docker login --username AWS --password-stdin <ECR_URI>
docker push <ECR_URI>:latest

# Update ECS service
aws ecs update-service \
  --cluster mra-mines-cluster-staging \
  --service mra-mines-frontend-staging \
  --force-new-deployment \
  --region eu-west-2
```

### Lambda Deployment

Lambda functions are deployed via Terraform:

```bash
cd infra
terraform apply -target=aws_lambda_function.input_handler
```

### Infrastructure Deployment

For infrastructure changes:

```bash
cd infra
terraform plan -var-file="terraform.tfvars"
# Review plan carefully
terraform apply -var-file="terraform.tfvars"
```

## Common Tasks

### Adding a New API Endpoint

1. **Create route file:**
   ```bash
   mkdir -p frontend/src/routes/api/my-endpoint
   touch frontend/src/routes/api/my-endpoint/+server.ts
   ```

2. **Implement handler:**
   ```typescript
   import { json } from '@sveltejs/kit';
   import type { RequestHandler } from './$types';

   export const POST: RequestHandler = async ({ request, locals }) => {
     if (!locals.user) {
       return json({ error: 'Unauthorized' }, { status: 401 });
     }

     const body = await request.json();
     // Process request
     return json({ success: true });
   };
   ```

3. **Add rate limiting if needed:**
   ```typescript
   import { checkRateLimit, RateLimitPresets } from '$lib/server/rate-limit';

   const rateLimit = checkRateLimit(locals.user.email, RateLimitPresets.UPLOAD);
   if (!rateLimit.allowed) {
     return json({ error: 'Rate limit exceeded' }, { status: 429 });
   }
   ```

### Viewing Logs

**Frontend Logs (ECS):**
```bash
aws logs tail /ecs/mra-mines-frontend-staging --follow --region eu-west-2
```

**Lambda Logs:**
```bash
aws logs tail /aws/lambda/mra-mines-input-handler-staging --follow --region eu-west-2
```

**Processor Logs:**
```bash
aws logs tail /ecs/mra-mines-processor-staging --follow --region eu-west-2
```

### Debugging Failed Jobs

1. **Find the job in DynamoDB:**
   ```bash
   aws dynamodb get-item \
     --table-name mra-mines-staging-maps \
     --key '{"mapId":{"S":"map_abc123"},"mapName":{"S":"16516_433857.zip"}}' \
     --region eu-west-2
   ```

2. **Check ECS task logs:**
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/mra-mines-processor-staging \
     --filter-pattern "map_abc123" \
     --region eu-west-2
   ```

3. **Retry via UI or API:**
   Use the "Retry" button in the web interface or call `/api/retry-map`

## Troubleshooting

### Common Issues

#### "Circuit breaker is OPEN for DynamoDB"

**Cause:** Too many DynamoDB failures in short time window

**Solution:**
1. Check DynamoDB throttling metrics in CloudWatch
2. Verify provisioned capacity is sufficient
3. Wait for circuit breaker to reset (30-60 seconds)

#### "Rate limit exceeded"

**Cause:** User exceeded upload quota (20 uploads/hour)

**Solution:**
1. Wait for rate limit window to reset
2. If legitimate use case, adjust limit in `rate-limit.ts`

#### "Failed to generate presigned URL"

**Cause:** S3 permissions issue or circuit breaker open

**Solution:**
1. Verify IAM role has `s3:PutObject` permission
2. Check S3 bucket policy
3. Check CloudWatch logs for detailed error

#### ECS Task Stuck in PENDING

**Cause:** Insufficient ECS capacity or resource constraints

**Solution:**
1. Check ECS cluster capacity
2. Verify security groups allow outbound traffic
3. Check for networking/subnet issues

## Code Style Guidelines

### TypeScript/JavaScript

- Use **tabs** for indentation
- Max line length: 120 characters
- Use single quotes for strings
- Semicolons required

**Example:**
```typescript
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB

interface MapMetadata {
	mapId: string;
	mapName: string;
	uploadedAt: string;
}

async function processMapUpload(file: File): Promise<MapMetadata> {
	if (file.size > MAX_UPLOAD_SIZE) {
		throw new Error('File too large');
	}
	// Process...
}
```

### Python

- Use **4 spaces** for indentation
- Max line length: 100 characters
- Follow PEP 8

**Example:**
```python
MAX_RETRIES = 3

def process_map(map_id: str, input_path: str) -> dict:
    """
    Process a mine map file.

    Args:
        map_id: Unique map identifier
        input_path: S3 path to input file

    Returns:
        Processing result metadata
    """
    return {"status": "completed"}
```

### Comments

**Good comments explain WHY, not WHAT:**

```typescript
// Good: Explains reasoning
// Reduced from 1 hour to 15 minutes for better security
// URLs are only needed for immediate upload after generation
const PRESIGNED_URL_EXPIRY_SECONDS = 900;

// Bad: States the obvious
// Set expiry to 900 seconds
const PRESIGNED_URL_EXPIRY_SECONDS = 900;
```

## Useful Resources

### Internal Documentation

- **Architecture Overview:** `docs/architecture.md`
- **Maintenance Guide:** `docs/maintenance-guide.md`
- **Troubleshooting:** `docs/troubleshooting.md`

### External Resources

**SvelteKit:**
- [Official Docs](https://kit.svelte.dev/docs)
- [Tutorial](https://learn.svelte.dev/)

**AWS SDK for JavaScript:**
- [DynamoDB Document Client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-dynamodb/)
- [S3 Client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/)

**Terraform:**
- [AWS Provider Docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)

**Testing:**
- [Vitest Docs](https://vitest.dev/)

### Getting Help

1. **Check documentation** in `docs/` directory first
2. **Search CloudWatch Logs** for error messages
3. **Ask in team Slack channel** #mra-mines-dev
4. **Create GitHub issue** for bugs or feature requests

---

**Welcome to the team! Happy coding!**

**Last Updated:** 2025-11-25
