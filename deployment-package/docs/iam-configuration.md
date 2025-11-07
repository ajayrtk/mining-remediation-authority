# Using Existing IAM Roles

This guide explains how to configure Terraform to skip creating IAM roles if they already exist in your AWS account.

## Overview

By default, Terraform will create all necessary IAM roles for the infrastructure. However, if you already have IAM roles created (from a previous deployment or manual setup), you can configure Terraform to use those existing roles instead of attempting to create new ones.

## Configuration

### 1. Using Default Behavior (Create New Roles)

By default, `use_existing_iam_roles` is set to `false`, which means Terraform will create all IAM roles:

```hcl
use_existing_iam_roles = false
```

This is the default behavior and requires no additional configuration.

### 2. Using Existing Roles

To use existing IAM roles, follow these steps:

#### Step 1: Set the flag to true

In your `terraform.tfvars` file:

```hcl
use_existing_iam_roles = true
```

#### Step 2: Specify existing role names

Provide the names of your existing IAM roles:

```hcl
existing_iam_role_names = {
  input_handler           = "mra-mines-input-handler"
  mock_ecs               = "mra-mines-mock-ecs"
  output_handler         = "mra-mines-output-handler"
  s3_copy_processor      = "mra-mines-s3-copy-processor"
  ecs_task_execution     = "mra-mines-ecs-task-execution"
  ecs_task               = "mra-mines-ecs-task"
  frontend_task_execution = "mra-mines-dev-frontend-task-execution"
  frontend_task          = "mra-mines-dev-frontend-task"
  pre_auth_trigger       = "mra-mines-pre-auth-trigger-role"
}
```

## IAM Roles Reference

The infrastructure uses the following IAM roles:

| Role Variable | Purpose | Default Name Pattern |
|--------------|---------|---------------------|
| `input_handler` | Lambda function that processes uploaded map files | `${project_name}-input-handler` |
| `mock_ecs` | Lambda function that mocks ECS tasks | `${project_name}-mock-ecs` |
| `output_handler` | Lambda function that handles output processing | `${project_name}-output-handler` |
| `s3_copy_processor` | Lambda function that copies files between S3 buckets | `${project_name}-s3-copy-processor` |
| `ecs_task_execution` | ECS task execution role (pulls container images) | `${project_name}-ecs-task-execution` |
| `ecs_task` | ECS task role (application permissions) | `${project_name}-ecs-task` |
| `frontend_task_execution` | Frontend ECS task execution role | `${project_name}-${environment}-frontend-task-execution` |
| `frontend_task` | Frontend ECS task role | `${project_name}-${environment}-frontend-task` |
| `pre_auth_trigger` | Cognito pre-authentication Lambda trigger | `${project_name}-pre-auth-trigger-role` |

## Finding Existing Role Names

To list existing IAM roles in your AWS account:

```bash
# List all roles
aws iam list-roles --query 'Roles[*].RoleName' --output table

# Filter by project name
aws iam list-roles --query "Roles[?contains(RoleName, 'mra-mines')].RoleName" --output table
```

## Required Permissions for Existing Roles

If you're using existing IAM roles, ensure they have the appropriate permissions. Refer to the following files to see the required policies:

- Lambda roles: `iam.tf` and `lambda_pre_auth.tf`
- ECS roles: `ecs.tf` and `frontend_ecs_simple.tf`

## Example Scenarios

### Scenario 1: All Roles Exist

If all IAM roles already exist in your account:

```hcl
use_existing_iam_roles = true

existing_iam_role_names = {
  input_handler           = "mra-mines-input-handler"
  mock_ecs               = "mra-mines-mock-ecs"
  output_handler         = "mra-mines-output-handler"
  s3_copy_processor      = "mra-mines-s3-copy-processor"
  ecs_task_execution     = "mra-mines-ecs-task-execution"
  ecs_task               = "mra-mines-ecs-task"
  frontend_task_execution = "mra-mines-dev-frontend-task-execution"
  frontend_task          = "mra-mines-dev-frontend-task"
  pre_auth_trigger       = "mra-mines-pre-auth-trigger-role"
}
```

### Scenario 2: Fresh Deployment (No Existing Roles)

For a fresh deployment where no roles exist:

```hcl
use_existing_iam_roles = false
```

Or simply omit this variable to use the default behavior.

## Verification

After applying the configuration, verify which roles are being used:

```bash
# Plan the changes
terraform plan

# Look for messages like:
# - "aws_iam_role.input_handler will be created" (creating new roles)
# - "data.aws_iam_role.existing_input_handler will be read" (using existing roles)
```

## Troubleshooting

### Error: Role Not Found

If you get an error like:

```
Error: error reading IAM Role (role-name): NoSuchEntity
```

This means the role name you specified doesn't exist. Double-check:
1. The role name is correct
2. The role exists in the correct AWS account/region
3. You have permissions to read IAM roles

### Solution

- Verify the role exists: `aws iam get-role --role-name <role-name>`
- Check the role name matches exactly (case-sensitive)
- Set `use_existing_iam_roles = false` to create new roles instead

## Migration Guide

### From Creating Roles to Using Existing Roles

1. Deploy once with `use_existing_iam_roles = false` to create all roles
2. Note down the created role names (check AWS Console or use `terraform state show`)
3. Update `terraform.tfvars` with `use_existing_iam_roles = true` and specify role names
4. Run `terraform plan` to verify no destructive changes
5. Run `terraform apply` to update the state

### From Using Existing Roles to Creating New Roles

**Warning**: This will attempt to create new roles, which may conflict if the names already exist.

1. Set `use_existing_iam_roles = false`
2. Either rename/delete existing roles or change `project_name` variable
3. Run `terraform apply`

## Best Practices

1. **Use existing roles when**: You have a multi-environment setup sharing IAM roles
2. **Create new roles when**: Each environment needs isolated IAM permissions
3. **Always verify**: Run `terraform plan` before applying changes
4. **Document role names**: Keep a record of which roles are used in each environment
