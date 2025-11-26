# Architecture

## System Overview

```
User --> ALB (HTTPS) --> ECS Fargate (Frontend)
                              |
                          Cognito (Auth)
                              |
                S3 <--> Lambda <--> DynamoDB
                              |
                      ECS Fargate (Processor)
```

## Components

### Frontend (ECS Fargate)
- **Technology**: SvelteKit with Node.js adapter
- **Port**: 3000
- **Resources**: 512 CPU, 1024 MB memory
- **Features**: File upload, job tracking, user authentication

### Load Balancer (ALB)
- **Type**: Application Load Balancer
- **Protocol**: HTTPS (self-signed certificate)
- **Health Check**: `/` endpoint

### Authentication (Cognito)
- **Flow**: OAuth 2.0 with PKCE
- **Hosted UI**: Custom domain prefix
- **Callbacks**: ALB DNS-based URLs

### Storage

| Service | Purpose |
|---------|---------|
| S3 Input Bucket | Uploaded ZIP files |
| S3 Output Bucket | Processed results |
| DynamoDB Maps Table | Map metadata |
| DynamoDB Jobs Table | Job tracking |
| DynamoDB Webhooks Table | Webhook configurations |

### Lambda Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| input_handler | S3 PutObject | Starts ECS processor task |
| output_handler | S3 PutObject | Updates job status |
| ecs_state_handler | ECS state change | Tracks task lifecycle |
| s3_copy_processor | Manual | Copies files between buckets |
| pre_auth_trigger | Cognito | Pre-authentication validation |

### Networking
- **VPC**: Custom VPC with 2 public subnets
- **Availability Zones**: 2 AZs for high availability
- **Security Groups**: ALB, ECS tasks with least-privilege rules

## Data Flow

### Upload Flow
1. User authenticates via Cognito
2. Frontend requests presigned URL from server
3. Client uploads directly to S3 (bypasses server)
4. S3 event triggers input_handler Lambda
5. Lambda starts ECS processor task
6. Processor outputs to S3 output bucket
7. output_handler updates DynamoDB
8. Frontend polls for status updates

### Authentication Flow
1. User clicks login
2. Redirect to Cognito Hosted UI
3. User authenticates
4. Cognito redirects with authorization code
5. Server exchanges code for tokens
6. Session created with secure cookies

## Resource Naming

All resources follow the pattern:
```
{project_name}-{resource}-{environment}
```

Example: `mra-mines-frontend-staging`

## Security

- All traffic over HTTPS
- Cognito handles authentication
- IAM roles with least-privilege
- S3 buckets are private
- Presigned URLs expire in 1 hour
- Session cookies are httpOnly and secure

## Optional: Custom Domain

When `enable_custom_domain = true` in terraform.tfvars:

| Component | Purpose |
|-----------|---------|
| ACM | SSL/TLS certificate (free, auto-renewed) |
| Route53 | DNS hosted zone with A records |
| ALB | Uses ACM certificate instead of self-signed |

Configuration:
```hcl
enable_custom_domain = true
domain_name = "mine-maps.com"
```
