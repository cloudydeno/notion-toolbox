data "aws_iam_policy_document" "BucketAccess" {
  statement {
    sid = "ListObjects"

    actions = [
      "s3:ListBucket",
    ]

    resources = [
      aws_s3_bucket.main.arn,
    ]
  }

  statement {
    sid = "ManageObjects"

    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]

    resources = [
      "${aws_s3_bucket.main.arn}/*",
    ]
  }
}
