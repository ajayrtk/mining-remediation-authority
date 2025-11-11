# MRA Mines Map - System Architecture

## Overview

The MRA Mines Map application is a cloud-native web application deployed on AWS, designed for processing and visualizing mining map data. The system uses a serverless and container-based architecture for scalability, cost-efficiency, and ease of maintenance.

**Last Updated:** 2025-11-11
**Architecture Version:** 2.0 (ALB-Direct)
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
│  • Container: Python map processing script                 │
│  • Resources: Configurable based on workload               │
└────────────────────────────────────────────────────────────┘
```

---

## Quick Summary

**Current Configuration:**
- **Entry Point:** Application Load Balancer (HTTPS + HTTP redirect)
- **Frontend:** ECS Fargate (1 task, 0.25 vCPU, 512 MB)
- **Authentication:** AWS Cognito (OAuth 2.0)
- **Database:** DynamoDB (2 tables, on-demand)
- **Storage:** S3 (2 buckets with lifecycle rules)
- **Processing:** Lambda + ECS Fargate (on-demand)
- **Monthly Cost:** ~$30-50

**Key Features:**
- HTTPS with self-signed certificate
- Auto-healing via ALB health checks
- OAuth 2.0 authentication
- Event-driven processing
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

**Document Version:** 2.0
**Last Updated:** 2025-11-11  
**Maintained By:** MRA Mines DevOps Team
