# ArsyadWkBot

Telegram bot (@ArsyadWkBot) yang bisa download media dari berbagai platform, cek ID game, cek ongkos kirim, dan lacak resi pengiriman.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Bot token: `TELEGRAM_BOT_TOKEN` secret
- RapidAPI key: `RAPIDAPI_KEY` secret (tersedia tapi hanya `/general/logistics` & `/general/autocomplete` di plan gratis)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: Grammy (Telegram)
- Build: esbuild (bundles to `dist/index.mjs`)
- Python 3: dipakai untuk scraping (fbSnapsave.py, ongkirScrape.py, resiScrape.py)

## Where things live

```
artifacts/api-server/src/
  bot/
    index.ts              — bot entrypoint, semua command & callback
    session.ts            — in-memory session store (YT, TikTok, Threads, FB)
    handlers/
      ytDownload.ts       — YouTube download
      igDownload.ts       — Instagram download
      ttDownload.ts       — TikTok download
      threadsDownload.ts  — Threads download
      fbDownload.ts       — Facebook download (via Python)
      gameCheckHandler.ts — Cek ID Game (15 games)
      ongkirHandler.ts    — Cek Ongkos Kirim (via Python)
      resiHandler.ts      — Cek Resi tracking (via Python)
    utils/
      fbSnapsave.py       — scrape snapsave.app untuk FB download
      ongkirScrape.py     — scrape ongkoskirim.id untuk cek ongkir
      resiScrape.py       — tracking resi via cainiao global API
```

## Architecture decisions

- **Python untuk scraping**: Node.js fetch diblokir dari beberapa target (snapsave.app, ongkoskirim.id), Python urllib bisa bypass. Semua scraper dijalankan via `child_process.spawn`.
- **Path Python scripts**: di runtime esbuild bundle `__dirname = dist/`, jadi path ke scripts = `path.resolve(__dirname, '../src/bot/utils/script.py')`.
- **In-memory sessions**: semua state percakapan disimpan di Map dengan TTL 10 menit, keyed by chatId.
- **Session priority di message handler**: game → ongkir → resi → URL routing. Urutan ini penting agar session tidak saling menimpa.
- **Cek Ongkir source**: ongkoskirim.id via PHP same-page AJAX POST. Mendukung 7 kurir: JNE Reg, JNE Oke, Tiki Reg, Pos Kilat Khusus, SiCepat REG, J&T Express, Tiki ECO.
- **Cek Resi source**: Cainiao Global Tracking API (`global.cainiao.com`) — accessible dari Replit, mendukung semua kurir Indonesia. Fallback ke ongkoskirim.id.
- **RapidAPI `cek-resi-cek-ongkir`**: Plan gratis hanya expose `/general/logistics` dan `/general/autocomplete`. `/tracking` dan `/shipping-cost` = HTTP 500/404 di plan gratis.

## Product

Bot Telegram multi-fitur:
- **Download media**: YouTube (resolusi picker), Instagram (Reels/Post/Story/Carousel), TikTok (wm/nwm/audio), Threads (video/foto/carousel), Facebook (Reels/Post/Video)
- **Cek ID Game**: 15 game via api-cek-id-game-ten.vercel.app
- **Cek Ongkir**: tarif semua kurir antara 2 kota (ketik kota → pilih → masukkan berat)
- **Cek Resi**: lacak paket via nomor resi (otomatis deteksi kurir)

## User preferences

_Populate as needed._

## Gotchas

- Python scripts harus diakses via `path.resolve(__dirname, '../src/bot/utils/xxx.py')` dari compiled `dist/` directory.
- Jangan run `pnpm run dev` di root — gunakan workflow Replit.
- ongkoskirim.id AJAX POST ke URL sama (`https://ongkoskirim.id/`) dengan `submit` param berbeda: `from_city`, `to_city`, `cekongkir`.
- Cainiao tracking mengembalikan `detailList: []` untuk resi yang belum diproses — ini bukan error.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
