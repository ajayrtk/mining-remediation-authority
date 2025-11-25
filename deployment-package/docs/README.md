# MRA Mines Map - Documentation

Complete documentation for deploying and maintaining the MRA Mines Map application.

---

## Documentation Guide

### Getting Started

**Start here if you're new:**
1. **[Deployment Guide](deployment-guide.md)** - Complete step-by-step deployment walkthrough
   - Prerequisites and setup
   - Infrastructure deployment
   - User creation
   - Verification steps

### Understanding the System

2. **[Architecture](architecture.md)** - System design and components
   - Infrastructure overview
   - Component relationships
   - Data flow diagrams
   - Project structure

### Development

3. **[Developer Onboarding](developer-onboarding.md)** - Getting started with development
   - Local development setup
   - Code structure
   - Development workflow
   - Testing guidelines

### Day-to-Day Operations

4. **[Maintenance Guide](maintenance-guide.md)** - Operations and monitoring
   - Common operations
   - Monitoring and logging
   - Backup procedures
   - Performance tuning

### Problem Solving

5. **[Troubleshooting](troubleshooting.md)** - Common issues and solutions
   - IAM role conflicts
   - ECS deployment problems
   - Authentication errors
   - Processing failures

### Advanced Configuration

6. **[IAM Configuration](iam-configuration.md)** - IAM role setup
   - Using existing IAM roles
   - Creating new roles
   - Role permissions
   - Best practices

7. **[Custom Domain Setup](CUSTOM_DOMAIN_SETUP.md)** - Production HTTPS configuration
   - ACM certificate setup
   - Route53 DNS configuration
   - CloudFront integration

### Production Deployment

8. **[Production Readiness](production-readiness.md)** - Production deployment checklist
   - Critical requirements
   - High availability setup
   - Security hardening
   - Monitoring and alerting
   - Cost estimates

### Change History

9. **[Changelog](changelog.md)** - Recent changes and updates
   - Infrastructure changes
   - Bug fixes
   - New features
   - Migration notes

---

## Quick Navigation

### By Role

**For Deployers:**
- Start with [Deployment Guide](deployment-guide.md)
- Refer to [Troubleshooting](troubleshooting.md) if issues occur
- Check [IAM Configuration](iam-configuration.md) for IAM role setup

**For Developers:**
- Start with [Developer Onboarding](developer-onboarding.md)
- Review [Architecture](architecture.md) for system understanding
- Use [Troubleshooting](troubleshooting.md) for debugging

**For Operators:**
- Use [Maintenance Guide](maintenance-guide.md) for daily tasks
- Reference [Troubleshooting](troubleshooting.md) for problems
- Monitor using instructions in [Maintenance Guide](maintenance-guide.md)

**For Architects:**
- Review [Architecture](architecture.md) for system design
- Check [Production Readiness](production-readiness.md) for production planning
- See [IAM Configuration](iam-configuration.md) for security model

### By Task

**Deploying for the first time:**
> [Deployment Guide](deployment-guide.md)

**Setting up local development:**
> [Developer Onboarding](developer-onboarding.md)

**Something is broken:**
> [Troubleshooting](troubleshooting.md)

**IAM role already exists:**
> [IAM Configuration](iam-configuration.md)

**Planning production deployment:**
> [Production Readiness](production-readiness.md)

**Understanding how it works:**
> [Architecture](architecture.md)

**Day-to-day operations:**
> [Maintenance Guide](maintenance-guide.md)

**What changed recently:**
> [Changelog](changelog.md)

---

## Documentation Structure

```
deployment-package/
├── docs/                         <- You are here
│   ├── README.md                 - This file (documentation index)
│   ├── architecture.md           - System design & project structure
│   ├── developer-onboarding.md   - Development setup guide
│   ├── deployment-guide.md       - Complete deployment walkthrough
│   ├── maintenance-guide.md      - Operations guide
│   ├── troubleshooting.md        - Problem solving
│   ├── iam-configuration.md      - IAM setup
│   ├── production-readiness.md   - Production checklist
│   ├── CUSTOM_DOMAIN_SETUP.md    - Custom domain guide
│   ├── COST_OPTIMIZATION_10_USERS.md - Cost optimization
│   └── changelog.md              - Recent changes
│
├── frontend/                     - SvelteKit web application
│   ├── src/
│   │   ├── routes/              - Pages & API endpoints
│   │   └── lib/                 - Utilities & components
│   ├── Dockerfile
│   └── build_and_push.sh        - Deploy script
│
├── infra/                        - Terraform infrastructure
│   ├── lambda/                   - Lambda function code
│   │   ├── input_handler/       - S3 upload handler
│   │   ├── output_handler/      - Processing complete handler
│   │   ├── s3_copy_processor/   - S3 copy operations
│   │   └── pre_auth_trigger/    - Cognito validation
│   ├── *.tf                     - Terraform configuration files
│   └── variables.tf             - Configuration variables
│
├── scripts/                      - Deployment scripts
│
└── backend/                      - (Empty - serverless architecture)
```

**Note:** The `backend/` folder is intentionally empty. This application uses a serverless architecture where backend logic is handled by Lambda functions (in `infra/lambda/`) and ECS processor tasks.

---

## Getting Help

### Common Questions

**Q: Where do I start?**
A: Start with the [Deployment Guide](deployment-guide.md)

**Q: How do I set up local development?**
A: See [Developer Onboarding](developer-onboarding.md)

**Q: I'm getting an IAM role error**
A: See [IAM Configuration](iam-configuration.md) and [Troubleshooting](troubleshooting.md)

**Q: How do I update the frontend?**
A: See [Maintenance Guide](maintenance-guide.md) > "Update Frontend Application"

**Q: Is this production-ready?**
A: See [Production Readiness](production-readiness.md) for assessment

**Q: How much will this cost?**
A: See [Production Readiness](production-readiness.md) > "Cost Implications"

**Q: Why is the backend folder empty?**
A: The application uses serverless architecture. Backend logic is in Lambda functions (`infra/lambda/`) and ECS processor tasks.

---

## Document Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| Architecture | Updated | 2025-11-25 |
| Developer Onboarding | Updated | 2025-11-25 |
| Deployment Guide | Current | 2025-11-06 |
| Maintenance Guide | Current | 2025-11-06 |
| Troubleshooting | Current | 2025-11-06 |
| IAM Configuration | Current | 2025-11-06 |
| Production Readiness | Current | 2025-11-06 |
| Changelog | Current | 2025-11-23 |

**Current Infrastructure:**
- Region: eu-west-2
- Terraform: >= 1.6.0
- AWS Provider: >= 5.0
- Frontend: SvelteKit on ECS Fargate (0.25 vCPU, 512 MB)
- Processor: ECS Fargate (8 vCPU, 16 GB RAM)
- Auto-refresh: 10-second interval

---

## Contributing

When updating documentation:
1. Update the relevant document in `docs/`
2. Update the "Last Updated" date
3. Add entry to [Changelog](changelog.md)
4. Test all commands and examples
5. Ensure links work correctly

---

**Documentation Version:** 3.0
**Last Updated:** 2025-11-25
