# Data sources for looking up existing IAM roles when use_existing_iam_roles = true
data "aws_iam_role" "existing_input_handler" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.input_handler != null ? 1 : 0
	name  = var.existing_iam_role_names.input_handler
}

data "aws_iam_role" "existing_output_handler" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.output_handler != null ? 1 : 0
	name  = var.existing_iam_role_names.output_handler
}

data "aws_iam_role" "existing_s3_copy_processor" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.s3_copy_processor != null ? 1 : 0
	name  = var.existing_iam_role_names.s3_copy_processor
}

data "aws_iam_role" "existing_ecs_task_execution" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.ecs_task_execution != null ? 1 : 0
	name  = var.existing_iam_role_names.ecs_task_execution
}

data "aws_iam_role" "existing_ecs_task" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.ecs_task != null ? 1 : 0
	name  = var.existing_iam_role_names.ecs_task
}

data "aws_iam_role" "existing_frontend_task_execution" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.frontend_task_execution != null ? 1 : 0
	name  = var.existing_iam_role_names.frontend_task_execution
}

data "aws_iam_role" "existing_frontend_task" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.frontend_task != null ? 1 : 0
	name  = var.existing_iam_role_names.frontend_task
}

data "aws_iam_role" "existing_pre_auth_trigger" {
	count = var.use_existing_iam_roles && var.existing_iam_role_names.pre_auth_trigger != null ? 1 : 0
	name  = var.existing_iam_role_names.pre_auth_trigger
}

data "aws_iam_role" "existing_ecs_state_handler" {
	count = var.use_existing_iam_roles && lookup(var.existing_iam_role_names, "ecs_state_handler", null) != null ? 1 : 0
	name  = var.existing_iam_role_names.ecs_state_handler
}

# Local values to determine which role ARN/name to use
locals {
	input_handler_role_arn = var.use_existing_iam_roles && var.existing_iam_role_names.input_handler != null ? data.aws_iam_role.existing_input_handler[0].arn : (length(aws_iam_role.input_handler) > 0 ? aws_iam_role.input_handler[0].arn : null)
	input_handler_role_id  = var.use_existing_iam_roles && var.existing_iam_role_names.input_handler != null ? data.aws_iam_role.existing_input_handler[0].id : (length(aws_iam_role.input_handler) > 0 ? aws_iam_role.input_handler[0].id : null)

	output_handler_role_arn = var.use_existing_iam_roles && var.existing_iam_role_names.output_handler != null ? data.aws_iam_role.existing_output_handler[0].arn : (length(aws_iam_role.output_handler) > 0 ? aws_iam_role.output_handler[0].arn : null)
	output_handler_role_id  = var.use_existing_iam_roles && var.existing_iam_role_names.output_handler != null ? data.aws_iam_role.existing_output_handler[0].id : (length(aws_iam_role.output_handler) > 0 ? aws_iam_role.output_handler[0].id : null)

	s3_copy_processor_role_arn = var.use_existing_iam_roles && var.existing_iam_role_names.s3_copy_processor != null ? data.aws_iam_role.existing_s3_copy_processor[0].arn : (length(aws_iam_role.s3_copy_processor) > 0 ? aws_iam_role.s3_copy_processor[0].arn : null)
	s3_copy_processor_role_id  = var.use_existing_iam_roles && var.existing_iam_role_names.s3_copy_processor != null ? data.aws_iam_role.existing_s3_copy_processor[0].id : (length(aws_iam_role.s3_copy_processor) > 0 ? aws_iam_role.s3_copy_processor[0].id : null)

	ecs_task_execution_role_arn  = var.use_existing_iam_roles && var.existing_iam_role_names.ecs_task_execution != null ? data.aws_iam_role.existing_ecs_task_execution[0].arn : (length(aws_iam_role.ecs_task_execution) > 0 ? aws_iam_role.ecs_task_execution[0].arn : null)
	ecs_task_execution_role_name = var.use_existing_iam_roles && var.existing_iam_role_names.ecs_task_execution != null ? data.aws_iam_role.existing_ecs_task_execution[0].name : (length(aws_iam_role.ecs_task_execution) > 0 ? aws_iam_role.ecs_task_execution[0].name : null)

	ecs_task_role_arn = var.use_existing_iam_roles && var.existing_iam_role_names.ecs_task != null ? data.aws_iam_role.existing_ecs_task[0].arn : (length(aws_iam_role.ecs_task) > 0 ? aws_iam_role.ecs_task[0].arn : null)
	ecs_task_role_id  = var.use_existing_iam_roles && var.existing_iam_role_names.ecs_task != null ? data.aws_iam_role.existing_ecs_task[0].id : (length(aws_iam_role.ecs_task) > 0 ? aws_iam_role.ecs_task[0].id : null)

	frontend_task_execution_role_arn  = var.use_existing_iam_roles && var.existing_iam_role_names.frontend_task_execution != null ? data.aws_iam_role.existing_frontend_task_execution[0].arn : (length(aws_iam_role.frontend_task_execution) > 0 ? aws_iam_role.frontend_task_execution[0].arn : null)
	frontend_task_execution_role_name = var.use_existing_iam_roles && var.existing_iam_role_names.frontend_task_execution != null ? data.aws_iam_role.existing_frontend_task_execution[0].name : (length(aws_iam_role.frontend_task_execution) > 0 ? aws_iam_role.frontend_task_execution[0].name : null)

	frontend_task_role_arn = var.use_existing_iam_roles && var.existing_iam_role_names.frontend_task != null ? data.aws_iam_role.existing_frontend_task[0].arn : (length(aws_iam_role.frontend_task) > 0 ? aws_iam_role.frontend_task[0].arn : null)
	frontend_task_role_id  = var.use_existing_iam_roles && var.existing_iam_role_names.frontend_task != null ? data.aws_iam_role.existing_frontend_task[0].id : (length(aws_iam_role.frontend_task) > 0 ? aws_iam_role.frontend_task[0].id : null)

	pre_auth_trigger_role_arn = var.use_existing_iam_roles && var.existing_iam_role_names.pre_auth_trigger != null ? data.aws_iam_role.existing_pre_auth_trigger[0].arn : (length(aws_iam_role.pre_auth_trigger) > 0 ? aws_iam_role.pre_auth_trigger[0].arn : null)

	ecs_state_handler_role_arn = var.use_existing_iam_roles && lookup(var.existing_iam_role_names, "ecs_state_handler", null) != null ? data.aws_iam_role.existing_ecs_state_handler[0].arn : (length(aws_iam_role.ecs_state_handler) > 0 ? aws_iam_role.ecs_state_handler[0].arn : null)
}
