from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.post("/run")
async def research_run():
    """Trigger a full research run. Implemented in DAV-25."""
    return JSONResponse(status_code=501, content={"detail": "Not Implemented"})


@router.post("/chat")
async def research_chat():
    """SSE streaming research chat. Implemented in DAV-27."""
    return JSONResponse(status_code=501, content={"detail": "Not Implemented"})
