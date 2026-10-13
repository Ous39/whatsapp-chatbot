# CPU image. For production speed use a CUDA base image and a GPU (the model takes seconds per sentence on GPU).
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git libsndfile1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
ENV HF_HOME=/app/.cache/huggingface
# Download the model at build time so containers start quickly (≈2 GB).
RUN python -c "from parler_tts import ParlerTTSForConditionalGeneration as M; from transformers import AutoTokenizer as T; M.from_pretrained('CONCREE/Adia_TTS'); T.from_pretrained('CONCREE/Adia_TTS')"
RUN useradd --create-home tts && chown -R tts /app
USER tts
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
