#!/bin/bash
set -e

# This script tells Render where to find package.json
# Render will execute this instead of the default npm install

echo "Building Resal Store..."
echo "Current directory: $(pwd)"
echo "Files in current directory:"
ls -la

# Run npm install
npm install

echo "Build complete!"
