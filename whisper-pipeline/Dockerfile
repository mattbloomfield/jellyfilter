FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir --upgrade pip setuptools && \
    pip install --no-cache-dir \
        "faster-whisper>=1.0.3" \
        "profanity-check>=1.0.3" \
        "watchdog>=4.0.0" \
        "pyyaml>=6.0" \
        "httpx>=0.27.0" \
        "aiofiles>=23.2.1" \
        "nudenet>=3.4.2"

COPY src/ ./src/

ENV CONFIG_PATH=/config/config.yaml
ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

CMD ["python", "src/main.py"]
