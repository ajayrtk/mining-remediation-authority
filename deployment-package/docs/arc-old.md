# MRA Mines Map - System Architecture

## Overview

The MRA Mines Map system is a cloud-native application built on AWS, designed to process and manage mining map data. The architecture follows serverless and container-based patterns for scalability, cost-efficiency, and ease of maintenance.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                              │
│  ┌──────────────┐                                                   │
│  │   Browser    │ ──HTTPS──> CloudFront (CDN + HTTPS)              │
│  └──────────────┘                     │                             │
└───────────────────────────────────────┼─────────────────────────────┘
                                        │
┌───────────────────────────────────────┼─────────────────────────────┐
│                        APPLICATION LAYER                            │
│                                       │                             │
│                 ┌─────────────────────▼──────────────────┐          │
│                 │   ECS Fargate Task (Frontend)          │          │
│                 │   - SvelteKit SSR Application          │          │
│                 │   - Port: 3000                         │          │
│                 │   - Auto-scaling                       │          │
│                 └──────┬─────────────┬───────────────────┘          │
│                        │             │                              │
└────────────────────────┼─────────────┼──────────────────────────────┘
                         │             │
┌────────────────────────┼─────────────┼──────────────────────────────┐
│                   AUTHENTICATION LAYER                              │
│                        │             │                              │
│                 ┌──────▼─────────────▼──────────┐                   │
│                 │   AWS Cognito User Pool       │                   │
│                 │   - OAuth 2.0 / OpenID        │                   │
│                 │   - User management           │                   │
│                 └───────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┼─────────────────────────────────────────────┐
│                     DATA LAYER                                       │
│                        │                                             │
│    ┌───────────────────┼─────────────────────────────────────┐      │
│    │   S3 Buckets      │                                     │      │
│    │                   │                                     │      │
│    │  ┌────────────────▼───────────┐  ┌──────────────────┐  │      │
│    │  │  map-input (Uploads)       │  │  map-output      │  │      │
│    │  │  - ZIP files               │  │  - Processed     │  │      │
│    │  │  - Lifecycle: 90 days      │  │    results       │  │      │
│    │  └────┬───────────────────────┘  └──────────────────┘  │      │
│    └───────┼─────────────────────────────────────────────────┘      │
│            │                                                         │
│            │  S3 Event Trigger                                       │
│            │                                                         │
└────────────┼─────────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────────┐
│                       PROCESSING LAYER                               │
│                                                                       │
│    ┌──────────────────┐         ┌──────────────────┐                │
│    │ Lambda: Input    │         │ Lambda: Output   │                │
│    │ Handler          │────────>│ Handler          │                │
│    │ - Validates ZIP  │         │ - Processes      │                │
│    │ - Creates job    │         │   results        │                │
│    │ - Triggers ECS   │         │ - Updates status │                │
│    └──────────────────┘         └──────────────────┘                │
│            │                             │                           │
│            │                             │                           │
│    ┌───────▼─────────────────────────────▼────────┐                 │
│    │   ECS Fargate Task (Processor)               │                 │
│    │   - Heavy processing workload                │                 │
│    │   - On-demand scaling                        │                 │
│    └──────────────────────────────────────────────┘                 │
└───────────────────────────────────────────────────────────────────────┘
             │                             │
┌────────────┼─────────────────────────────┼─────────────────────────┐
│        DATABASE LAYER                    │                         │
│            │                             │                         │
│    ┌───────▼──────────────┐   ┌──────────▼───────────┐             │
│    │  DynamoDB:           │   │  DynamoDB:           │             │
│    │  maps                │   │  map-jobs            │             │
│    │  - Map metadata      │   │  - Job tracking      │             │
│    │  - Owner info        │   │  - Status updates    │             │
│    │  - S3 locations      │   │  - Batch info        │             │
│    └──────────────────────┘   └──────────────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Content Delivery Layer

#### **CloudFront CDN**
- **Purpose**: HTTPS termination, global content delivery, caching
- **Features**:
  - Automatic HTTPS with AWS-managed certificate
  - Global edge locations for low latency
  - Cache invalidation support
  - Origin failover capability
- **Cost**: ~$5-10/month (depends on traffic)

### 2. Application Layer

#### **ECS Fargate (Frontend)**
- **Purpose**: Runs the SvelteKit web application
- **Specifications**:
  - **CPU**: 256 vCPU (configurable)
  - **Memory**: 512 MB (configurable)
  - **Port**: 3000
  - **Auto-scaling**: Based on CPU/memory utilization
- **Features**:
  - Server-side rendering (SSR)
  - Session management
  - API endpoints for file upload
- **Cost**: ~$15-25/month

#### **ECR (Elastic Container Registry)**
- **Purpose**: Stores Docker images
- **Repositories**:
  - `mra-mines-dev-frontend`: Frontend application image
  - `mra-mines-processor`: Map processing image
