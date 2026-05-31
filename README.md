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
- `META_SECOND_PIXEL_ID`
- `META_SECOND_ACCESS_TOKEN`

## Estrutura

- `index.html`: pagina do Site 18
- `styles.css`: CSS do Site 18 + checkout Pix
- `attribution.js`: captura first-touch de UTM, fbclid, `_fbp`, `_fbc`, localStorage e cookie first-party
- `script.js`: checkout, pixel e acompanhamento de pagamento
- `nicole-influencer.site/nicolle`: imagens, videos, fontes e CSS originais do webzip
- `routes` e `services`: API Iron Pay, webhook, pedidos e Meta CAPI

## Rastreamento de campanhas

Use a URL principal com os parametros da Meta:

```txt
https://www.nicole-vip.site/?utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_adset={{adset.name}}&utm_content={{ad.name}}&fbclid={{fbclid}}
```

O arquivo `attribution.js` roda antes do Pixel nas paginas `index.html` e `checkout.html`. Ele salva a primeira origem em `localStorage` e no cookie first-party `site18_first_touch_attribution`, sem sobrescrever se ja existir uma origem salva.

No checkout, esses dados sao enviados em `/api/payments/checkout`, salvos no pedido em `outputs/orders.json`, repassados para a Iron Pay em `tracking` e anexados ao evento `Purchase` da Meta CAPI. O Pixel do navegador usa o mesmo `eventID` (`Purchase.<order_id>`) e a CAPI envia o Purchase uma unica vez pelo backend para evitar duplicidade.
