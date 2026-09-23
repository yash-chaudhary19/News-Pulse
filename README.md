# News Pulse — Topic-Clustered News Timeline

News Pulse is a full-stack, end-to-end news intelligence application that aggregates real-world news articles from multiple RSS feeds (BBC News, NPR, The Guardian), extracts clean full text via Trafilatura, deduplicates articles deterministically, groups related stories into organic topic clusters using TF-IDF and cosine similarity, persists data into PostgreSQL, exposes a clean REST API via Node.js/Express, and renders an interactive, modern news experience with Next.js.

---

## Features

- **Multi-Source RSS Ingestion**: Ingests live news feeds from BBC News, NPR, and The Guardian with fault tolerance.
- **Article Extraction & Normalization**: Strips boilerplate with Trafilatura, standardizes fields across differing RSS formats, and parses timezone-aware ISO datetimes.
- **Deterministic Deduplication**: Generates SHA-256 hashes from normalized URLs/GUIDs; uses PostgreSQL upserts (`ON CONFLICT DO UPDATE`) to prevent duplicate insertions across scraper runs.
- **TF-IDF & Cosine Similarity Topic Clustering**: Groups articles into dynamic, organic topic clusters using connected components at a cosine similarity threshold of `0.30`, automatically generating descriptive 2-4 word topic labels.
- **PostgreSQL Persistence**: Robust schema with foreign-key relationships, transactional cluster replacement, and failure flags (`content_available`, `extraction_error`).
- **Express REST API**: Fast, parameterized API providing health verification, paginated articles, topic clusters, cluster drill-down, and live scraper execution.
- **Next.js Frontend**: Responsive, modern dark-theme user interface built with Next.js (App Router) and CSS Modules.
- **Interactive Topic Exploration**: Clickable topic cards on the homepage that drill down into dedicated topic routes (`/cluster/[id]`) showing all related coverage across publishers.
- **Source Filtering**: Filter news streams instantly by publisher (*All*, *BBC News*, *The Guardian*, *NPR*).
- **Live Scraper Refresh**: One-click `"↻ Refresh News"` button on the frontend that triggers the Python ingestion pipeline in the background and reloads data dynamically with zero page reloads.
- **Concurrency Locking**: Built-in mutex preventing simultaneous scraper runs with `HTTP 409 Conflict` protection.

---

## Architecture

```text
       ┌───────────────────────────────┐
       │     Live RSS Feeds            │
       │ (BBC News, NPR, The Guardian) │
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │     Python Scraper            │
       │ • Trafilatura Text Extraction │
       │ • URL Normalization & SHA-256 │
       │ • TF-IDF Cosine Clustering    │
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │     PostgreSQL Database       │
       │ • articles (Unique SHA-256)   │
       │ • clusters (Atomic Rebuild)   │
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │     Node.js / Express API     │
       │ • Connection Pooling (pg)     │
       │ • Parameterized SQL Queries   │
       │ • Scraper Process Manager     │
       └──────────────┬────────────────┘
                      │
                      ▼
       ┌───────────────────────────────┐
       │     Next.js Frontend          │
       │ • Interactive Topic Cards     │
       │ • Dedicated /cluster/[id]     │
       │ • Live ↻ Refresh News Button  │
       └───────────────────────────────┘
```

---

## Project Structure

