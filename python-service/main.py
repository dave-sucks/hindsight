import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

from routers import health, research

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

SERVICE_SECRET = os.getenv("SERVICE_SECRET", "")

app = FastAPI(title="Hindsight Python Service", version="0.1.0")

# CORS — allow Next.js frontend (Vercel + localhost dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_service_secret(request: Request, call_next):
    # /health and CORS preflight are public
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)

    token = request.headers.get("X-Service-Secret", "")
    if not SERVICE_SECRET or token != SERVICE_SECRET:
        logger.warning("Auth failure on %s from %s", request.url.path, request.client.host if request.client else "unknown")
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    return await call_next(request)


app.include_router(health.router)
app.include_router(research.router, prefix="/research")
