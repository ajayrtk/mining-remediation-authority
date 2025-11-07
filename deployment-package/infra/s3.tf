# --- S3 Buckets ---

# Input bucket for uploaded ZIP files
resource "aws_s3_bucket" "map_input" {
	bucket        = "${var.project_name}-${var.environment}-${var.map_input_bucket_name}"
	force_destroy = true
	tags          = local.tags
}

resource "aws_s3_bucket_versioning" "map_input" {
	bucket = aws_s3_bucket.map_input.id

	versioning_configuration {
		status = "Enabled"
	}
}

resource "aws_s3_bucket_public_access_block" "map_input" {
	bucket                  = aws_s3_bucket.map_input.id
	block_public_acls       = true
	block_public_policy     = true
	ignore_public_acls      = true
	restrict_public_buckets = true
}

# Lifecycle policy to delete objects after 5 days
resource "aws_s3_bucket_lifecycle_configuration" "map_input" {
	bucket = aws_s3_bucket.map_input.id

	rule {
		id     = "delete-after-5-days"
		status = "Enabled"

		# Apply to all objects
		filter {}

		expiration {
			days = 5
		}

		# Also delete old versions if versioning is enabled
		noncurrent_version_expiration {
			noncurrent_days = 5
		}
	}
}

# CORS configuration for presigned URL uploads from browser
resource "aws_s3_bucket_cors_configuration" "map_input" {
	bucket = aws_s3_bucket.map_input.id

	cors_rule {
		allowed_headers = ["*"]
		allowed_methods = ["PUT", "POST"]
		allowed_origins = ["*"] # Restrict to your domain in production
		expose_headers  = ["ETag"]
		max_age_seconds = 3600
	}
}

# Output bucket for processed files
resource "aws_s3_bucket" "map_outputs" {
	bucket        = "${var.project_name}-${var.environment}-${var.map_output_bucket_name}"
	force_destroy = true
	tags          = local.tags
}

resource "aws_s3_bucket_versioning" "map_outputs" {
	bucket = aws_s3_bucket.map_outputs.id

	versioning_configuration {
		status = "Enabled"
	}
}

resource "aws_s3_bucket_public_access_block" "map_outputs" {
	bucket                  = aws_s3_bucket.map_outputs.id
	block_public_acls       = true
	block_public_policy     = true
	ignore_public_acls      = true
	restrict_public_buckets = true
}

# --- S3 Event Notifications ---

resource "aws_s3_bucket_notification" "map_input" {
	bucket = aws_s3_bucket.map_input.id

	lambda_function {
		lambda_function_arn = aws_lambda_function.input_handler.arn
		events              = ["s3:ObjectCreated:*"]
		filter_suffix       = ".zip"
	}

	depends_on = [aws_lambda_permission.allow_input_bucket]
}

resource "aws_s3_bucket_notification" "map_outputs" {
	bucket = aws_s3_bucket.map_outputs.id

	lambda_function {
		lambda_function_arn = aws_lambda_function.output_handler.arn
		events              = ["s3:ObjectCreated:*"]
		filter_suffix       = ".zip"
	}

	depends_on = [aws_lambda_permission.allow_output_bucket]
}
