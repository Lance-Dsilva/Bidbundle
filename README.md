# NeighBid

This repository contains the NeighBid responsive web application, its API, and
the standalone marketing website.

## Responsive web app

The Next.js application lives in `src/`, with static assets in `public/`.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## API

The FastAPI backend lives in `api/`.

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

The API runs at <http://localhost:8000> by default.

## Marketing website

The standalone HTML/CSS/JavaScript website lives in `website-redesign/`.

```bash
cd website-redesign
python3 -m http.server 8080
```

Open <http://localhost:8080>.
