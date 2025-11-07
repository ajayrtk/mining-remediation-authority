# Map ML Web Console

SvelteKit front-end for uploading ZIP archives, tracking job state, and viewing processing results.

## Documentation

For complete system documentation, see:
- **[ARCHITECTURE.md](../ARCHITECTURE.md)** - System architecture and component details
- **[DETAILED_FLOWS.md](../../DETAILED_FLOWS.md)** - Complete authentication and upload flows
- **[README.md](../README.md)** - Main project README with quickstart guide

This document focuses on **frontend-specific setup and development**.

## Features

- **Presigned URL Upload**: Client-side direct upload to S3 for optimal performance
- **Batch Processing**: Upload up to 20 files in a single job
- **Content Deduplication**: SHA-256 hash-based duplicate detection
- **ZIP Validation**: Client-side validation checks for required image files
- **Job Tracking**: Real-time status monitoring with map names and progress
- **Cognito Authentication**: Secure OAuth2 login with hosted UI

## Prerequisites

- Node.js 18+
- Terraform outputs from `infra/` so you can populate the environment variables listed below

## Environment variables

Copy `.env.example` to `.env.local` and populate it from Terraform. The infrastructure provisions the Cognito User Pool, app client, and hosted domain for you.

```bash
cp .env.example .env.local
terraform -chdir=../infra output frontend_env_block
```

Paste the resulting block into `.env.local`; it includes:
- `AWS_REGION` - AWS region (e.g., eu-west-2)
- `MAP_INPUT_BUCKET` - S3 bucket for uploaded ZIP files
- `MAP_JOBS_TABLE` - DynamoDB table for job tracking
- `MAPS_TABLE` - DynamoDB table for map metadata
- `COGNITO_REGION` - Cognito region
- `COGNITO_USER_POOL_ID` - User pool ID
- `COGNITO_CLIENT_ID` - App client ID
- `COGNITO_DOMAIN` - Hosted UI domain
- `SES_SENDER_EMAIL` - Email sender address
- `AWS_ACCESS_KEY_ID` - AWS access key (server-side only)
- `AWS_SECRET_ACCESS_KEY` - AWS secret key (server-side only)

## Architecture

### Upload Flow (Presigned URLs)

```
1. User selects files → Client validates & calculates SHA-256 hash
2. Client sends file metadata to /api/presigned-url
3. Server checks for duplicates & generates presigned URLs (1-hour expiration)
4. Server returns presigned URLs to client
5. Client uploads files DIRECTLY to S3 (bypasses server)
6. S3 triggers Lambda → ECS/Lambda processing → Output to S3
```

### Benefits of Presigned URLs

- **Scalable**: Handles 200MB × 20 files × 5 concurrent users without server memory issues
- **Fast**: Direct client→S3 upload (no server hop)
- **Secure**: Time-limited URLs (1 hour), scoped to specific bucket/key
- **Efficient**: Server only generates URLs, doesn't handle file data

### Deduplication

Files are deduplicated based on **content hash (SHA-256)**, not filename:

- Same name + different content → Allowed (new processing)
- Different name + same content → Blocked (duplicate detected)
- Same name + same content → Blocked (duplicate detected)

## Development

Install dependencies and start the dev server:

```bash
npm install
npm run dev -- --open
```

The application will be available at `http://localhost:5173`

## Production build

```bash
npm run build
npm run preview
```

Use the appropriate SvelteKit adapter for your deployment target when moving to production.

## API Endpoints

### `POST /api/presigned-url`

Generates presigned URLs for uploading files to S3.

**Request:**
```json
{
  "files": [
    {
      "name": "map1.zip",
      "size": 209715200,
      "type": "application/zip",
      "hash": "a3f2b8c14d5e"
    }
  ]
}
```

**Response:**
```json
{
  "jobId": "JobId-a3f2b8c1-4d5e-4f6a-8b9c-1d2e3f4a5b6c",
  "urls": [
    {
      "url": "https://s3.amazonaws.com/...",
      "key": "map1.zip",
      "mapId": "map_a3f2b8c14d5e",
      "metadata": {
        "originalFilename": "map1.zip",
        "submittedBy": "user@example.com",
        "mapId": "map_a3f2b8c14d5e",
        "jobId": "JobId-a3f2b8c1-4d5e-4f6a-8b9c-1d2e3f4a5b6c",
        "batchSize": "1"
      }
    }
  ]
}
```

## Data Flow

1. **Upload**: Client → Presigned URL → S3 Input Bucket
2. **Processing**: S3 Event → Lambda (input_handler) → ECS/Lambda Processor
3. **Output**: Processor → S3 Output Bucket → Lambda (output_handler) → DynamoDB
4. **Display**: Frontend → DynamoDB Query → Job List UI

## File Limits

- **Max files per upload**: 20
- **Max file size**: 5GB (S3 PUT limit, but designed for ~200MB files)
- **Allowed types**: `.zip` files only
- **Presigned URL expiration**: 1 hour

## Security

- **Authentication**: Cognito OAuth2 with PKCE flow
- **Authorization**: User email/username tracked in DynamoDB
- **Upload**: Presigned URLs with scoped permissions and expiration
- **Content validation**: Client-side ZIP validation before upload
