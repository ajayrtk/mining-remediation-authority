# MRA Mines Map - Documentation

Complete documentation for deploying and maintaining the MRA Mines Map application.

---

## 📖 Documentation Guide

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

### Day-to-Day Operations

3. **[Maintenance Guide](maintenance-guide.md)** - Operations and monitoring
   - Common operations
   - Monitoring and logging
   - Backup procedures
   - Performance tuning

### Problem Solving

4. **[Troubleshooting](troubleshooting.md)** - Common issues and solutions
   - IAM role conflicts
   - CloudFront issues
   - ECS deployment problems
   - Authentication errors
   - Cost optimization

### Advanced Configuration

5. **[IAM Configuration](iam-configuration.md)** - IAM role setup
   - Using existing IAM roles
   - Creating new roles
   - Role permissions
   - Best practices

### Production Deployment

6. **[Production Readiness](production-readiness.md)** - Production deployment checklist
   - Critical requirements
   - High availability setup
   - Security hardening
   - Monitoring and alerting
   - Cost estimates

### Change History

7. **[Changelog](changelog.md)** - Recent changes and updates
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

**For Operators:**
- Use [Maintenance Guide](maintenance-guide.md) for daily tasks
- Reference [Troubleshooting](troubleshooting.md) for problems
- Monitor using instructions in [Maintenance Guide](maintenance-guide.md)

**For Architects:**
- Review [Architecture](architecture.md) for system design
- Check [Production Readiness](production-readiness.md) for production planning
- See [IAM Configuration](iam-configuration.md) for security model

**For DevOps:**
- See [Production Readiness](production-readiness.md) for production setup
- Follow [Maintenance Guide](maintenance-guide.md) for operations
- Check [Changelog](changelog.md) for recent changes

### By Task

**Deploying for the first time:**
→ [Deployment Guide](deployment-guide.md)

**Something is broken:**
→ [Troubleshooting](troubleshooting.md)

**IAM role already exists:**
→ [IAM Configuration](iam-configuration.md)

**Planning production deployment:**
→ [Production Readiness](production-readiness.md)

**Understanding how it works:**
→ [Architecture](architecture.md)

**Day-to-day operations:**
→ [Maintenance Guide](maintenance-guide.md)

**What changed recently:**
→ [Changelog](changelog.md)

---

## Documentation Structure

```
deployment-package/
├── docs/                    ← You are here
│   ├── README.md            - This file (documentation index)
│   ├── deployment-guide.md  - Complete deployment walkthrough
│   ├── architecture.md      - System design
│   ├── maintenance-guide.md - Operations guide
│   ├── troubleshooting.md   - Problem solving
│   ├── iam-configuration.md - IAM setup
│   ├── production-readiness.md - Production checklist
│   └── changelog.md         - Recent changes
│
├── infra/                   - Terraform infrastructure code
│   ├── README.md            - Quick reference + links to docs/
│   ├── main.tf              - Provider configuration
│   ├── vpc.tf               - Networking
│   ├── ecs.tf               - Container orchestration
│   └── ...                  - Other infrastructure files
│
├── frontend/                - React application
├── backend/                 - Lambda functions
└── scripts/                 - Deployment scripts
```

---

## Getting Help

### Common Questions

**Q: Where do I start?**
A: Start with the [Deployment Guide](deployment-guide.md)

**Q: I'm getting an IAM role error**
A: See [IAM Configuration](iam-configuration.md) and [Troubleshooting](troubleshooting.md)

**Q: CloudFront shows "Something went wrong"**
A: See [Troubleshooting](troubleshooting.md) → "CloudFront Shows Something Went Wrong"

**Q: How do I update the frontend?**
A: See [Maintenance Guide](maintenance-guide.md) → "Update Frontend Application"

**Q: Is this production-ready?**
A: See [Production Readiness](production-readiness.md) for assessment

**Q: How much will this cost?**
A: See [Production Readiness](production-readiness.md) → "Cost Implications"

---

## Document Status

| Document | Status | Last Updated |
|----------|--------|--------------|
| Deployment Guide | ✅ Up-to-date | 2025-11-06 |
| Architecture | ✅ Current | 2025-11-14 |
| Maintenance Guide | ✅ Current | 2025-11-06 |
| Troubleshooting | ✅ Up-to-date | 2025-11-06 |
| IAM Configuration | ✅ Current | 2025-11-06 |
| Production Readiness | ✅ Current | 2025-11-06 |
| Changelog | ✅ Current | 2025-11-14 |

**Current Infrastructure:**
- Region: eu-west-2
- Terraform: >= 1.6.0
- AWS Provider: >= 5.0
- Features: IAM role reuse, conditional resources, auto-refresh UI, performance-optimized ECS
- ECS Processor: 8 vCPU / 16 GB RAM
- Frontend: Auto-refresh (10-second interval)

---

## Contributing

When updating documentation:
1. Update the relevant document in `docs/`
2. Update the "Last Updated" date
3. Add entry to [Changelog](changelog.md)
4. Test all commands and examples
5. Ensure links work correctly

---

**Documentation Version:** 2.1
**Last Updated:** 2025-11-14
