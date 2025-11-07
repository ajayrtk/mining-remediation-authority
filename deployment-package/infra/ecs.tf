# ECS Resources
# Container service that processes uploaded map files

# ECR Repository for processor container
resource "aws_ecr_repository" "processor" {
	name                 = "${var.project_name}-processor"
	image_tag_mutability = "MUTABLE"
	force_delete         = true  # Allow deletion even if images exist

	image_scanning_configuration {
		scan_on_push = true
	}

	tags = local.tags
}

# ECS Cluster
resource "aws_ecs_cluster" "main" {
	name = "${var.project_name}-cluster"

	setting {
		name  = "containerInsights"
		value = "enabled"
	}

	tags = local.tags
}

# Task execution role - allows ECS to pull images
resource "aws_iam_role" "ecs_task_execution" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-ecs-task-execution"

	assume_role_policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Effect = "Allow"
				Principal = {
					Service = "ecs-tasks.amazonaws.com"
				}
				Action = "sts:AssumeRole"
			}
		]
	})

	tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
	count      = var.use_existing_iam_roles ? 0 : 1
	role       = aws_iam_role.ecs_task_execution[0].name
	policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Additional policy for CloudWatch log group creation
resource "aws_iam_role_policy" "ecs_task_execution_logs" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-ecs-task-execution-logs"
	role  = aws_iam_role.ecs_task_execution[0].id

	policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
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

# Task role - permissions for container to access S3
resource "aws_iam_role" "ecs_task" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-ecs-task"

	assume_role_policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Effect = "Allow"
				Principal = {
					Service = "ecs-tasks.amazonaws.com"
				}
				Action = "sts:AssumeRole"
			}
		]
	})

	tags = local.tags
}

resource "aws_iam_role_policy" "ecs_task" {
	count = var.use_existing_iam_roles ? 0 : 1
	name  = "${var.project_name}-ecs-task"
	role  = aws_iam_role.ecs_task[0].id

	policy = jsonencode({
		Version = "2012-10-17"
		Statement = [
			{
				Effect = "Allow"
				Action = [
					"s3:GetObject",
					"s3:GetObjectTagging",
					"s3:HeadObject"
				]
				Resource = "${aws_s3_bucket.map_input.arn}/*"
			},
			{
				Effect = "Allow"
				Action = [
					"s3:PutObject",
					"s3:PutObjectTagging"
				]
				Resource = "${aws_s3_bucket.map_outputs.arn}/*"
			},
			{
				Effect = "Allow"
				Action = [
					"dynamodb:UpdateItem",
					"dynamodb:GetItem",
					"dynamodb:PutItem"
				]
				Resource = [
					aws_dynamodb_table.map_jobs.arn,
					aws_dynamodb_table.maps.arn
				]
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

# ECS Task Definition
resource "aws_ecs_task_definition" "processor" {
	family                   = "${var.project_name}-processor"
	network_mode             = "awsvpc"
	requires_compatibilities = ["FARGATE"]
	cpu                      = "256"  # 0.25 vCPU
	memory                   = "512"  # 512 MB
	execution_role_arn       = local.ecs_task_execution_role_arn
	task_role_arn            = local.ecs_task_role_arn

	container_definitions = jsonencode([
		{
			name      = "processor"
			image     = "${aws_ecr_repository.processor.repository_url}:latest"
			essential = true

			logConfiguration = {
				logDriver = "awslogs"
				options = {
					"awslogs-group"         = "/ecs/${var.project_name}-processor"
					"awslogs-region"        = data.aws_region.current.name
					"awslogs-stream-prefix" = "ecs"
					"awslogs-create-group"  = "true"
				}
			}

			environment = [
				{
					name  = "INPUT_BUCKET"
					value = aws_s3_bucket.map_input.bucket
				},
				{
					name  = "OUTPUT_BUCKET"
					value = aws_s3_bucket.map_outputs.bucket
				},
				{
					name  = "JOBS_TABLE_NAME"
					value = aws_dynamodb_table.map_jobs.name
				},
				{
					name  = "MAPS_TABLE_NAME"
					value = aws_dynamodb_table.maps.name
				},
				{
					name  = "AWS_DEFAULT_REGION"
					value = data.aws_region.current.name
				}
			]
		}
	])

	tags = local.tags
}

# Security Group for ECS tasks
resource "aws_security_group" "ecs_tasks" {
	name        = "${var.project_name}-ecs-tasks"
	description = "Security group for ECS processor tasks"
	vpc_id      = aws_vpc.main.id

	egress {
		from_port   = 0
		to_port     = 0
		protocol    = "-1"
		cidr_blocks = ["0.0.0.0/0"]
		description = "Allow all outbound traffic"
	}

	tags = local.tags
}
