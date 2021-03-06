resource "aws_s3_bucket" "main" {
  bucket = "notion-toolbox-${random_id.bucket_suffix.hex}"
  acl    = "private"
  tags   = {}

  versioning {
    enabled = true
  }
}

resource "random_id" "bucket_suffix" {
  byte_length = 2
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket = aws_s3_bucket.main.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
