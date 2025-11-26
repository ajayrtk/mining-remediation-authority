# Main Terraform configuration for MRA Mines Map

terraform {
	required_version = ">= 1.6.0"

	required_providers {
		aws = {
			source  = "hashicorp/aws"
			version = "~> 5.73"
		}
		random = {
			source  = "hashicorp/random"
			version = "~> 3.6"
		}
	}
}

provider "aws" {
	region = var.aws_region
}

locals {
	# Tags applied to all resources
	tags = {
		Project     = var.project_name
		Environment = var.environment
		ManagedBy   = "Terraform"
	}
	cognito_region = coalesce(var.cognito_region, var.aws_region)
}

# Current AWS account info
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
