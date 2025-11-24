# Developer Onboarding Guide

Welcome to the MRA Mine Maps Processing System! This guide will help you get up to speed with the codebase, architecture, and development workflow.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Overview](#project-overview)
3. [Local Development Setup](#local-development-setup)
4. [Architecture Overview](#architecture-overview)
5. [Directory Structure](#directory-structure)
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
3. **Processes** mine plan PDFs using GDAL/spatial libraries in ECS
4. **Stores** processed maps in S3 and metadata in DynamoDB
5. **Provides** download and management interface

**Tech Stack:**
- **Frontend:** SvelteKit + TypeScript
- **Backend:** AWS Lambda (Node.js) + ECS (Python)
- **Storage:** S3 + DynamoDB
- **Infrastructure:** Terraform
- **Deployment:** Docker + AWS ECS/Lambda

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
cp .env.example .env.local  # Create from example if exists
```

Edit `.env.local` with your development AWS credentials:

```env
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
MAPS_TABLE=mra-mines-dev-maps
JOBS_TABLE=mra-mines-dev-jobs
MAP_INPUT_BUCKET=mra-mines-dev-input
MAP_OUTPUT_BUCKET=mra-mines-dev-output
COGNITO_USER_POOL_ID=eu-west-1_XXXXX
COGNITO_CLIENT_ID=your_client_id
```

Start the development server:

```bash
npm run dev
# Visit http://localhost:5173
```

### 3. Backend Setup (Lambda Functions)

Lambda functions are in `backend/lambda/`. Each function has its own directory:

```bash
cd backend/lambda/input_handler
pip install -r requirements.txt -t .
```

To test locally, you can invoke Lambda functions using AWS SAM or direct Python execution.

### 4. ECS Task Setup (Processing Engine)

The ECS processing task is in a separate repository at:
`/Users/ajay.rawat/Projects-Hartree/MRA-Mines/mra-mine-plans-ds`

**Note:** Do NOT modify this repository directly unless coordinating with the data science team.

To test the Docker image locally:

```bash
cd /path/to/mra-mine-plans-ds
docker build -t mra-processor .
docker run --rm \
  -e AWS_REGION=eu-west-1 \
  -e AWS_ACCESS_KEY_ID=xxx \
  -e AWS_SECRET_ACCESS_KEY=xxx \
  mra-processor python process_map.py --map-id map_test123
```

### 5. Infrastructure Setup

The Terraform configuration is in `infra/`:

```bash
cd infra
terraform init
terraform plan -var-file="terraform.tfvars"
```

**Important:** Never commit `terraform.tfvars` with real credentials. Use `terraform.tfvars.example` as a template.

## Architecture Overview

### High-Level Flow

```
User Browser
    ↓ (1. Upload request)
Frontend (SvelteKit)
    ↓ (2. Generate presigned URL)
S3 Input Bucket
    ↓ (3. S3 Event triggers Lambda)
Lambda: input_handler
    ↓ (4. Validate & queue job)
DynamoDB (Maps + Jobs tables)
    ↓ (5. Lambda triggers ECS task)
ECS Task (Python + GDAL)
    ↓ (6. Process PDF → GeoJSON)
S3 Output Bucket
    ↓ (7. Update status)
DynamoDB
    ↓ (8. User downloads)
Frontend → S3 Output
```

### Key Components

**Frontend (`frontend/`):**
- **SvelteKit app** with SSR and API routes
- **Routes:** Upload interface (`/`), Maps management (`/maps`)
- **API Endpoints:** `/api/presigned-url`, `/api/delete-map`, `/api/retry-map`
- **Server utilities:** DynamoDB client, S3 client, circuit breaker, rate limiting

**Lambda Functions (`backend/lambda/`):**
- **input_handler:** Validates uploads, creates DynamoDB entries, triggers ECS
- **s3_copy_processor:** Handles S3 event notifications (future use)

**ECS Task (separate repo):**
- **Python processing engine** using GDAL, rasterio, PyPDF2
- Extracts mine plan data from PDFs and generates GeoJSON
- Uploads results to S3 output bucket

**Infrastructure (`infra/`):**
- **Terraform modules** for DynamoDB, S3, Lambda, ECS, ALB, CloudFront
- **State management** via S3 backend

### Data Flow Details

See `docs/architecture.md` for comprehensive architecture diagrams and component interactions.

## Directory Structure

```
deployment-package/
├── frontend/                    # SvelteKit web application
│   ├── src/
│   │   ├── lib/
│   │   │   ├── server/         # Server-side utilities
│   │   │   │   ├── dynamo.ts   # DynamoDB client
│   │   │   │   ├── s3.ts       # S3 client
│   │   │   │   ├── circuit-breaker.ts
│   │   │   │   ├── rate-limit.ts
│   │   │   │   ├── audit-log.ts
│   │   │   │   └── ...
│   │   │   └── utils/          # Shared utilities
│   │   │       ├── filenameParser.ts
│   │   │       └── zipValidator.ts
│   │   ├── routes/             # SvelteKit routes
│   │   │   ├── +page.svelte    # Upload interface
│   │   │   ├── maps/
│   │   │   │   └── +page.svelte  # Maps management
│   │   │   └── api/            # API endpoints
│   │   │       ├── presigned-url/+server.ts
│   │   │       ├── delete-map/+server.ts
│   │   │       └── retry-map/+server.ts
│   │   └── hooks.server.ts     # Global hooks (auth)
│   ├── package.json
│   ├── vitest.config.ts
│   └── Dockerfile
├── backend/
│   └── lambda/
│       ├── input_handler/      # Main validation Lambda
│       └── s3_copy_processor/  # S3 event handler
├── infra/                      # Terraform infrastructure
│   ├── main.tf
│   ├── dynamodb.tf
│   ├── s3.tf
│   ├── lambda.tf
│   ├── ecs.tf
│   └── ...
├── docs/                       # Documentation
│   ├── architecture.md
│   ├── maintenance-guide.md
│   ├── monitoring.md
│   └── developer-onboarding.md (this file)
└── scripts/                    # Deployment scripts
    └── deploy.sh
```

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

1. Edit handler code in `backend/lambda/*/handler.py`
2. Test locally with sample events:
   ```bash
   python handler.py
   ```
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
npm run test:ui          # Interactive UI
```

**Coverage Requirements:**
- Minimum 70% coverage for lines, functions, branches, statements
- Coverage report generated in `coverage/` directory

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
    expect(result.sheet).toBe('16516');
    expect(result.grid).toBe('433857');
  });

  it('should reject invalid extension', () => {
    const result = parseMapFilename('16516_433857.pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('.zip');
  });
});
```

### Integration Testing

Test against real AWS resources in dev environment:

1. Deploy to `dev` environment
2. Upload test files via web interface
3. Verify processing completes successfully
4. Check DynamoDB entries and S3 outputs

**Test Files:**
Use these known-good test files:
- `16516_433857.zip`
- `16519_453857.zip`

## Deployment

### Environments

We have three environments:

- **dev** - Development testing (auto-deployed from `develop` branch)
- **staging** - Pre-production testing (manual deployment)
- **production** - Live system (manual deployment with approval)

### Deployment Process

#### Frontend Deployment

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
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin <ECR_URI>
docker push <ECR_URI>:latest

# Update ECS service
aws ecs update-service \
  --cluster mra-mines-cluster-staging \
  --service mra-frontend-service \
  --force-new-deployment \
  --region eu-west-1
```

#### Lambda Deployment

Lambda functions are deployed via Terraform:

```bash
cd infra

# Package Lambda code
cd ../backend/lambda/input_handler
zip -r handler.zip .
mv handler.zip ../../../infra/build/input_handler.zip

# Deploy with Terraform
cd ../../../infra
terraform apply -target=aws_lambda_function.input_handler
```

#### Infrastructure Deployment

For infrastructure changes:

```bash
cd infra
terraform plan -var-file="terraform.tfvars"
# Review plan carefully
terraform apply -var-file="terraform.tfvars"
```

**Important:** Always run `terraform plan` first and review changes before applying.

### Rollback

If deployment fails:

**Frontend:**
```bash
# Revert to previous task definition
aws ecs update-service \
  --cluster mra-mines-cluster-staging \
  --service mra-frontend-service \
  --task-definition mra-frontend-task:PREVIOUS_REVISION
```

**Lambda:**
```bash
# Revert to previous version
aws lambda update-function-code \
  --function-name input_handler \
  --s3-bucket lambda-deployments \
  --s3-key input_handler-PREVIOUS_VERSION.zip
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

4. **Add audit logging:**
   ```typescript
   import { AuditLog } from '$lib/server/audit-log';

   AuditLog.customEvent({
     eventType: 'MY_ACTION',
     userId: locals.user.email,
     action: 'my_action',
     result: 'success'
   });
   ```

5. **Write tests:**
   ```typescript
   // src/routes/api/my-endpoint/+server.test.ts
   describe('POST /api/my-endpoint', () => {
     it('should require authentication', async () => {
       // Test implementation
     });
   });
   ```

### Adding a DynamoDB Index

1. **Edit `infra/dynamodb.tf`:**
   ```hcl
   global_secondary_index {
     name            = "MyNewIndex"
     hash_key        = "myAttribute"
     projection_type = "ALL"
     read_capacity   = 5
     write_capacity  = 5
   }
   ```

2. **Deploy:**
   ```bash
   terraform apply -target=aws_dynamodb_table.maps_table
   ```

3. **Wait for index creation** (can take several minutes)

4. **Update queries:**
   ```typescript
   const result = await dynamoDocClient.send(
     new QueryCommand({
       TableName: MAPS_TABLE,
       IndexName: 'MyNewIndex',
       KeyConditionExpression: 'myAttribute = :value',
       ExpressionAttributeValues: { ':value': someValue }
     })
   );
   ```

### Viewing Logs

**Frontend Logs (ECS):**
```bash
aws logs tail /ecs/mra-frontend --follow --region eu-west-1
```

**Lambda Logs:**
```bash
aws logs tail /aws/lambda/input_handler --follow --region eu-west-1
```

**Filter by correlation ID:**
```bash
aws logs filter-log-events \
  --log-group-name /ecs/mra-frontend \
  --filter-pattern "[correlationId=1234567890-abc]" \
  --region eu-west-1
```

### Debugging Failed Jobs

1. **Find the job in DynamoDB:**
   ```bash
   aws dynamodb get-item \
     --table-name mra-mines-staging-maps \
     --key '{"mapId":{"S":"map_abc123"},"mapName":{"S":"16516_433857.zip"}}' \
     --region eu-west-1
   ```

2. **Check ECS task logs:**
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/mra-processor \
     --filter-pattern "map_abc123" \
     --region eu-west-1
   ```

3. **Retry the job:**
   - Use the "Retry" button in the web interface, OR
   - Call the retry API:
     ```bash
     curl -X POST https://your-domain.com/api/retry-map \
       -H "Content-Type: application/json" \
       -d '{"mapId":"map_abc123","mapName":"16516_433857.zip"}'
     ```

## Troubleshooting

### Common Issues

#### "Circuit breaker is OPEN for DynamoDB"

**Cause:** Too many DynamoDB failures in short time window

**Solution:**
1. Check DynamoDB throttling metrics in CloudWatch
2. Verify provisioned capacity is sufficient
3. Wait for circuit breaker to reset (30-60 seconds)
4. Check for infrastructure issues

#### "Rate limit exceeded"

**Cause:** User exceeded upload quota (20 uploads/hour)

**Solution:**
1. Wait for rate limit window to reset
2. If legitimate use case, increase limit in `rate-limit.ts`:
   ```typescript
   UPLOAD: { maxRequests: 50, windowMs: 60 * 60 * 1000 }
   ```

#### "Failed to generate presigned URL"

**Cause:** S3 permissions issue or circuit breaker open

**Solution:**
1. Verify IAM role has `s3:PutObject` permission
2. Check S3 bucket policy
3. Verify bucket exists and is accessible
4. Check CloudWatch logs for detailed error

#### ECS Task Stuck in PENDING

**Cause:** Insufficient ECS capacity or resource constraints

**Solution:**
1. Check ECS cluster capacity:
   ```bash
   aws ecs describe-clusters \
     --clusters mra-mines-cluster-staging \
     --region eu-west-1
   ```
2. Increase desired count or instance size
3. Check for networking/security group issues

#### Frontend Not Loading

**Cause:** ECS service unhealthy or ALB issues

**Solution:**
1. Check ECS service status:
   ```bash
   aws ecs describe-services \
     --cluster mra-mines-cluster-staging \
     --services mra-frontend-service \
     --region eu-west-1
   ```
2. Check ALB target health:
   ```bash
   aws elbv2 describe-target-health \
     --target-group-arn <target-group-arn> \
     --region eu-west-1
   ```
3. Check CloudWatch logs for errors

### Debug Mode

Enable verbose logging by setting environment variable:

```bash
export DEBUG=true
npm run dev
```

This enables:
- Detailed X-Ray tracing logs
- Circuit breaker state changes
- Rate limiting decisions
- Audit log entries

## Code Style Guidelines

### TypeScript/JavaScript

**Formatting:**
- Use **tabs** for indentation (project convention)
- Max line length: 120 characters
- Use single quotes for strings
- Semicolons required

**Naming:**
- `camelCase` for variables and functions
- `PascalCase` for classes and types
- `UPPER_SNAKE_CASE` for constants
- Prefix private members with `_` if needed

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

**Formatting:**
- Use **4 spaces** for indentation
- Max line length: 100 characters
- Follow PEP 8

**Example:**
```python
MAX_RETRIES = 3

def process_map(map_id: str, input_path: str) -> dict:
    """
    Process a mine map PDF.

    Args:
        map_id: Unique map identifier
        input_path: S3 path to input file

    Returns:
        Processing result metadata
    """
    # Process...
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

**Documentation comments:**
```typescript
/**
 * Validates mine map filename format.
 * Expected format: {sheet}_{grid}.zip (e.g., "16516_433857.zip")
 *
 * @param filename - The filename to validate
 * @returns Validation result with parsed components
 */
export function parseMapFilename(filename: string): ParseResult {
  // Implementation...
}
```

### Error Handling

**Always provide context in errors:**

```typescript
// Good: Provides context
throw new Error(`Failed to process map ${mapId}: ${error.message}`);

// Bad: Vague
throw new Error('Processing failed');
```

**Use try-catch for async operations:**

```typescript
try {
	await dynamoDocClient.send(new PutCommand({ ... }));
} catch (error) {
	console.error(`[mapId=${mapId}] DynamoDB write failed`, error);
	throw error;
}
```

## Useful Resources

### Internal Documentation

- **Architecture Overview:** `docs/architecture.md`
- **Maintenance Guide:** `docs/maintenance-guide.md`
- **Monitoring Guide:** `docs/monitoring.md`
- **API Documentation:** `docs/api-reference.md`

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

### Team Contacts

- **Tech Lead:** [Name] - Infrastructure and architecture questions
- **Frontend Lead:** [Name] - SvelteKit and UI questions
- **Backend Lead:** [Name] - Lambda and ECS questions
- **DevOps:** [Name] - Deployment and infrastructure issues

### Getting Help

1. **Check documentation** in `docs/` directory first
2. **Search CloudWatch Logs** for error messages
3. **Ask in team Slack channel** #mra-mines-dev
4. **Create GitHub issue** for bugs or feature requests
5. **Schedule pairing session** with team member for complex issues

---

**Welcome to the team! Happy coding!**

For questions or suggestions about this guide, please update it directly or reach out to the team lead.
