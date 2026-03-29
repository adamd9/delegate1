#!/bin/bash
# deploy-browser.sh — Build, push, and restart the browser-enabled Docker image
#
# Target:
#   Registry : appservicesdevacr.azurecr.io
#   Image    : hk-api:latest
#   Web App  : hk-api-drop37 (resource group: AppServiceDev)
#
# Prerequisites:
#   - az CLI installed and logged in (`az login`)
#   - Docker daemon running (e.g. `colima start`)
#   - Run from the delegate1 project root
#
# Usage:
#   chmod +x scripts/deploy-browser.sh
#   ./scripts/deploy-browser.sh

set -euo pipefail

ACR_NAME="appservicesdevacr"
IMAGE="appservicesdevacr.azurecr.io/hk-api:latest"
WEBAPP="hk-api-drop37"
RESOURCE_GROUP="AppServiceDev"
DOCKERFILE="Dockerfile.browser"

echo "==> Logging in to ACR: $ACR_NAME"
az acr login --name "$ACR_NAME"

echo "==> Building image from $DOCKERFILE (linux/amd64 for Azure)"
# Use buildx for cross-platform builds from Apple Silicon.
# Requires: brew install docker-buildx + builder created once with:
#   docker buildx create --name amd64builder --platform linux/amd64 --use
# --push sends directly to ACR, skipping a separate docker push step.
docker buildx build --platform linux/amd64 -f "$DOCKERFILE" \
  -t "$IMAGE" --push .

echo "==> Restarting web app: $WEBAPP"
az webapp restart --name "$WEBAPP" --resource-group "$RESOURCE_GROUP"

echo "==> Done. Image: $IMAGE"
echo "    App URL: https://$(az webapp show --name $WEBAPP --resource-group $RESOURCE_GROUP --query defaultHostName -o tsv)"