- **Cost**: ~$1/month

### 3. Authentication Layer

#### **AWS Cognito**
- **Purpose**: User authentication and authorization
- **Features**:
  - OAuth 2.0 / OpenID Connect
  - Hosted UI for login
  - User pool management
  - MFA support (optional)
- **Configuration**:
  - Callback URLs: CloudFront domain
  - Password policy: Enforced complexity
  - Pre-authentication Lambda trigger
- **Cost**: Free tier covers up to 50,000 MAUs (Monthly Active Users)

### 4. Data Storage Layer

#### **S3 Buckets**

**Input Bucket** (`map-input`)
- **Purpose**: Stores uploaded ZIP files
- **Lifecycle**: Files deleted after 90 days (configurable)
- **Versioning**: Enabled for recovery
- **Events**: Triggers Lambda on new upload
- **Cost**: $0.023/GB-month + requests

**Output Bucket** (`map-output`)
- **Purpose**: Stores processed results
- **Lifecycle**: Retained longer (configurable)
- **Versioning**: Enabled
- **Events**: Triggers Lambda on completion
- **Cost**: $0.023/GB-month + requests

#### **DynamoDB Tables**

**maps Table**
- **Purpose**: Stores map metadata
- **Primary Key**: `mapId` (UUID)
- **Attributes**:
  - `mapName`: Original filename
  - `ownerEmail`: User who uploaded
  - `s3Input`: S3 location of uploaded ZIP
  - `s3Output`: S3 location of results
  - `jobId`: Reference to processing job
  - `createdAt`, `updatedAt`: Timestamps
- **Billing**: On-demand (pay per request)
- **Cost**: ~$1-5/month

**map-jobs Table**
- **Purpose**: Tracks processing jobs
- **Primary Key**: `jobId` (UUID)
- **Attributes**:
  - `batchId`: Groups related jobs
  - `batchSize`: Total files in batch
  - `processedCount`: Files processed
  - `status`: QUEUED, DISPATCHED, PROCESSING, COMPLETED, FAILED
  - `mapNames`: List of map filenames
  - `ownerEmail`: Job owner
  - `createdAt`, `updatedAt`: Timestamps
- **Billing**: On-demand
- **Cost**: ~$1-5/month

### 5. Processing Layer

#### **Lambda Functions**

**input-handler**
- **Trigger**: S3 PUT event on input bucket
- **Purpose**:
  - Validates uploaded ZIP file
  - Creates job entries in DynamoDB
  - Triggers ECS processor task
- **Timeout**: 60 seconds
- **Memory**: 512 MB
- **Cost**: Included in free tier for moderate use

**output-handler**
- **Trigger**: S3 PUT event on output bucket
- **Purpose**:
  - Updates job status to COMPLETED
  - Updates map metadata with output location
  - Sends notification (optional)
- **Timeout**: 30 seconds
- **Memory**: 256 MB
- **Cost**: Included in free tier

**s3-copy-processor**
- **Trigger**: Direct invocation
- **Purpose**: Copies files between buckets (utility function)
- **Timeout**: 120 seconds
- **Memory**: 512 MB

**mock-ecs (Development)**
- **Purpose**: Simulates ECS processing for testing
- **Note**: Not used in production

#### **ECS Fargate (Processor)**
- **Purpose**: Heavy map processing workload
- **Specifications**:
  - CPU: 1024 vCPU
  - Memory: 2048 MB
  - On-demand execution
- **Lifecycle**: Starts on-demand, terminates after completion
- **Cost**: Only pay for execution time

### 6. Networking Layer

#### **VPC (Virtual Private Cloud)**
- **CIDR**: `10.0.0.0/16`
- **Subnets**:
  - **Public Subnet A**: `10.0.1.0/24` (eu-west-1a)
  - **Public Subnet B**: `10.0.2.0/24` (eu-west-1b)
- **Internet Gateway**: Enables internet access
- **Route Tables**: Routes traffic to internet gateway

#### **Security Groups**

**Frontend ECS Security Group**
- Inbound: Port 3000 from 0.0.0.0/0 (via CloudFront)
- Outbound: All traffic (for DynamoDB, S3, Cognito access)

**Processor ECS Security Group**
- Inbound: None (no external access)
- Outbound: All traffic (for S3 access)

---

## Data Flow

### User Upload Flow

