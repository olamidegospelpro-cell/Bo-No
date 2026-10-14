# BoJo — Book Journal

BoJo is a mobile-first offline PWA for book-style notes, plans, scripts, to-dos, flashbacks, star-rated rediscovery, and gentle in-app pings.

## Deploy on Vercel

1. Create a new GitHub repository.
2. Upload everything in this folder to the repository root.
3. In Vercel, import that repository.
4. Leave the framework preset as `Other`.
5. Leave build/output settings empty.
6. Deploy.

After deployment, open the Vercel URL in iPhone Safari and use **Share > Add to Home Screen**.

## Local Preview

```bash
python -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.
