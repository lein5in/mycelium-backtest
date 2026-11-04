import uvicorn

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.dev_host,
        port=settings.dev_port,
        reload=True,
        access_log=False,
    )


if __name__ == "__main__":
    main()
