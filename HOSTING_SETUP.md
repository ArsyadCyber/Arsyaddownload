# 🚀 Setup Hosting Guide

Panduan lengkap untuk deploy Arsyaddownload ke berbagai hosting platform.

## Quick Start

```bash
# 1. Clone repository
git clone https://github.com/ArsyadCyber/Arsyaddownload.git
cd Arsyaddownload

# 2. Install dependencies
npm install

# 3. Setup environment variables
cp .env.example .env
# Edit .env dengan konfigurasi Anda

# 4. Build aplikasi
npm run build

# 5. Jalankan aplikasi
npm start
```

## Untuk Development

```bash
npm run dev
```

## Platform-Specific Setup

### RafzHost

1. **Login ke RafzHost Dashboard**
2. **Create New Project**
3. **Select Node.js Runtime**
4. **Connect GitHub Repository**
   - GitHub Repo: `ArsyadCyber/Arsyaddownload`
   - Branch: `main`
5. **Environment Variables**
   - `PORT`: 3000 (atau sesuai RafzHost)
   - `TELEGRAM_BOT_TOKEN`: Isi dengan token Anda
   - `NODE_ENV`: `production`
6. **Build Command**: `npm run build`
7. **Start Command**: `npm start`
8. **Deploy**

### Heroku

```bash
# Login ke Heroku
heroku login

# Create app
heroku create your-app-name

# Set environment variables
heroku config:set TELEGRAM_BOT_TOKEN=your_token_here
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

### Railway.app

1. Go to https://railway.app
2. New Project > GitHub Repo
3. Select this repository
4. Add environment variables in settings
5. Railway akan auto-detect `package.json` dan jalankan `npm start`

### Replit

1. Go to https://replit.com/
2. New Repl > Import from GitHub
3. URL: `https://github.com/ArsyadCyber/Arsyaddownload`
4. Atur environment variables di Secrets
5. Run button akan execute `npm start`

### VPS (Ubuntu/Debian)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 untuk background process
sudo npm install -g pm2

# Clone & Setup
git clone https://github.com/ArsyadCyber/Arsyaddownload.git
cd Arsyaddownload
npm install
npm run build

# Start with PM2
pm2 start --name "arsyaddownload" npm -- start
pm2 startup
pm2 save
```

## Environment Variables Penjelasan

| Variable | Deskripsi | Contoh |
|----------|-----------|--------|
| `PORT` | Port server berjalan | `3000` |
| `NODE_ENV` | Environment mode | `production` atau `development` |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram dari @BotFather | `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `LOG_LEVEL` | Level logging | `info`, `debug`, `warn`, `error` |

## Troubleshooting

### Error: "PORT environment variable is required"

**Solusi:** Pastikan environment variable `PORT` sudah di-set di hosting platform Anda.

```bash
export PORT=3000
npm start
```

### Error: "Cannot find module"

**Solusi:** Jalankan install ulang

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Port Already in Use

**Solusi:** Ubah PORT atau kill process yang menggunakan port tersebut

```bash
# Linux/Mac
lsof -i :3000
kill -9 <PID>

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

## Monitoring & Logs

### Dengan PM2

```bash
# Monitor real-time
pm2 monit

# View logs
pm2 logs arsyaddownload

# Clear logs
pm2 flush
```

### Dengan Docker (Optional)

Buat `Dockerfile` untuk containerization:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm run build

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

Build & Run:

```bash
docker build -t arsyaddownload .
docker run -p 3000:3000 -e TELEGRAM_BOT_TOKEN=your_token arsyaddownload
```

## Security Tips

- ✅ Jangan commit `.env` file (sudah di `.gitignore`)
- ✅ Gunakan environment variables untuk secrets
- ✅ Update dependencies secara regular: `npm audit` dan `npm update`
- ✅ Gunakan HTTPS di production
- ✅ Setup firewall & rate limiting
- ✅ Monitor error logs secara berkala

## Support & Resources

- 📚 Node.js Docs: https://nodejs.org/docs/
- 🔧 Express.js: https://expressjs.com/
- 🤖 Telegram Bot API: https://core.telegram.org/bots/api

---

**Happy Hosting! 🚀**
