#!/usr/bin/env bash
IMAGE_URL="$1"
OUTPUT_PATH="${2:-/tmp/linear_issue_image.png}"

if [ -z "$LINEAR_API_KEY" ]; then
  echo "Error: LINEAR_API_KEY environment variable is not set." >&2
  exit 1
fi

# Download image passing Linear API key for authenticated CDN access

curl -s -S -H "Authorization: $LINEAR_API_KEY" -L "$IMAGE_URL" -o "$OUTPUT_PATH"

if [ -f "$OUTPUT_PATH" ] && [ -s "$OUTPUT_PATH" ]; then
  echo "$OUTPUT_PATH"
else
  echo "Error: Failed to download image from $IMAGE_URL" >&2
  exit 1
fi
