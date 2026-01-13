# Deployment Package - Complete Contents

## 📦 Package Information

**Package Name**: MRA Mines Map - Complete Deployment Package
**Version**: 2.0.0
**Release Date**: January 2025
**Components**: 2 Repositories + Documentation

---

## 🗂️ Repository 1: deployment-package/

### Root Level Files

| File | Type | Purpose |
|------|------|---------|
| `README.md` | Documentation | Main overview and navigation |
| `.env.example` | Template | AWS credentials & configuration template |
| `.gitignore` | Security | Protects sensitive files from version control |

### scripts/ - Deployment Automation

| File | Type | Purpose | Usage |
|------|------|---------|-------|
| `setup.sh` | Bash Script | Check prerequisites (AWS CLI, Terraform, Docker, Node.js) | `./scripts/setup.sh` |
| `configure_aws.sh` | Bash Script | Validate AWS credentials from .env | `./scripts/configure_aws.sh` |
| `deploy.sh` | Bash Script | **MAIN DEPLOYMENT** - Deploys everything | `./scripts/deploy.sh` |
| `cleanup.sh` | Bash Script | Remove all AWS resources | `./scripts/cleanup.sh` |

**Script Flow**:
```
setup.sh → User configures .env → deploy.sh → Application running
                                      ↓
                                 configure_aws.sh (automatic)
```

### infra/ - Infrastructure as Code (Terraform)

#### Terraform Configuration Files

| File | Purpose |
|------|---------|
| `main.tf` | Provider configuration (AWS, Terraform) |
| `variables.tf` | Input variable definitions |
| `outputs.tf` | Output values (URLs, IDs) |
| `terraform.tfvars.example` | Configuration template |
| `terraform.tfvars` | **Client creates** - Actual configuration |

#### Infrastructure Modules

| File | Creates |
|------|---------|
| `vpc.tf` | VPC, subnets, internet gateway, route tables |
| `alb.tf` | Application Load Balancer, HTTPS listener |
| `ecs.tf` | ECS cluster, processor task definition, ECR |
| `frontend_ecs_simple.tf` | Frontend ECS service, task definition |
| `ecs_events.tf` | ECS CloudWatch event rules |
| `s3.tf` | S3 buckets (input/output), lifecycle policies |
| `dynamodb.tf` | DynamoDB tables (maps, jobs), GSIs |
| `cognito.tf` | Cognito User Pool, OAuth configuration |
| `cognito_identity.tf` | Cognito Identity Pool |
| `lambda.tf` | Lambda functions (input/output handlers) |
| `ecs_state_handler.tf` | ECS state monitoring Lambda |
| `iam.tf` | IAM roles and policies |
| `iam_data.tf` | IAM policy documents |
| `acm.tf` | ACM SSL certificates (custom domain) |
| `route53.tf` | Route53 DNS (custom domain) |
| `webhooks.tf` | Webhook configurations |

**Total AWS Resources Created**: ~55-60

#### infra/lambda/ - Lambda Function Source Code

| Directory | Function | Trigger |
|-----------|----------|---------|
| `input_handler/` | Process S3 uploads, launch ECS tasks | S3 PutObject (input bucket) |
| `output_handler/` | Handle processed results, update DynamoDB | S3 PutObject (output bucket) |
| `s3_copy_processor/` | Copy files between buckets | Manual/scheduled |
| `ecs_state_handler/` | Monitor ECS task lifecycle | CloudWatch Events |
| `pre_auth_trigger/` | Cognito pre-authentication | Cognito trigger |

### frontend/ - Web Application (SvelteKit)

#### Frontend Root Files

| File | Purpose |
|------|---------|
| `package.json` | Node.js dependencies and scripts |
| `svelte.config.js` | SvelteKit configuration |
| `tsconfig.json` | TypeScript configuration |
| `vite.config.ts` | Vite build tool configuration |
| `Dockerfile` | Multi-stage container build |
| `build_and_push.sh` | Build and deploy to ECR |
| `validate_map.py` | Python map validation script |

#### frontend/src/ - Application Source

| Directory | Contents |
|-----------|----------|
| `routes/` | SvelteKit pages and API endpoints |
| `routes/+page.svelte` | Landing/upload page (2,142 lines) |
| `routes/maps/` | Map management dashboard |
| `routes/auth/` | Authentication routes (login, callback, logout) |
| `routes/api/` | 8+ API endpoints |
| `lib/server/` | Server-side utilities (S3, DynamoDB, Cognito) |
| `lib/components/` | Reusable Svelte components |
| `lib/stores/` | Client-side state management |
| `lib/styles/` | CSS and styling |
| `lib/utils/` | Client utilities |
| `hooks.server.ts` | SvelteKit server hooks |

