# Lambda functions for processing map uploads

data "archive_file" "input_handler" {
	type        = "zip"
	source_dir  = "${path.module}/lambda/input_handler"
	output_path = "${path.module}/build/input_handler.zip"
}

resource "aws_lambda_function" "input_handler" {
	function_name = "${var.project_name}-input-handler-${var.environment}"
	runtime       = "python3.11"
	handler       = "handler.lambda_handler"
	role          = local.input_handler_role_arn
	source_code_hash = data.archive_file.input_handler.output_base64sha256
	filename         = data.archive_file.input_handler.output_path
	timeout          = 300
	environment {
		variables = {
			JOBS_TABLE_NAME = aws_dynamodb_table.map_jobs.name
			MAPS_TABLE_NAME = aws_dynamodb_table.maps.name
			S3_COPY_FUNCTION_NAME = aws_lambda_function.s3_copy_processor.function_name
			ECS_CLUSTER = aws_ecs_cluster.main.name
			ECS_TASK_DEFINITION = aws_ecs_task_definition.processor.family
			ECS_SUBNETS = join(",", [aws_subnet.public_a.id, aws_subnet.public_b.id])
			ECS_SECURITY_GROUP = aws_security_group.ecs_tasks.id
			PROJECT_NAME    = var.project_name
		}
	}
	tags = local.tags
}

resource "aws_lambda_permission" "allow_input_bucket" {
	statement_id  = "AllowExecutionFromS3Input"
	action        = "lambda:InvokeFunction"
	function_name = aws_lambda_function.input_handler.arn
	principal     = "s3.amazonaws.com"
	source_arn    = aws_s3_bucket.map_input.arn
}

data "archive_file" "output_handler" {
	type        = "zip"
	source_dir  = "${path.module}/lambda/output_handler"
	output_path = "${path.module}/build/output_handler.zip"
}

resource "aws_lambda_function" "output_handler" {
	function_name = "${var.project_name}-output-handler-${var.environment}"
	runtime       = "python3.11"
	handler       = "handler.lambda_handler"
	role          = local.output_handler_role_arn
	source_code_hash = data.archive_file.output_handler.output_base64sha256
	filename         = data.archive_file.output_handler.output_path
	environment {
		variables = {
			JOBS_TABLE_NAME = aws_dynamodb_table.map_jobs.name
			SES_SENDER      = var.ses_sender_email
			PROJECT_NAME    = var.project_name
		}
	}
	tags = local.tags
}

resource "aws_lambda_permission" "allow_output_bucket" {
	statement_id  = "AllowExecutionFromS3Output"
	action        = "lambda:InvokeFunction"
	function_name = aws_lambda_function.output_handler.arn
	principal     = "s3.amazonaws.com"
	source_arn    = aws_s3_bucket.map_outputs.arn
}

data "archive_file" "s3_copy_processor" {
	type        = "zip"
	source_dir  = "${path.module}/lambda/s3_copy_processor"
	output_path = "${path.module}/build/s3_copy_processor.zip"
}

resource "aws_lambda_function" "s3_copy_processor" {
	function_name = "${var.project_name}-s3-copy-processor-${var.environment}"
	runtime       = "python3.11"
	handler       = "handler.lambda_handler"
	role          = local.s3_copy_processor_role_arn
	source_code_hash = data.archive_file.s3_copy_processor.output_base64sha256
	filename         = data.archive_file.s3_copy_processor.output_path
	timeout          = 300  # 5 minutes for large file copies
	environment {
		variables = {
			JOBS_TABLE_NAME = aws_dynamodb_table.map_jobs.name
			MAPS_TABLE_NAME = aws_dynamodb_table.maps.name
			OUTPUT_BUCKET   = aws_s3_bucket.map_outputs.bucket
			PROJECT_NAME    = var.project_name
		}
	}
	tags = local.tags
}
