"""Dispatch to a live Celery worker, or run in FastAPI's background thread pool."""
import logging
from fastapi import BackgroundTasks
from app.core.config import get_settings

logger = logging.getLogger(__name__)


def dispatch_agent_team(background_tasks: BackgroundTasks, task_id: str, owner_id: str) -> str | None:
    from app.workers.celery_app import agent_team_task, celery_app

    if get_settings().redis_url:
        try:
            # A reachable broker alone does not mean there is a worker consuming jobs.
            if celery_app.control.inspect(timeout=1).ping():
                return agent_team_task.apply_async(args=(task_id, owner_id), retry=False).id
            logger.warning("No Celery workers available; using FastAPI BackgroundTasks")
        except Exception:
            logger.warning("Celery unavailable; using FastAPI BackgroundTasks", exc_info=True)
    # This synchronous callable runs in a thread, so its asyncio.run calls do not
    # conflict with FastAPI's event loop. It opens and closes its own DB session.
    background_tasks.add_task(agent_team_task.run, task_id, owner_id)
    return None
