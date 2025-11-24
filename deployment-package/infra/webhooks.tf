# Webhooks DynamoDB table
# Stores webhook configurations for event notifications

resource "aws_dynamodb_table" "webhooks_table" {
  name           = "${var.project_name}-webhooks-${var.environment}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "webhookId"
  range_key      = "userId"

  attribute {
    name = "webhookId"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  # Global secondary index for querying webhooks by user
  global_secondary_index {
    name            = "UserIdIndex"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  # Enable point-in-time recovery for data protection
  point_in_time_recovery {
    enabled = true
  }

  # Enable encryption at rest
  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.project_name}-webhooks-${var.environment}"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}

# Output the table name for use in other resources
output "webhooks_table_name" {
  description = "Name of the webhooks DynamoDB table"
  value       = aws_dynamodb_table.webhooks_table.name
}

output "webhooks_table_arn" {
  description = "ARN of the webhooks DynamoDB table"
  value       = aws_dynamodb_table.webhooks_table.arn
}