**Key API Endpoints** (`routes/api/`):
- `presigned-url/` - Generate S3 upload URLs
- `validate-map/` - Server-side georeferencing validation
- `download-url/` - Generate download URLs
- `bulk-download/` - Multi-file download
- `delete-map/` - Remove map data
- `retry-map/` - Retry failed processing
- `batch-operations/` - Batch actions
- `webhooks/` - Webhook management

### docs/ - Detailed Documentation

| File | Contents | Pages |
|------|----------|-------|
| `CLIENT_DEPLOYMENT_GUIDE.md` | **START HERE** - Complete step-by-step client guide | ~839 lines |
| `DEPLOYMENT_QUICKSTART.md` | Quick reference for experienced users | ~236 lines |
| `PACKAGE_CONTENTS.md` | This file - Complete package inventory | ~459 lines |
| `architecture.md` | System architecture, design patterns, data flow | ~1,058 lines |
| `deployment-guide.md` | Alternative deployment guide | ~190 lines |
| `troubleshooting.md` | Common issues and solutions | ~546 lines |
| `client-qa-response.md` | Client Q&A document | ~1,000+ lines |

---

## 🗂️ Repository 2: mra-mine-plans-ds/

**Note**: This is a separate repository that must be deployed alongside deployment-package.

### Root Level Files

| File | Purpose |
|------|---------|
| `README.md` | Processor documentation |
| `Dockerfile` | Processor container (Python 3.11, ML/CV) |
| `Dockerfile.optimized` | Optimized build variant |
| `requirements.txt` | Python dependencies |
| `aws_processor.py` | Main processing script |
| `build_and_push.sh` | Build and deploy processor to ECR |
| `.gitlab-ci.yml` | GitLab CI pipeline (if using GitLab) |

### Python Dependencies

**Core Libraries**:
- Python 3.11
- OpenCV 4.10+ (image processing)
- EasyOCR 1.7+ (text extraction)
- PyTorch (CPU-only, ML inference)
- geopandas, rasterio, shapely, pyproj (geospatial)
- boto3 (AWS SDK)

### mramineplanextraction/ - Processing Engine

| Component | Purpose |
|-----------|---------|
| OCR module | Extract text from maps using EasyOCR |
| Image processing | Normalize, enhance, detect features |
| Geospatial | Transform coordinates, create GeoPackage |
| Validation | Verify georeferencing and output |

**Container Size**: ~2.5-3GB (includes ML models)

---

## 📋 Configuration Files (Client Must Create)

### 1. .env (from .env.example)

**Location**: `deployment-package/.env`

**Required Fields**:
```bash
AWS_ACCESS_KEY_ID=          # From AWS IAM
AWS_SECRET_ACCESS_KEY=      # From AWS IAM
AWS_DEFAULT_REGION=eu-west-2
PROCESSOR_REPO_PATH=        # Absolute path to mra-mine-plans-ds
```

**Security**:
- ✅ In `.gitignore` (safe)
- ❌ Never commit to version control
- ❌ Never share publicly

### 2. terraform.tfvars (from terraform.tfvars.example)

**Location**: `deployment-package/infra/terraform.tfvars`

**Required Fields**:
```hcl
aws_region    = "eu-west-2"
project_name  = "mra-mines"
environment   = "prod"
use_existing_iam_roles = false
admin_username = "admin"
admin_email    = "admin@company.com"
admin_password = "SecurePassword123!"
enable_custom_domain = true
domain_name    = "mine-maps.company.com"
```

**Security**:
- ⚠️ Contains admin password
- ✅ In `.gitignore`
- Change password after first login

---

## 🔒 Security & Sensitive Files

### Protected by .gitignore

These files are **automatically excluded** from version control:

**Configuration** (Contains secrets):
- `.env`
- `infra/terraform.tfvars`

**State Files** (May contain sensitive data):
- `infra/terraform.tfstate`
- `infra/terraform.tfstate.backup`
- `infra/.terraform/`

**Build Artifacts**:
- `frontend/build/`
- `frontend/node_modules/`
- `frontend/.svelte-kit/`

**Logs**:
- `*.log`
- `npm-debug.log*`

### Public/Safe Files

These files are **safe to version control**:
- All `.example` files
- All `.md` documentation files
- All `.tf` Terraform files
- All source code (`.js`, `.ts`, `.svelte`, `.py`)
- All scripts (`.sh`)

---

## 📊 File Statistics

### Total Files by Type

| Type | Count | Purpose |
|------|-------|---------|
| Documentation (.md) | 7 | Guides and references |
| Scripts (.sh) | 5 | Automation |
| Terraform (.tf) | 15+ | Infrastructure definition |
| TypeScript/JavaScript | 100+ | Frontend application |
| Python (.py) | 20+ | ML/CV processing |
| Configuration | 5 | Templates and settings |

### Total Lines of Code

