FROM python:3.12-slim
# Prefer HTTPS and retry interrupted downloads on slower connections.
# Keep the existing base tag so a retry can reuse the already downloaded image.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80-download-retries \
    && apt-get update -o APT::Update::Error-Mode=any \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home voice && mkdir /models && chown voice:voice /models
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --retries 5 --timeout 60 -r requirements.txt
COPY app.py engine.py smoke.py ./
USER voice
ENV PYTHONUNBUFFERED=1 VOICE_MODEL_DIR=/models
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
