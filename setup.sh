#!/bin/bash

# Setup script untuk Arsyaddownload
# Script ini memastikan semua dependencies terinstall dan aplikasi tersiap untuk dijalankan

echo "🚀 Starting Arsyaddownload setup..."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing root dependencies..."
    npm install
else
    echo "✅ Root dependencies already installed"
fi

# Check if artifacts/api-server/node_modules exists
if [ ! -d "artifacts/api-server/node_modules" ]; then
    echo "📦 Installing API server dependencies..."
    cd artifacts/api-server
    npm install
    cd ../..
else
    echo "✅ API server dependencies already installed"
fi

# Build the application
echo "🔨 Building application..."
npm run build:api

if [ $? -eq 0 ]; then
    echo "✅ Setup complete! Run 'npm start' to launch the server."
else
    echo "❌ Build failed. Please check errors above."
    exit 1
fi
