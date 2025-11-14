# Pre-authentication Lambda trigger for Cognito - validates user email domain

# Package Lambda function code
data "archive_file" "pre_auth_trigger" {
	type        = "zip"
	source_dir  = "${path.module}/lambda/pre_auth_trigger"
	output_path = "${path.module}/.terraform/lambda_packages/pre_auth_trigger.zip"
}

# Lambda execution role
resource "aws_iam_role" "pre_auth_trigger" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-pre-auth-trigger-role-${var.environment}"

	assume_role_policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Action = "sts:AssumeRole"
				Effect = "Allow"
				Principal = {
					Service = "lambda.amazonaws.com"
				}
			}
		]
	})

	tags = local.tags
}

# Lambda function
resource "aws_lambda_function" "pre_auth_trigger" {
	count            = var.use_existing_iam_roles ? 0 : 1
	filename         = data.archive_file.pre_auth_trigger.output_path
	function_name    = "${var.project_name}-pre-auth-trigger-${var.environment}"
	role             = local.pre_auth_trigger_role_arn
	handler          = "index.handler"
	source_code_hash = data.archive_file.pre_auth_trigger.output_base64sha256
	runtime          = "nodejs20.x"
	timeout          = 10

	environment {
		variables = {
			ALLOWED_DOMAIN = "stfc.ac.uk"
		}
	}

	tags = local.tags
}

# Permission for Cognito to invoke Lambda
resource "aws_lambda_permission" "allow_cognito_pre_auth" {
	count         = var.use_existing_iam_roles ? 0 : 1
	statement_id  = "AllowExecutionFromCognito"
	action        = "lambda:InvokeFunction"
	function_name = aws_lambda_function.pre_auth_trigger[0].function_name
	principal     = "cognito-idp.amazonaws.com"
	source_arn    = aws_cognito_user_pool.main.arn
}
