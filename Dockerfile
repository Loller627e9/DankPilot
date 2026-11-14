FROM python:3.13-slim

WORKDIR /app

# Install deps first so the layer is cached across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1 \
    KEEP_ALIVE=true \
    PORT=10000 \
    DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 10000
CMD ["python", "-m", "dankfarm"]
