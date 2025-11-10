# Cognito Identity Pool for browser-based AWS SDK access
# Allows authenticated users to get temporary AWS credentials for direct S3 uploads

resource "aws_cognito_identity_pool" "main" {
  identity_pool_name               = "${var.project_name}-${var.environment}-identity-pool"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.web.id
    provider_name           = aws_cognito_user_pool.main.endpoint
    server_side_token_check = false
  }

  tags = local.tags
}

# IAM role for authenticated users (browser access to S3)
resource "aws_iam_role" "cognito_authenticated" {
  name = "${var.project_name}-${var.environment}-cognito-authenticated"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.main.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "authenticated"
          }
        }
      }
    ]
  })

  tags = local.tags
}

# Policy for authenticated users to access S3 buckets
resource "aws_iam_role_policy" "cognito_authenticated_s3" {
  name = "${var.project_name}-${var.environment}-cognito-s3-access"
  role = aws_iam_role.cognito_authenticated.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetObject"
        ]
        Resource = [
          "${aws_s3_bucket.map_input.arn}/*",
          "${aws_s3_bucket.map_outputs.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.map_input.arn,
          aws_s3_bucket.map_outputs.arn
        ]
      }
    ]
  })
}

# Attach the role to the identity pool
resource "aws_cognito_identity_pool_roles_attachment" "main" {
  identity_pool_id = aws_cognito_identity_pool.main.id

  roles = {
    "authenticated" = aws_iam_role.cognito_authenticated.arn
  }
}

# Output for use in frontend
output "cognito_identity_pool_id" {
  description = "Cognito Identity Pool ID for browser AWS SDK access"
  value       = aws_cognito_identity_pool.main.id
}

output "cognito_identity_pool_arn" {
  description = "Cognito Identity Pool ARN"
  value       = aws_cognito_identity_pool.main.arn
}
