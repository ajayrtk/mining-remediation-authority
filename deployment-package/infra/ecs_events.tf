# ECS State Handler Lambda and EventBridge Rule
# Captures ECS task lifecycle events to track timing metrics for map processing

# Archive the Lambda function code
data "archive_file" "ecs_state_handler" {
	type        = "zip"
	source_dir  = "${path.module}/lambda/ecs_state_handler"
	output_path = "${path.module}/build/ecs_state_handler.zip"
}

# ECS State Handler Lambda function
resource "aws_lambda_function" "ecs_state_handler" {
	function_name    = "${var.project_name}-ecs-state-handler-${var.environment}"
	runtime          = "python3.11"
	handler          = "handler.lambda_handler"
	role             = local.ecs_state_handler_role_arn
	source_code_hash = data.archive_file.ecs_state_handler.output_base64sha256
	filename         = data.archive_file.ecs_state_handler.output_path
	timeout          = 30

	environment {
		variables = {
			MAPS_TABLE_NAME = aws_dynamodb_table.maps.name
			ECS_CLUSTER     = aws_ecs_cluster.main.name
		}
	}

	tags = local.tags
}

# IAM Role for ECS State Handler Lambda
resource "aws_iam_role" "ecs_state_handler" {
	count              = var.use_existing_iam_roles ? 0 : 1
	name               = "${var.project_name}-ecs-state-handler-${var.environment}"
	assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
	tags               = local.tags
}

# IAM Policy for ECS State Handler Lambda
resource "aws_iam_role_policy" "ecs_state_handler" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-ecs-state-handler-${var.environment}"
	role  = aws_iam_role.ecs_state_handler[0].id

	policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Effect   = "Allow"
				Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
				Resource = aws_dynamodb_table.maps.arn
			},
			{
				Effect   = "Allow"
				Action   = ["ecs:DescribeTasks"]
				Resource = "*"
				Condition = {
					ArnEquals = {
						"ecs:cluster" = aws_ecs_cluster.main.arn
					}
				}
			},
			{
				Effect = "Allow"
				Action = [
					"logs:CreateLogGroup",
					"logs:CreateLogStream",
					"logs:PutLogEvents"
				]
				Resource = "arn:aws:logs:*:*:*"
			}
		]
	})
}

# Attach basic execution role for CloudWatch Logs
resource "aws_iam_role_policy_attachment" "ecs_state_handler_basic" {
	count      = var.use_existing_iam_roles ? 0 : 1
	role       = aws_iam_role.ecs_state_handler[0].name
	policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# EventBridge Rule to capture ECS task state changes
resource "aws_cloudwatch_event_rule" "ecs_task_state_change" {
	name        = "${var.project_name}-ecs-task-state-${var.environment}"
	description = "Captures ECS task state changes for timing metrics"

	event_pattern = jsonencode({
		source      = ["aws.ecs"]
		detail-type = ["ECS Task State Change"]
		detail = {
			clusterArn = [aws_ecs_cluster.main.arn]
			lastStatus = ["RUNNING", "STOPPED"]
		}
	})

	tags = local.tags
}

# EventBridge Target to invoke the Lambda
resource "aws_cloudwatch_event_target" "ecs_state_to_lambda" {
	rule      = aws_cloudwatch_event_rule.ecs_task_state_change.name
	target_id = "EcsStateHandler"
	arn       = aws_lambda_function.ecs_state_handler.arn
}

# Permission for EventBridge to invoke Lambda
resource "aws_lambda_permission" "allow_eventbridge" {
	statement_id  = "AllowExecutionFromEventBridge"
	action        = "lambda:InvokeFunction"
	function_name = aws_lambda_function.ecs_state_handler.function_name
	principal     = "events.amazonaws.com"
	source_arn    = aws_cloudwatch_event_rule.ecs_task_state_change.arn
}
