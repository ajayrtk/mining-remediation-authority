# DynamoDB tables for storing map metadata and job status

# Maps table - stores metadata for each uploaded map file
resource "aws_dynamodb_table" "maps" {
	name         = "${var.project_name}-${var.maps_table_name}-${var.environment}"
	hash_key     = "mapId"
	range_key    = "mapName"
	billing_mode = "PAY_PER_REQUEST"

	attribute {
		name = "mapId"
		type = "S"
	}

	attribute {
		name = "mapName"
		type = "S"
	}

	# GSI for querying by owner email
	attribute {
		name = "ownerEmail"
		type = "S"
	}

	global_secondary_index {
		name            = "OwnerEmailIndex"
		hash_key        = "ownerEmail"
		range_key       = "createdAt"
		projection_type = "ALL"
	}

	attribute {
		name = "createdAt"
		type = "S"
	}

	# GSI for querying maps by jobId (one job can have multiple maps)
	attribute {
		name = "jobId"
		type = "S"
	}

	global_secondary_index {
		name            = "JobIdIndex"
		hash_key        = "jobId"
		range_key       = "createdAt"
		projection_type = "ALL"
	}

	# GSI for querying maps by status (for finding failed maps)
	attribute {
		name = "status"
		type = "S"
	}

	global_secondary_index {
		name            = "StatusIndex"
		hash_key        = "status"
		range_key       = "createdAt"
		projection_type = "ALL"
	}

	tags = local.tags
}

# Jobs table - tracks processing jobs (one job can process multiple maps)
resource "aws_dynamodb_table" "map_jobs" {
	name         = "${var.project_name}-${var.map_jobs_table_name}-${var.environment}"
	hash_key     = "jobId"
	billing_mode = "PAY_PER_REQUEST"

	attribute {
		name = "jobId"
		type = "S"
	}

	attribute {
		name = "createdAt"
		type = "S"
	}

	# GSI for querying jobs by submittedBy (user email)
	attribute {
		name = "submittedBy"
		type = "S"
	}

	global_secondary_index {
		name            = "SubmittedByIndex"
		hash_key        = "submittedBy"
		range_key       = "createdAt"
		projection_type = "ALL"
	}

	tags = local.tags
}
