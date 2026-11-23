# AjoLabs

Ajo and Esusu savings circles in naira, with payments through Paga and a public record on Solana.

**Live:** https://ajolab.onrender.com

AjoLabs is a prototype running on Paga's sandbox with test money. No real money moves.

## What it does

- **Private circles.** Set the amount, the number of members and how often people pay. Share a private invite link, including a WhatsApp share button.
- **Payments through Paga.** Each member gets a Paga account number to fund their balance. Contributions go through Paga checkout or direct debit, and payouts go to any Nigerian bank through the Paga Business API.
- **Rules that protect the group.** A deposit from every member, a holdback from each payout that shrinks as people finish circles, a default pool, a countdown with a grace period, and settlement when someone misses a payment.
- **Ajo Score.** On-time payments, finished circles, late payments and missed payments become a score and a level (New, Building, Reliable, Trusted, At risk). Members see only each other's level.
- **Proof on Solana.** Each event (circle started, payment, payout, missed payment, circle completed) is added to a hash chain and written to Solana devnet as a memo. Memos carry no names, emails or phone numbers. Anyone can read a circle's record at `/api/proof/<circle id>`.
- **Receipts.** Every payment and payout is saved in the app and emailed.
- **Wallet.** Connect a Phantom wallet (devnet) to fund your balance with test SOL.

Full rules are on the [How it works](https://ajolab.onrender.com/how-it-works.html) page.

## Stack

Node.js with no web framework and no build step. Plain HTML, CSS and JavaScript on the front end. Paga Engine (Collect and Business APIs) for money, Privy for sign-in, Upstash Redis for storage, and Solana devnet JSON-RPC for records. Email goes through a Google Apps Script relay, with Brevo and Resend as fallbacks.

## Run it locally

```
npm start          # http://localhost:3000
npm test           # end-to-end tests in mock mode
```

With `PAGA_MODE=mock` the app runs without Paga credentials and shows test buttons for filling a circle and paying for other members.

## Settings

All settings are environment variables. Never commit real values.

| Name | What it is for |
| --- | --- |
| `PAGA_MODE`, `PAGA_ENV`, `PAGA_PUBLIC_KEY`, `PAGA_SECRET_KEY`, `PAGA_HMAC_KEY` | Paga Engine access (live sandbox or mock) |
| `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY` | Sign-in |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Saving data between restarts |
| `GAS_URL`, `GAS_SECRET`, `BREVO_API_KEY`, `RESEND_API_KEY` | Sending email |
| `SOL_RPC`, `SOL_TREASURY`, `SOL_ANCHOR` | Solana network, wallet payments, and a switch to turn record writing off |
| `SOL_RECORDER_KEY` | Key that pays the fee for writing records. If unset, a devnet-only key is created and kept in the data store |
| `PUBLIC_URL`, `PORT` | Site address and port |

## Status and limits

- Runs on Paga's sandbox and Solana devnet only.
- Going live with real money needs Paga's production approval, user verification (KYC), and moving the Solana recorder key into a proper secret.
- The Ajo Score history starts from each user's first payment under this version.

## Tests

`npm test` covers circle rules, settlement, the score, the hash chain, Solana transaction signing and the record-sending flow against a simulated network.

## Roadmap

1. Verification levels with a Verified badge, built on what Paga already checks.
2. Circles for communities such as market unions, churches and cooperatives.
3. Diaspora circles, where family abroad funds a circle at home through Paga.