| Component | Lines of Code |
|-----------|---------------|
| Frontend (TypeScript/Svelte) | ~10,000+ |
| Infrastructure (Terraform) | ~3,000+ |
| Processor (Python) | ~5,000+ |
| Lambda Functions (Python) | ~2,000+ |
| Scripts (Bash) | ~500+ |
| Documentation (Markdown) | ~5,000+ |
| **Total** | **~25,500+** |

---

## 🎯 Deployment Outputs

### What Gets Created in AWS

**Compute**:
- 1 ECS Cluster
- 2 ECS Task Definitions (frontend, processor)
- 1 ECS Service (frontend - always running)
- 5 Lambda Functions

**Storage**:
- 2 S3 Buckets (input, output)
- 2 DynamoDB Tables (maps, jobs)
- 2 ECR Repositories (frontend, processor)

**Network**:
- 1 VPC
- 2 Subnets (public)
- 1 Internet Gateway
- 2 Route Tables
- 5+ Security Groups
- 1 Application Load Balancer

**Security & Auth**:
- 1 Cognito User Pool
- 1 Cognito Identity Pool
- 10+ IAM Roles
- 20+ IAM Policies

**DNS & Certificates** (if custom domain):
- 1 Route53 Hosted Zone
- 1 ACM Certificate

**Total**: ~55-60 AWS Resources

### Generated Credentials

**Admin User** (Cognito):
- Username: From terraform.tfvars
- Email: From terraform.tfvars
- Password: From terraform.tfvars (change immediately!)

**Application URL**:
- Without custom domain: `https://alb-*.elb.amazonaws.com`
- With custom domain: `https://your-domain.com`

---

## 🔄 Deployment Lifecycle

### Creation (First Deployment)

```
1. Configure .env & terraform.tfvars
2. Run ./scripts/deploy.sh
3. Wait 15-25 minutes
4. Access application URL
5. Login and change password
```

### Updates

**Frontend code changes**:
```bash
cd frontend
# Make changes
npm run build
./build_and_push.sh
```

**Infrastructure changes**:
```bash
cd infra
# Edit .tf files
terraform plan
terraform apply
```

**Processor code changes**:
```bash
cd ../mra-mine-plans-ds
# Make changes
./build_and_push.sh
```

### Destruction

```bash
./scripts/cleanup.sh
# Type: DELETE
# Type: YES I AM SURE
```

**Warning**: Deletes all resources and data!

---

## 📞 Support Resources

### Self-Service Diagnostics

```bash
# Check prerequisites
./scripts/setup.sh

# Test AWS credentials
./scripts/configure_aws.sh

# View infrastructure status
cd infra && terraform output

# Check ECS health
aws ecs describe-services --cluster <cluster> --services <service>

# View logs
aws logs tail /ecs/mra-mines-frontend-prod --follow
```

### Documentation Quick Reference

| Issue | Document to Check |
|-------|-------------------|
| First-time deployment | docs/CLIENT_DEPLOYMENT_GUIDE.md |
| AWS credential errors | docs/CLIENT_DEPLOYMENT_GUIDE.md (Step 2) |
| Quick reference | docs/DEPLOYMENT_QUICKSTART.md |
| Understanding system | docs/architecture.md |
| Specific errors | docs/troubleshooting.md |
| Package contents | docs/PACKAGE_CONTENTS.md (this file) |

---

## ✅ Pre-Deployment Checklist

Use this before starting deployment:

- [ ] **Both repositories extracted**
  - [ ] deployment-package/
  - [ ] mra-mine-plans-ds/

- [ ] **Prerequisites installed**
  - [ ] AWS CLI v2.0+ (`aws --version`)
  - [ ] Terraform v1.6.0+ (`terraform --version`)
  - [ ] Docker v20.0+ (`docker --version`)
  - [ ] Node.js v20.0+ (`node --version`)

- [ ] **AWS credentials obtained**
  - [ ] IAM user created
  - [ ] Access keys generated
  - [ ] Keys saved securely

- [ ] **Configuration files created**
  - [ ] .env created from .env.example
  - [ ] AWS credentials added to .env
  - [ ] Processor path added to .env
  - [ ] terraform.tfvars created
  - [ ] All required fields filled

- [ ] **Documentation reviewed**
  - [ ] Read CLIENT_DEPLOYMENT_GUIDE.md
  - [ ] Understand deployment process
  - [ ] Know where to find help

---

## 📦 Package Summary

**Total Size**: ~500MB (with node_modules)
**Deployment Time**: 15-25 minutes
**Monthly Cost**: $50-100 (AWS)
**Supported Regions**: All AWS regions
**Tested On**: AWS CLI 2.x, Terraform 1.6.x, Node.js 20.x

**Last Updated**: January 2025
**Package Version**: 2.0.0

---

**Ready to deploy? Start with `docs/CLIENT_DEPLOYMENT_GUIDE.md`!**