```text
news-pulse/
├── scraper/                     # Python Ingestion & NLP Clustering Engine
│   ├── src/
│   │   ├── clustering.py        # TF-IDF vectorization & connected components
│   │   ├── config.py            # Feed registry & DB configuration loader
│   │   ├── database.py          # PostgreSQL schema init, upserts, & transactions
│   │   ├── extractor.py         # Trafilatura full-text article extraction
│   │   ├── feeds.py             # Feed fetch orchestration & deduplication
│   │   ├── models.py            # Pydantic Article and Cluster models
│   │   ├── parser.py            # Feed entry normalization & date parsing
│   │   └── utils.py             # Logging, URL normalization & SHA-256 ID generator
│   ├── schema.sql               # PostgreSQL DDL table definitions
│   ├── main.py                  # Scraper CLI entry point & reporting
│   ├── test_db_persistence.py   # Scraper & database integration test suite
│   ├── requirements.txt         # Python dependencies
│   └── .env.example             # Scraper environment template
│
├── backend/                     # Node.js & Express REST API Layer
│   ├── src/
│   │   ├── db.js                # PostgreSQL connection pool & health checker
│   │   ├── index.js             # Express app setup, CORS, & route mounting
│   │   ├── routes/
│   │   │   ├── articles.js      # GET /api/articles (pagination & filtering)
│   │   │   ├── clusters.js      # GET /api/clusters & GET /api/clusters/:id
│   │   │   ├── health.js        # GET /api/health
│   │   │   └── refresh.js       # POST /api/refresh & GET /api/refresh/status
│   │   └── services/
│   │       └── scraperService.js# Child process manager & mutex lock
│   ├── test/
│   │   └── api.test.js          # API integration test suite
│   ├── package.json
│   └── .env.example
│
├── frontend/                    # Next.js Presentation Layer
│   ├── src/
│   │   ├── app/
│   │   │   ├── cluster/[id]/    # Dedicated topic cluster page & styles
│   │   │   ├── globals.css      # Design tokens, variables & dark palette
│   │   │   ├── layout.tsx       # Root layout & document metadata
│   │   │   ├── page.module.css  # Homepage CSS module
│   │   │   └── page.tsx         # Main page (Topics, Latest News, Refresh, Filter)
│   │   ├── services/
│   │   │   └── api.ts           # Frontend API client
│   │   └── types/
│   │       └── index.ts         # TypeScript interfaces
│   ├── test/
│   │   └── step8.test.js        # Frontend route & interaction test suite
│   ├── package.json
│   └── .env.example
│
└── README.md                    # Root project documentation
```

---

## Requirements

- **Python**: `3.9` or higher
- **Node.js**: `18.x` or `20.x`+ (tested on Node v26)
- **npm**: `9.x`+
- **PostgreSQL**: `14.x` or higher

---

## Setup & Installation

### 1. Database Setup
Ensure PostgreSQL is running locally. Create the database:
```bash
createdb news_pulse
# Or via psql:
psql -d postgres -c "CREATE DATABASE news_pulse;"
```

### 2. Python Scraper Setup
```bash
cd scraper
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env
cp .env.example .env
# Edit .env and verify DATABASE_URL=postgresql://localhost:5432/news_pulse
```

### 3. Backend Setup
```bash
cd ../backend
npm install

# Create .env
cp .env.example .env
# Verify PORT=5001 and DATABASE_URL=postgresql://localhost:5432/news_pulse
```

### 4. Frontend Setup
```bash
cd ../frontend
npm install

# Create .env.local
cp .env.example .env.local
# Verify NEXT_PUBLIC_API_URL=http://localhost:5001
```

---

## Running the Project

### Option A — Run the Services

1. **Start Backend API** (Port 5001):
   ```bash
   cd backend
   npm start
   ```

2. **Start Frontend** (Port 3000):
   ```bash
   cd frontend
   npm run dev
   ```

3. **Open Application**:
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

### Option B — Run the Scraper Directly (CLI)
You can run the Python scraper manually at any time:
```bash
cd scraper
source venv/bin/activate
python3 main.py
```
*(Alternatively, simply click `"↻ Refresh News"` in the frontend UI to trigger it automatically).*

---

## API Endpoints

| Method | Endpoint | Description | Query Parameters |
|---|---|---|---|
| `GET` | `/api/health` | Verifies server and PostgreSQL connectivity | None |
| `GET` | `/api/articles` | Lists articles ordered by publication time | `limit`, `offset`, `source`, `cluster_id` |
| `GET` | `/api/clusters` | Lists all topic clusters ordered by significance | None |
| `GET` | `/api/clusters/:id` | Returns cluster metadata + constituent articles | None |
| `POST` | `/api/refresh` | Triggers background Python scraper run | None |
| `GET` | `/api/refresh/status` | Returns refresh status (`running`, `last_run`) | None |

---

## Running Tests

### 1. Scraper & Persistence Tests
```bash
cd scraper
source venv/bin/activate
python3 test_db_persistence.py
```

### 2. Backend API Test Suite
```bash
cd backend
npm test
```

### 3. Frontend Integration Tests
```bash
cd frontend
npm test
npm run build
```

---

## Environment Variables

### `scraper/.env`
```env
DATABASE_URL=postgresql://user:password@localhost:5432/news_pulse
```

### `backend/.env`
```env
PORT=5001
DATABASE_URL=postgresql://user:password@localhost:5432/news_pulse
```

### `frontend/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:5001
```
