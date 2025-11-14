# User authentication with AWS Cognito
resource "random_string" "cognito_domain_suffix" {
	length  = 4
	special = false
	upper   = false
}

locals {
	cognito_domain_prefix = var.cognito_domain_prefix != "" ? lower(var.cognito_domain_prefix) : format(
		"%s-%s",
		replace(lower(var.project_name), "[^a-z0-9]", "-"),
		random_string.cognito_domain_suffix.result
	)

	# Callback URLs - includes localhost, ALB DNS, and custom domain if enabled
	callback_urls = concat(
		[
			"http://localhost:5173/auth/callback",
			"https://${aws_lb.frontend.dns_name}/auth/callback"
		],
		var.enable_custom_domain ? [
			"https://www.${var.domain_name}/auth/callback",
			"https://${var.domain_name}/auth/callback"
		] : []
	)

	# Logout URLs - includes localhost, ALB DNS, and custom domain if enabled
	logout_urls = concat(
		[
			"http://localhost:5173/",
			"https://${aws_lb.frontend.dns_name}/"
		],
		var.enable_custom_domain ? [
			"https://www.${var.domain_name}/",
			"https://${var.domain_name}/"
		] : []
	)
}

resource "aws_cognito_user_pool" "main" {
	name = "${var.project_name}-users-pool-${var.environment}"

	alias_attributes         = ["email"]
	auto_verified_attributes = ["email"]
	username_configuration {
		case_sensitive = false
	}

	account_recovery_setting {
		recovery_mechanism {
			name     = "verified_email"
			priority = 1
		}
	}

	email_configuration {
		email_sending_account = "COGNITO_DEFAULT"
	}

	admin_create_user_config {
		allow_admin_create_user_only = false
	}

	password_policy {
		minimum_length    = 8
		require_lowercase = true
		require_numbers   = true
		require_symbols   = false
		require_uppercase = true
		temporary_password_validity_days = 7
	}

	# Pre-authentication Lambda trigger for domain validation
	dynamic "lambda_config" {
		for_each = var.use_existing_iam_roles ? [] : [1]
		content {
			pre_authentication = aws_lambda_function.pre_auth_trigger[0].arn
		}
	}
}

resource "aws_cognito_user_pool_domain" "main" {
	domain       = local.cognito_domain_prefix
	user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "web" {
	name                             = "${var.project_name}-web-${var.environment}"
	user_pool_id                     = aws_cognito_user_pool.main.id
	generate_secret                  = false
	allowed_oauth_flows_user_pool_client = true
	allowed_oauth_flows              = ["code"]
	allowed_oauth_scopes             = ["openid", "email", "profile"]
	callback_urls                    = local.callback_urls
	logout_urls                      = local.logout_urls
	supported_identity_providers     = ["COGNITO"]
	prevent_user_existence_errors    = "ENABLED"
	refresh_token_validity           = 30

	explicit_auth_flows = [
		"ALLOW_REFRESH_TOKEN_AUTH",
		"ALLOW_USER_SRP_AUTH",
		"ALLOW_USER_PASSWORD_AUTH"
	]
}
