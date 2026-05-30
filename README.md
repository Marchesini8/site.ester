# Site 18 Webzip

Site 18 com visual do perfil Nicolle/Privacy e checkout Pix integrado pela Iron Pay.

## Rodar local

```txt
npm start
```

Por padrao, o `.env` atual usa `PORT=3001`, entao acesse:

```txt
http://127.0.0.1:3001
```

## Railway

O projeto ja inclui `railway.json` com:

- start command: `npm start`
- healthcheck: `/health`
- build: Nixpacks

No Railway, configure as variaveis do `.env.example`, principalmente:

- Nao defina `PORT` no Railway; ele injeta a porta automaticamente.
- `PAYMENT_API_URL`
- `PAYMENT_API_KEY`
- `IRONPAY_OFFER_HASH`
- `IRONPAY_PRODUCT_HASH`
- `IRONPAY_POSTBACK_URL=https://SEU-DOMINIO.up.railway.app/api/webhooks/ironpay`
- `IRONPAY_WEBHOOK_SECRET`
- `META_PIXEL_ID`
- `META_ACCESS_TOKEN`
- `TIKTOK_PIXEL_CODE`
- `TIKTOK_ACCESS_TOKEN`

## Estrutura

- `index.html`: pagina do Site 18
- `styles.css`: CSS do Site 18 + checkout Pix
- `script.js`: checkout, pixel e acompanhamento de pagamento
- `nicole-influencer.site/nicolle`: imagens, videos, fontes e CSS originais do webzip
- `routes` e `services`: API Iron Pay, webhook, pedidos, Meta CAPI e TikTok Events API
