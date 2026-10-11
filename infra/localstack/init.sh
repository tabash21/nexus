#!/bin/sh
set -eu
awslocal s3api head-bucket --bucket nexus-raw 2>/dev/null || awslocal s3 mb s3://nexus-raw
