# Output values for MRA Mines infrastructure

output "aws_region" {
	value       = var.aws_region
	description = "AWS region where resources are deployed"
}

output "map_input_bucket_name" {
	value       = aws_s3_bucket.map_input.bucket
	description = "Input bucket receiving uploaded ZIP archives"
}

output "map_output_bucket_name" {
	value       = aws_s3_bucket.map_outputs.bucket
	description = "Output bucket containing processed job artifacts"
}

output "map_jobs_table_name" {
	value       = aws_dynamodb_table.map_jobs.name
	description = "Primary DynamoDB table tracking job state"
}

output "maps_table_name" {
	value       = aws_dynamodb_table.maps.name
	description = "DynamoDB table storing map metadata"
}

output "cognito_user_pool_id" {
	value       = aws_cognito_user_pool.main.id
	description = "ID of the Cognito User Pool created for the web console"
}

output "cognito_user_pool_client_id" {
	value       = aws_cognito_user_pool_client.web.id
	description = "App client ID used by the web console"
}

output "cognito_domain" {
	value       = "${aws_cognito_user_pool_domain.main.domain}.auth.${local.cognito_region}.amazoncognito.com"
	description = "Hosted UI domain for the Cognito User Pool"
}

output "frontend_env_block" {
	description = "Copy/paste-ready environment variables for the Svelte front-end"
	value = <<EOT
AWS_REGION=${var.aws_region}
MAP_INPUT_BUCKET=${aws_s3_bucket.map_input.bucket}
MAP_JOBS_TABLE=${aws_dynamodb_table.map_jobs.name}
MAPS_TABLE=${aws_dynamodb_table.maps.name}
COGNITO_REGION=${local.cognito_region}
COGNITO_USER_POOL_ID=${aws_cognito_user_pool.main.id}
COGNITO_CLIENT_ID=${aws_cognito_user_pool_client.web.id}
COGNITO_IDENTITY_POOL_ID=${aws_cognito_identity_pool.main.id}
COGNITO_DOMAIN=${aws_cognito_user_pool_domain.main.domain}.auth.${local.cognito_region}.amazoncognito.com
SES_SENDER_EMAIL=${var.ses_sender_email}
EOT
}


output "input_handler_lambda_arn" {
	value       = aws_lambda_function.input_handler.arn
	description = "ARN of the Lambda function triggered by uploads into map-input"
}

output "output_handler_lambda_arn" {
	value       = aws_lambda_function.output_handler.arn
	description = "ARN of the Lambda function triggered by processed artifacts"
}

output "ecs_cluster_name" {
	value       = aws_ecs_cluster.main.name
	description = "Name of the ECS cluster for map processing"
}

output "ecs_task_definition" {
	value       = aws_ecs_task_definition.processor.family
	description = "Family name of the ECS task definition"
}

output "ecr_repository_url" {
	value       = aws_ecr_repository.processor.repository_url
	description = "URL of the ECR repository for the processor image"
}

output "vpc_id" {
	value       = aws_vpc.main.id
	description = "VPC ID for ECS tasks"
}

output "public_subnet_ids" {
	value       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
	description = "Public subnet IDs for ECS tasks"
}

# Main application URL
output "application_url" {
	value       = var.enable_custom_domain ? "https://www.${var.domain_name}" : "https://${aws_lb.frontend.dns_name}"
	description = "Main application URL (HTTPS)"
}

output "project_name" {
	value       = var.project_name
	description = "Project name used in resource naming"
}

output "environment" {
	value       = var.environment
	description = "Environment name used in resource naming"
}

# Custom Domain Outputs (only when custom domain is enabled)
output "custom_domain_enabled" {
	value       = var.enable_custom_domain
	description = "Whether custom domain is enabled"
}

output "route53_name_servers" {
	value       = var.enable_custom_domain ? aws_route53_zone.main[0].name_servers : []
	description = "Route 53 name servers - Update these at your domain registrar"
}

output "custom_domain_url" {
	value       = var.enable_custom_domain ? "https://www.${var.domain_name}" : "Custom domain not enabled"
	description = "Custom domain URL (when enabled)"
}

output "acm_certificate_arn" {
	value       = var.enable_custom_domain ? aws_acm_certificate.main[0].arn : "Custom domain not enabled"
	description = "ACM certificate ARN (when custom domain is enabled)"
}

output "custom_domain_setup_instructions" {
	value = var.enable_custom_domain ? join("\n", [
		"Custom Domain Setup:",
		"",
		"1. Update name servers at your domain registrar to:",
		join("\n   ", aws_route53_zone.main[0].name_servers),
		"",
		"2. Wait for DNS propagation (5 min - 48 hours)",
		"   Check: dig ${var.domain_name} NS",
		"",
		"3. Access: https://www.${var.domain_name}",
		"   ALB fallback: https://${aws_lb.frontend.dns_name}"
	]) : "Custom domain not enabled"
	description = "Custom domain setup instructions"
}
