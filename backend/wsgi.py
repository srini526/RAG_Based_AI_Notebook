from dotenv import load_dotenv

load_dotenv()  # no-op in production when real env vars are set

from app.factory import create_app  # noqa: E402

app = create_app()
