#!/bin/bash
# Create Cognito Identity Pool for S3 uploads

REGION="eu-west-1"
USER_POOL_ID="eu-west-1_L5Y0EC1E2"
CLIENT_ID="67ti0q896rb20s7bei7ovnfcj8"
INPUT_BUCKET="mra-mines-staging-mra-map-input"
OUTPUT_BUCKET="mra-mines-staging-mra-map-output"

echo "Creating Cognito Identity Pool..."

# Create Identity Pool
IDENTITY_POOL=$(aws cognito-identity create-identity-pool \
  --identity-pool-name "mra-mines-staging-users" \
  --allow-unauthenticated-identities false \
  --cognito-identity-providers \
    ProviderName=cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID},ClientId=${CLIENT_ID},ServerSideTokenCheck=false \
  --region $REGION \
  --output json)

IDENTITY_POOL_ID=$(echo $IDENTITY_POOL | jq -r '.IdentityPoolId')

echo "✓ Identity Pool created: $IDENTITY_POOL_ID"

# Create IAM role for authenticated users
echo "Creating IAM role for authenticated users..."

ROLE_NAME="mra-mines-staging-cognito-authenticated"

# Trust policy
cat > /tmp/trust-policy.json << TRUST
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "${IDENTITY_POOL_ID}"
        },
        "ForAnyValue:StringLike": {
          "cognito-identity.amazonaws.com:amr": "authenticated"
        }
      }
    }
  ]
}
TRUST

aws iam create-role \
  --role-name $ROLE_NAME \
  --assume-role-policy-document file:///tmp/trust-policy.json \
  --region $REGION

echo "✓ IAM role created: $ROLE_NAME"

# Attach S3 permissions
echo "Attaching S3 permissions..."

cat > /tmp/s3-policy.json << POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${INPUT_BUCKET}/*",
        "arn:aws:s3:::${INPUT_BUCKET}",
        "arn:aws:s3:::${OUTPUT_BUCKET}/*",
        "arn:aws:s3:::${OUTPUT_BUCKET}"
      ]
    }
  ]
}
POLICY

aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name S3Access \
  --policy-document file:///tmp/s3-policy.json \
  --region $REGION

echo "✓ S3 permissions attached"

# Set Identity Pool roles
ROLE_ARN="arn:aws:iam::225989361267:role/${ROLE_NAME}"

aws cognito-identity set-identity-pool-roles \
  --identity-pool-id $IDENTITY_POOL_ID \
  --roles authenticated=$ROLE_ARN \
  --region $REGION

echo "✓ Identity Pool roles configured"
echo ""
echo "=========================================="
echo "✓ Setup Complete!"
echo "=========================================="
echo ""
echo "Identity Pool ID: $IDENTITY_POOL_ID"
echo "IAM Role: $ROLE_NAME"
echo ""
echo "Add this to your frontend environment:"
echo "COGNITO_IDENTITY_POOL_ID=$IDENTITY_POOL_ID"
echo ""