```
1. User visits CloudFront URL
   └─> CloudFront forwards to ECS Frontend
       └─> SvelteKit app renders login page

2. User logs in
   └─> Cognito authenticates user
       └─> Issues JWT token
           └─> Frontend stores session

3. User uploads ZIP file
   └─> Frontend generates presigned S3 URL
       └─> Browser uploads directly to S3
           └─> S3 triggers input-handler Lambda
               └─> Lambda validates file
                   └─> Creates job in DynamoDB
                       └─> Triggers ECS processor

4. ECS processor runs
   └─> Downloads ZIP from S3
       └─> Processes maps
           └─> Uploads results to output bucket
               └─> S3 triggers output-handler Lambda
                   └─> Updates job status to COMPLETED

5. User views results
   └─> Frontend queries DynamoDB
       └─> Shows completed jobs
           └─> Generates presigned URL for download
```

---

## Security Model

### 1. Network Security
- **Principle**: Defense in depth
- **Implementation**:
  - CloudFront provides DDoS protection
  - Security groups restrict access by port/IP
  - VPC isolates resources
  - S3 buckets block public access

### 2. Authentication & Authorization
- **User Authentication**: Cognito handles all auth
- **API Authorization**: JWT tokens validate requests
- **Resource Access**: IAM roles grant minimum required permissions

### 3. Data Protection
- **In Transit**: HTTPS/TLS encryption (CloudFront + S3)
- **At Rest**: S3 server-side encryption (AES-256)
- **DynamoDB**: Encryption enabled by default

### 4. IAM Roles

**Frontend Task Role**
- DynamoDB: Read/Write on maps and map-jobs tables
- S3: Read/Write on input and output buckets
- Cognito: Read user info

**Lambda Execution Roles**
- S3: Read from source buckets
- DynamoDB: Read/Write permissions
- ECS: Run task permission (input-handler only)
- Logs: Write to CloudWatch

**Processor Task Role**
- S3: Read from input, write to output
- Logs: Write to CloudWatch

---

## Scalability

### Horizontal Scaling
- **ECS Frontend**: Auto-scales based on CPU (1-10 tasks)
- **Lambda Functions**: Automatic concurrent execution
- **DynamoDB**: On-demand scaling
- **CloudFront**: Global distribution, no limit

### Vertical Scaling
- **ECS Tasks**: Configurable CPU/memory via variables
- **Lambda**: Configurable memory (128MB - 10GB)

### Cost vs Performance Trade-offs
| Configuration | Cost/Month | Use Case |
|---------------|-----------|----------|
| Minimal (256 CPU/512 MB) | $25-35 | Low traffic, few users |
| Standard (512 CPU/1024 MB) | $40-60 | Medium traffic, ~50 users |
| High (1024 CPU/2048 MB) | $80-120 | High traffic, 100+ users |

---

## Monitoring & Logging

### CloudWatch Logs
- **Frontend**: `/ecs/mra-mines-dev-frontend`
- **Processor**: `/ecs/mra-mines-processor`
- **Lambdas**: `/aws/lambda/<function-name>`
- **Retention**: 7 days (configurable)

### Metrics
- ECS: CPU/Memory utilization
- Lambda: Invocations, duration, errors
- CloudFront: Requests, cache hit rate
- DynamoDB: Read/write capacity, throttles

---

## Disaster Recovery

### Backups
- **DynamoDB**: Point-in-Time Recovery (optional, adds cost)
- **S3**: Versioning enabled
- **Terraform State**: Should be stored in S3 with versioning

### Recovery Time Objective (RTO)
- **Full redeployment**: 15-20 minutes
- **Data recovery**: Depends on S3 versioning

### Recovery Point Objective (RPO)
- **DynamoDB**: Up to 5 minutes (with PITR)
- **S3**: Real-time (versioning)

---

## Cost Breakdown

### Monthly Cost Estimate (Moderate Usage)

| Service | Cost |
|---------|------|
| ECS Fargate (Frontend) | $15-25 |
| CloudFront | $5-10 |
| DynamoDB | $2-10 |
| S3 Storage | $1-5 |
| Lambda | $0-5 |
| ECR | $1 |
| **Total** | **$25-56/month** |

### Cost Optimization Tips
1. Use CloudFront caching aggressively
2. Set S3 lifecycle policies to delete old files
3. Use DynamoDB on-demand pricing for variable load
4. Right-size ECS tasks (don't over-provision)
5. Clean up old ECR images regularly

---

## Future Enhancements

Potential improvements (not currently implemented):

1. **Custom Domain with SSL**: Use Route53 + ACM
2. **Multi-Region**: Deploy in multiple AWS regions
3. **Database Backups**: Enable DynamoDB PITR
4. **Enhanced Monitoring**: Add CloudWatch dashboards and alarms
5. **CI/CD Pipeline**: GitHub Actions for automated deployment
6. **API Gateway**: Rate limiting and API management
7. **SQS Queue**: Decouple processing jobs
8. **ElastiCache**: Redis for session management
9. **WAF**: Web Application Firewall for CloudFront

---

**Architecture documentation last updated:** 2025-11-06
