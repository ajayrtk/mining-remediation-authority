# IAM roles and policies for Lambda functions and ECS tasks

# Shared assume role policy for all Lambda functions
data "aws_iam_policy_document" "lambda_assume_role" {
	statement {
		effect = "Allow"

		actions = [
			"sts:AssumeRole"
		]

		principals {
			type        = "Service"
			identifiers = ["lambda.amazonaws.com"]
		}
	}
}

# Input handler Lambda role and permissions
resource "aws_iam_role" "input_handler" {
	count              = var.use_existing_iam_roles ? 0 : 1
	name               = "${var.project_name}-input-handler-${var.environment}"
	assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
	tags               = local.tags
}

resource "aws_iam_role_policy" "input_handler" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-input-handler-${var.environment}"
	role  = aws_iam_role.input_handler[0].id

	policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Effect   = "Allow"
				Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem"]
				Resource = [
					aws_dynamodb_table.map_jobs.arn,
					aws_dynamodb_table.maps.arn
				]
			},
			{
				Effect   = "Allow"
				Action   = ["s3:GetObject", "s3:HeadObject"]
				Resource = "${aws_s3_bucket.map_input.arn}/*"
			},
			{
				Effect   = "Allow"
				Action   = ["lambda:InvokeFunction"]
				Resource = [
					aws_lambda_function.s3_copy_processor.arn
				]
			},
			{
				Effect   = "Allow"
				Action   = ["ecs:RunTask"]
				Resource = aws_ecs_task_definition.processor.arn
			},
			{
				Effect   = "Allow"
				Action   = ["iam:PassRole"]
				Resource = [
					local.ecs_task_execution_role_arn,
					local.ecs_task_role_arn
				]
			}
		]
	})
}

# Output handler Lambda role and permissions
resource "aws_iam_role" "output_handler" {
	count              = var.use_existing_iam_roles ? 0 : 1
	name               = "${var.project_name}-output-handler-${var.environment}"
	assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
	tags               = local.tags
}

resource "aws_iam_role_policy" "output_handler" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-output-handler-${var.environment}"
	role  = aws_iam_role.output_handler[0].id

	policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Effect   = "Allow"
				Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:Query"]
				Resource = [
					aws_dynamodb_table.map_jobs.arn,
					"${aws_dynamodb_table.map_jobs.arn}/index/*",
					aws_dynamodb_table.maps.arn,
					"${aws_dynamodb_table.maps.arn}/index/*"
				]
			},
			{
				Effect   = "Allow"
				Action   = ["s3:GetObject", "s3:HeadObject"]
				Resource = "${aws_s3_bucket.map_outputs.arn}/*"
			}
		]
	})
}

# S3 copy processor Lambda role and permissions
resource "aws_iam_role" "s3_copy_processor" {
	count              = var.use_existing_iam_roles ? 0 : 1
	name               = "${var.project_name}-s3-copy-processor-${var.environment}"
	assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
	tags               = local.tags
}

resource "aws_iam_role_policy" "s3_copy_processor" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-s3-copy-processor-${var.environment}"
	role  = aws_iam_role.s3_copy_processor[0].id

	policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Effect   = "Allow"
				Action   = ["dynamodb:UpdateItem", "dynamodb:PutItem", "dynamodb:GetItem"]
				Resource = [
					aws_dynamodb_table.map_jobs.arn,
					aws_dynamodb_table.maps.arn
				]
			},
			{
				Effect   = "Allow"
				Action   = ["s3:GetObject", "s3:GetObjectTagging", "s3:HeadObject"]
				Resource = "${aws_s3_bucket.map_input.arn}/*"
			},
			{
				Effect   = "Allow"
				Action   = [
					"s3:PutObject",
					"s3:PutObjectTagging"
				]
				Resource = "${aws_s3_bucket.map_outputs.arn}/*"
			}
		]
	})
}
