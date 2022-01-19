resource "aws_iam_user" "main" {
  name = "DenoDeploy-notion-toolbox"
  path = "/deno-deploy/"
}

resource "aws_iam_access_key" "main" {
  user = aws_iam_user.main.name
}

resource "aws_iam_user_policy" "BucketAccess" {
  name   = "BucketAccess"
  user   = aws_iam_user.main.name
  policy = data.aws_iam_policy_document.BucketAccess.json
}
