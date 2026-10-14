#!/bin/sh
set -eu
awslocal s3api head-bucket --bucket nexus-raw 2>/dev/null || awslocal s3 mb s3://nexus-raw
awslocal s3api put-bucket-versioning --bucket nexus-raw --versioning-configuration Status=Enabled
