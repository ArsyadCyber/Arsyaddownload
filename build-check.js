#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, 'artifacts/api-server/dist');

// Check if dist folder exists
if (!fs.existsSync(distDir)) {
    console.log('🔨 Building application...');
    try {
        execSync('npm run build:api', { stdio: 'inherit' });
        console.log('✅ Build successful!');
    } catch (error) {
        console.error('❌ Build failed:', error.message);
        process.exit(1);
    }
} else {
    console.log('✅ Application already built');
}
