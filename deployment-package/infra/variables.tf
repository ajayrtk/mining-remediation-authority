variable "aws_region" {
	type        = string
	description = "AWS region for all resources"
	default     = "eu-west-1"
}

variable "project_name" {
	type        = string
	description = "Friendly project name used for tagging"
	default     = "mra-mines"
}

variable "environment" {
	type        = string
	description = "Environment name (dev, staging, prod)"
	default     = "dev"

	validation {
		condition     = contains(["dev", "staging", "prod"], var.environment)
		error_message = "Environment must be dev, staging, or prod."
	}
}

variable "map_input_bucket_name" {
	type        = string
	description = "S3 bucket name for incoming ZIP archives (must be globally unique)"
	default     = "map-input"
}

variable "map_output_bucket_name" {
	type        = string
	description = "S3 bucket name for ML job outputs (must be globally unique)"
	default     = "map-output"
}

variable "maps_table_name" {
	type        = string
	description = "DynamoDB table name for MAPS metadata"
	default     = "maps"
}

variable "map_jobs_table_name" {
	type        = string
	description = "DynamoDB table name for MAPJOBS processing records"
	default     = "maps-job"
}

variable "ses_sender_email" {
	type        = string
	description = "Email identity used by SES for job notifications (must be verified in SES for production)"
	default     = "no-reply@example.com"
}

variable "cognito_region" {
	type        = string
	description = "AWS region where the Cognito User Pool lives (defaults to aws_region when unset)"
	default     = null
}

variable "cognito_domain_prefix" {
	type        = string
	description = "Optional custom prefix for the Cognito hosted UI domain (must be globally unique per region)"
	default     = ""
}

variable "cognito_callback_urls" {
	type        = list(string)
	description = "Allowed OAuth callback URLs for the Cognito app client"
	default     = [
		"http://localhost:5173/auth/callback",
		"https://d3n47138ce9sz5.cloudfront.net/auth/callback"
	]
}

variable "cognito_logout_urls" {
	type        = list(string)
	description = "Allowed sign-out URLs for the Cognito app client"
	default     = [
		"http://localhost:5173/",
		"https://d3n47138ce9sz5.cloudfront.net/"
	]
}

variable "frontend_origin_domain" {
	type        = string
	description = "CloudFront origin domain (ECS task public DNS)"
	default     = ""
}

variable "use_existing_iam_roles" {
	type        = bool
	description = "If true, use existing IAM roles instead of creating new ones"
	default     = false
}

variable "existing_iam_role_names" {
	type = object({
		input_handler           = optional(string)
		mock_ecs               = optional(string)
		output_handler         = optional(string)
		s3_copy_processor      = optional(string)
		ecs_task_execution     = optional(string)
		ecs_task               = optional(string)
		frontend_task_execution = optional(string)
		frontend_task          = optional(string)
		pre_auth_trigger       = optional(string)
	})
	description = "Names of existing IAM roles to use when use_existing_iam_roles is true"
	default = {
		input_handler           = null
		mock_ecs               = null
		output_handler         = null
		s3_copy_processor      = null
		ecs_task_execution     = null
		ecs_task               = null
		frontend_task_execution = null
		frontend_task          = null
		pre_auth_trigger       = null
	}
}

variable "admin_email" {
	type        = string
	description = "Email address for the default admin user (used by deploy script)"
	default     = "admin@example.com"
}

variable "admin_username" {
	type        = string
	description = "Username for the default admin user (used by deploy script)"
	default     = "admin"
}

variable "admin_password" {
	type        = string
	description = "Password for the default admin user (used by deploy script, change after first login!)"
	sensitive   = true
	default     = "ChangeMe123!"
}
