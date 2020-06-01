#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

# Create manifest
npm run build:manifest

# Run codegen
rm -rf ./types && graph codegen -o types
