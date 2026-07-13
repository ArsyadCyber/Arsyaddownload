#!/bin/bash
# Post-merge hook untuk setup otomatis setelah pull

echo "Running post-merge setup..."
npm install
npm run build:api
